// Rival bot for solo testing Hand Clash Arena.
//
//   node scripts/rival-bot.mjs join 1234            # join room 1234
//   node scripts/rival-bot.mjs create               # create a room and print its code
//   node scripts/rival-bot.mjs quick                # matchmake like a player ("looking for a challenger")
//   node scripts/rival-bot.mjs join 1234 --pick rock --rounds 3
//
// Options: --url wss://localhost:8081/hca-ws  --pick rock|paper|scissors|random|none
//          --rounds N (exit after N reveals)   --delay ms (wait before picking)
// The bot is always "ready" (it has no table to calibrate) and accepts rematches.

import WebSocket from 'ws';

const args = process.argv.slice(2);
const mode = args[0] ?? 'create';
const code = mode === 'join' ? args[1] : undefined;
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const url = opt('url', 'wss://localhost:8081/hca-ws');
const pickMode = opt('pick', 'random');
const maxRounds = Number(opt('rounds', '0'));
const delay = Number(opt('delay', '800'));
const GESTURES = ['rock', 'paper', 'scissors'];

// The dev server uses a self-signed local certificate.
const ws = new WebSocket(url, { rejectUnauthorized: false });
const send = (m) => ws.send(JSON.stringify(m));
let reveals = 0;
let pickedRound = 0;
let lastPhase = '';

ws.on('open', () => {
  const name = opt('name', 'Rival Bot');
  if (mode === 'join') send({ type: 'join', code, ready: true, name });
  else if (mode === 'quick') send({ type: 'quick', ready: true, name });
  else send({ type: 'create', ready: true, name });
});

ws.on('message', (raw) => {
  const msg = JSON.parse(String(raw));
  switch (msg.type) {
    case 'joined':
      console.log(`[bot] joined room ${msg.code} as seat ${msg.you}`);
      break;
    case 'error':
      console.log(`[bot] error: ${msg.message}`);
      if (mode === 'join') process.exit(1);
      break;
    case 'state':
      if (msg.phase !== lastPhase) {
        console.log(`[bot] phase=${msg.phase} round=${msg.round} hp=${msg.hp.join('/')} locked=${msg.locked.join('/')}`);
        lastPhase = msg.phase;
      }
      if (msg.phase === 'choose' && pickedRound !== msg.round && pickMode !== 'none') {
        pickedRound = msg.round;
        const g = pickMode === 'random' ? GESTURES[Math.floor(Math.random() * 3)] : pickMode;
        setTimeout(() => send({ type: 'pick', gesture: g }), delay);
      }
      if (msg.phase === 'gameover' && !msg.rematch[msg.you] && maxRounds === 0) send({ type: 'rematch' });
      break;
    case 'reveal':
      reveals++;
      console.log(`[bot] REVEAL round=${msg.round} picks=${msg.picks.join(' vs ')} winner=${msg.winner} dmg=${msg.damage.join('/')} hp=${msg.hp.join('/')} reason=${msg.reason}${msg.gameOver ? ' GAME OVER' : ''}`);
      if (maxRounds && reveals >= maxRounds) setTimeout(() => process.exit(0), 300);
      break;
    case 'opponent-left':
      console.log('[bot] opponent left');
      break;
  }
});

ws.on('close', () => {
  console.log('[bot] disconnected');
  process.exit(0);
});
ws.on('error', (e) => {
  console.error('[bot] socket error:', e.message);
  process.exit(1);
});
