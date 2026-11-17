// HotHandZ - authoritative two-player room server.
//
// The server owns everything both players must agree on: room membership,
// the round clock, hidden picks, damage and the winner. Clients only send
// intents (create, join, ready, pick, rematch) and render what comes back.
//
// It runs in two ways:
//   1. attached to the Vite dev / preview server (see vite.config.ts), so the
//      game and the rooms share one HTTPS origin at wss://<host>/hca-ws;
//   2. standalone with `npm run server` for a hosted deployment.

import { WebSocketServer } from 'ws';
import { snapshot as leaderboardSnapshot, submit as submitScore } from './leaderboard.mjs';

export const WS_PATH = '/hca-ws';

export const RULES = {
  maxHp: 100,
  // Hero damage on a win. Rock -> Titan, Paper -> Mystic, Scissors -> Assassin.
  damage: { rock: 30, paper: 20, scissors: 25 },
  // A losing Mystic's shield soaks part of the hit.
  mysticShield: 5,
  // A player who never shows a gesture loses the round to any gesture.
  noShowDamage: 20,
  // One second per beat of the pre-throw count. Keep this a whole multiple of
  // COUNTDOWN_BEATS in src/game/protocol.ts, which is what the clients divide
  // it by to put a number on the HUD and a chop in the fists.
  countdownMs: 5000, // "5", "4", "3", "2", "1"
  chooseMs: 6000,
  revealMs: 5200, // summon + combat animation on the clients
  nextRoundDelayMs: 600,
};

const BEATS = { rock: 'scissors', scissors: 'paper', paper: 'rock' };
const GESTURES = new Set(['rock', 'paper', 'scissors']);

/** @type {Map<string, Room>} */
const rooms = new Map();

function newCode() {
  for (let i = 0; i < 200; i++) {
    const code = String(Math.floor(1000 + Math.random() * 9000));
    if (!rooms.has(code)) return code;
  }
  throw new Error('no free room codes');
}

function send(ws, msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

/** Decide one round. Exported for tests. */
export function resolveRound(pickA, pickB) {
  const picks = [pickA ?? null, pickB ?? null];
  const dmg = [0, 0];
  let winner = -1; // -1 draw
  let reason = 'draw';
  if (picks[0] && picks[1]) {
    if (picks[0] !== picks[1]) {
      winner = BEATS[picks[0]] === picks[1] ? 0 : 1;
      const loser = 1 - winner;
      let d = RULES.damage[picks[winner]];
      if (picks[loser] === 'paper') d -= RULES.mysticShield;
      dmg[loser] = d;
      reason = 'clash';
    }
  } else if (picks[0] || picks[1]) {
    winner = picks[0] ? 0 : 1;
    dmg[1 - winner] = RULES.noShowDamage;
    reason = 'no-show';
  } else {
    reason = 'both-no-show';
  }
  return { picks, winner, damage: dmg, reason };
}

/**
 * The AI rival occupies a seat like a socket would, but never receives
 * messages (send() skips anything that isn't an open socket).
 */
const AI_PLAYER = Object.freeze({ ai: true, readyState: -1 });
const isAi = (p) => p === AI_PLAYER;

/** Counter-pick: the gesture that beats `g`. */
const COUNTER = { rock: 'paper', paper: 'scissors', scissors: 'rock' };
const ALL = ['rock', 'paper', 'scissors'];

/**
 * AI choice. Mostly random so it stays fair, with a lean toward countering the
 * human's favourite throw once there is some history to read.
 * Exported for tests.
 */
export function aiChoose(history, rand = Math.random) {
  if (history.length >= 2 && rand() < 0.4) {
    const counts = { rock: 0, paper: 0, scissors: 0 };
    for (const g of history.slice(-5)) counts[g]++;
    const fav = ALL.reduce((a, b) => (counts[b] > counts[a] ? b : a));
    return COUNTER[fav];
  }
  return ALL[Math.floor(rand() * 3)];
}

class Room {
  constructor(code) {
    this.code = code;
    /** @type {(import('ws').WebSocket|typeof AI_PLAYER|null)[]} */
    this.players = [null, null];
    /** Human picks seen so far, per seat (for the AI's read of its opponent). */
    this.history = [[], []];
    this.names = ['', ''];
    /** Quick-match rooms are joinable by anyone searching for a challenger. */
    this.quick = false;
    this.aiTimer = null;
    this.ready = [false, false];
    this.rematch = [false, false];
    this.hp = [RULES.maxHp, RULES.maxHp];
    this.round = 0;
    this.phase = 'waiting'; // waiting|calibrating|countdown|choose|reveal|gameover
    this.picks = [null, null];
    this.lastResult = null;
    this.winner = -1;
    /** Seat that forfeited this match, or -1. Cleared by a rematch. */
    this.forfeitBy = -1;
    this.timer = null;
    this.phaseStartedAt = Date.now();
    this.phaseMs = 0;
  }

  seatOf(ws) {
    return this.players.indexOf(ws);
  }

  broadcastState() {
    for (let seat = 0; seat < 2; seat++) {
      const ws = this.players[seat];
      if (!ws) continue;
      send(ws, {
        type: 'state',
        code: this.code,
        you: seat,
        phase: this.phase,
        round: this.round,
        hp: this.hp,
        maxHp: RULES.maxHp,
        connected: this.players.map((p) => p != null),
        ai: this.players.map(isAi),
        names: this.names,
        quick: this.quick,
        ready: this.ready,
        // Hidden-selection rule: only whether each side has locked, never what.
        locked: this.picks.map((p) => p != null),
        phaseMs: this.phaseMs,
        phaseElapsedMs: Date.now() - this.phaseStartedAt,
        winner: this.winner,
        forfeit: this.forfeitBy,
        rematch: this.rematch,
      });
    }
  }

  setPhase(phase, ms, next) {
    clearTimeout(this.timer);
    this.phase = phase;
    this.phaseMs = ms;
    this.phaseStartedAt = Date.now();
    this.broadcastState();
    if (next) this.timer = setTimeout(next, ms);
    if (phase === 'choose') this.scheduleAiPicks();
  }

  /** The AI "thinks" for a human-like moment, then locks a hidden pick. */
  scheduleAiPicks() {
    clearTimeout(this.aiTimer);
    const round = this.round;
    for (let seat = 0; seat < 2; seat++) {
      if (!isAi(this.players[seat])) continue;
      const delay = 900 + Math.random() * 2400;
      this.aiTimer = setTimeout(() => {
        if (this.round !== round || this.phase !== 'choose') return;
        this.pick(seat, aiChoose(this.history[1 - seat]));
      }, delay);
    }
  }

  maybeStart() {
    if (this.players[0] && this.players[1] && this.ready[0] && this.ready[1]) {
      if (this.phase === 'waiting' || this.phase === 'calibrating') {
        this.startRound();
      }
    } else if (this.players[0] && this.players[1]) {
      if (this.phase === 'waiting') this.setPhase('calibrating', 0);
    }
  }

  startRound() {
    this.round += 1;
    this.picks = [null, null];
    this.setPhase('countdown', RULES.countdownMs, () =>
      this.setPhase('choose', RULES.chooseMs, () => this.reveal()),
    );
  }

  pick(seat, gesture) {
    if (this.phase !== 'choose' || !GESTURES.has(gesture)) return;
    if (this.picks[seat] != null) return; // locked picks are final
    this.picks[seat] = gesture;
    if (this.picks[0] && this.picks[1]) this.reveal();
    else this.broadcastState();
  }

  reveal() {
    clearTimeout(this.aiTimer);
    const result = resolveRound(this.picks[0], this.picks[1]);
    for (let seat = 0; seat < 2; seat++)
      if (this.picks[seat] && !isAi(this.players[seat])) this.history[seat].push(this.picks[seat]);
    this.hp = this.hp.map((h, i) => Math.max(0, h - result.damage[i]));
    this.lastResult = result;
    const gameOver = this.hp[0] <= 0 || this.hp[1] <= 0;
    if (gameOver) {
      this.winner =
        this.hp[0] <= 0 && this.hp[1] <= 0 ? -1 : this.hp[0] <= 0 ? 1 : 0;
    }
    for (let seat = 0; seat < 2; seat++) {
      send(this.players[seat], {
        type: 'reveal',
        round: this.round,
        you: seat,
        ...result,
        hp: this.hp,
        gameOver,
      });
    }
    this.setPhase('reveal', RULES.revealMs, () => {
      if (gameOver) {
        this.rematch = [false, false];
        this.setPhase('gameover', 0);
      } else {
        this.timer = setTimeout(() => this.startRound(), RULES.nextRoundDelayMs);
      }
    });
  }

  /**
   * Concede the match. The conceding seat's core drops to zero and the other
   * side wins outright, so both clients land in the same `gameover` state they
   * reach from a normal knock-out. Only valid once a match is actually running;
   * a player who simply wants out of a finished or waiting room sends `leave`.
   */
  forfeit(seat) {
    if (seat < 0 || !this.players[seat]) return;
    const live = this.phase === 'countdown' || this.phase === 'choose' || this.phase === 'reveal';
    if (!live) return;
    clearTimeout(this.timer);
    clearTimeout(this.aiTimer);
    this.picks = [null, null];
    this.hp[seat] = 0;
    this.winner = 1 - seat;
    this.forfeitBy = seat;
    this.rematch = [false, false];
    this.setPhase('gameover', 0);
  }

  requestRematch(seat) {
    if (this.phase !== 'gameover') return;
    this.rematch[seat] = true;
    // The AI is always up for another round.
    for (let s = 0; s < 2; s++) if (isAi(this.players[s])) this.rematch[s] = true;
    if (this.rematch[0] && this.rematch[1]) {
      this.hp = [RULES.maxHp, RULES.maxHp];
      this.round = 0;
      this.winner = -1;
      this.forfeitBy = -1;
      this.rematch = [false, false];
      this.startRound();
    } else {
      this.broadcastState();
    }
  }

  leave(ws) {
    const seat = this.seatOf(ws);
    if (seat < 0) return;
    this.players[seat] = null;
    this.ready[seat] = false;
    this.names[seat] = '';
    clearTimeout(this.timer);
    clearTimeout(this.aiTimer);
    const other = this.players[1 - seat];
    if (!other || isAi(other)) {
      rooms.delete(this.code);
      return;
    }
    send(other, { type: 'opponent-left' });
    // Keep the room open for a new challenger with a fresh match.
    this.hp = [RULES.maxHp, RULES.maxHp];
    this.round = 0;
    this.picks = [null, null];
    this.winner = -1;
    this.forfeitBy = -1;
    this.setPhase('waiting', 0);
  }
}

/** Display names: trimmed, printable, max 16 chars. */
function cleanName(name, fallback) {
  const n = String(name ?? '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 16);
  return n || fallback;
}

/** Seat `ws` in an open quick-match room, or open one and wait. */
function quickMatch(ws, msg) {
  if (ws.room) ws.room.leave(ws);
  ws.room = null;
  let r = null;
  for (const room of rooms.values()) {
    if (room.quick && room.phase === 'waiting' && room.players.includes(null) && !room.players.includes(ws)) {
      r = room;
      break;
    }
  }
  if (!r) {
    r = new Room(newCode());
    r.quick = true;
    rooms.set(r.code, r);
  }
  const seat = r.players.indexOf(null);
  r.players[seat] = ws;
  r.ready[seat] = !!msg.ready;
  r.names[seat] = cleanName(msg.name, 'Challenger');
  ws.room = r;
  send(ws, { type: 'joined', code: r.code, you: seat });
  r.broadcastState();
  r.maybeStart();
}

function handle(ws, raw) {
  let msg;
  try {
    msg = JSON.parse(String(raw));
  } catch {
    return;
  }
  const room = ws.room;
  switch (msg.type) {
    case 'create': {
      if (room) room.leave(ws);
      const r = new Room(newCode());
      rooms.set(r.code, r);
      r.players[0] = ws;
      ws.room = r;
      send(ws, { type: 'joined', code: r.code, you: 0 });
      r.ready[0] = !!msg.ready;
      r.names[0] = cleanName(msg.name, 'Challenger');
      if (msg.ai) {
        // Practice match: the AI takes seat 1 and is ready immediately.
        r.players[1] = AI_PLAYER;
        r.ready[1] = true;
        r.names[1] = 'AI Rival';
        r.broadcastState();
        r.maybeStart();
      } else {
        r.broadcastState();
      }
      break;
    }
    case 'join': {
      const code = String(msg.code ?? '').trim();
      const r = rooms.get(code);
      if (!r) return send(ws, { type: 'error', message: `Room ${code} not found` });
      const seat = r.players.indexOf(null);
      if (seat < 0) return send(ws, { type: 'error', message: `Room ${code} is full` });
      if (room && room !== r) room.leave(ws);
      r.players[seat] = ws;
      r.ready[seat] = !!msg.ready;
      r.names[seat] = cleanName(msg.name, 'Challenger');
      ws.room = r;
      send(ws, { type: 'joined', code: r.code, you: seat });
      r.broadcastState();
      r.maybeStart();
      break;
    }
    case 'quick':
      quickMatch(ws, msg);
      break;
    case 'ready': {
      if (!room) return;
      const seat = room.seatOf(ws);
      room.ready[seat] = true;
      room.broadcastState();
      room.maybeStart();
      break;
    }
    case 'pick':
      if (room) room.pick(room.seatOf(ws), msg.gesture);
      break;
    case 'rematch':
      if (room) room.requestRematch(room.seatOf(ws));
      break;
    case 'forfeit':
      if (room) room.forfeit(room.seatOf(ws));
      break;
    case 'leave':
      if (room) room.leave(ws);
      ws.room = null;
      break;
    case 'ping':
      send(ws, { type: 'pong', t: msg.t });
      break;
    // The leaderboard is independent of rooms: a player can look at it from
    // the courtyard without being in a match.
    case 'score':
      ws.playerName = String(msg.name || '').trim().slice(0, 24) || ws.playerName;
      submitScore(msg);
      break;
    case 'leaderboard':
      send(ws, leaderboardSnapshot(msg.name || ws.playerName || ''));
      break;
  }
}

function wire(wss) {
  wss.on('connection', (ws) => {
    ws.room = null;
    ws.on('message', (raw) => handle(ws, raw));
    ws.on('close', () => ws.room?.leave(ws));
    send(ws, { type: 'hello', rules: RULES });
  });
  return wss;
}

/** Attach to an existing http(s) server, sharing its port and certificate. */
export function attachRooms(httpServer, path = WS_PATH) {
  const wss = wire(new WebSocketServer({ noServer: true }));
  httpServer.on('upgrade', (req, socket, head) => {
    const url = req.url ?? '';
    if (!url.startsWith(path)) return; // leave Vite HMR sockets alone
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
  return wss;
}

/** Vite plugin: rooms on the dev and preview servers. */
export function handClashRooms() {
  return {
    name: 'hand-clash-rooms',
    configureServer(server) {
      if (server.httpServer) attachRooms(server.httpServer);
    },
    configurePreviewServer(server) {
      if (server.httpServer) attachRooms(server.httpServer);
    },
  };
}

// Standalone: `node server/rooms.mjs [port]`
const isMain =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (isMain) {
  const port = Number(process.argv[2] ?? process.env.PORT ?? 8787);
  const { createServer } = await import('node:http');
  const http = createServer((_, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('HotHandZ room server\n');
  });
  attachRooms(http);
  http.listen(port, () =>
    console.log(`HotHandZ rooms on ws://0.0.0.0:${port}${WS_PATH}`),
  );
}
