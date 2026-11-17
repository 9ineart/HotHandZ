import { createSystem, VisibilityState } from '@iwsdk/core';
import { getGame } from './context.js';
import type { GameContext, LocalReveal } from './context.js';
import { classifyGesture, GestureLatch, isPalmFlatDown } from './gestures.js';
import type { HandData } from './hands.js';
import { J } from './joints.js';
import { COUNTDOWN_BEATS } from './protocol.js';
import type { Gesture, RevealMsg, StateMsg } from './protocol.js';
import { sfx } from './sfx.js';

/** How far above the table a hand must be raised to throw a gesture. */
const RAISE_HEIGHT = 0.06;

/**
 * Client side of the match: mirrors the server room state into
 * ctx.match (from the local player's perspective), runs the local countdown
 * clock, and recognises the player's Rock / Paper / Scissors gesture during the
 * choose window. Keyboard 1/2/3 (or R/P/S) also throw a gesture for desktop and
 * emulator testing.
 */
export class MatchSystem extends createSystem({}) {
  private ctx!: GameContext;
  private latch = new GestureLatch(0.6);
  private lastBeat = -1;

  init(): void {
    this.ctx = getGame(this.world);
    const { net, events, match } = this.ctx;

    this.cleanupFuncs.push(
      net.on((msg) => {
        switch (msg.type) {
          case 'joined':
            match.code = msg.code;
            match.you = msg.you;
            match.message = '';
            break;
          case 'state':
            this.applyState(msg);
            break;
          case 'reveal':
            this.applyReveal(msg);
            break;
          case 'error':
            match.message = msg.message;
            events.emit('netError', msg.message);
            break;
          case 'opponent-left':
            match.message = 'Your rival left the arena';
            match.rivalConnected = false;
            events.emit('opponentLeft', undefined);
            break;
        }
      }),
      events.on('arenaReady', () => {
        sfx.calibrated();
        if (match.code) net.send({ type: 'ready' });
      }),
    );

    const onKey = (e: KeyboardEvent) => {
      // Typing a name must not throw gestures.
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const map: Record<string, Gesture> = {
        Digit1: 'rock',
        KeyR: 'rock',
        Digit2: 'paper',
        KeyP: 'paper',
        Digit3: 'scissors',
        KeyS: 'scissors',
      };
      const g = map[e.code];
      if (!g) return;
      // Desktop stand-in for a held gesture (tutorial + matches).
      this.ctx.gesture.keyed = g;
      this.ctx.gesture.keyedUntil = this.ctx.time + 1.2;
      this.submit(g);
    };
    window.addEventListener('keydown', onKey);
    this.cleanupFuncs.push(() => window.removeEventListener('keydown', onKey));
  }

  private applyState(msg: StateMsg): void {
    const m = this.ctx.match;
    const me = msg.you;
    const rival = (1 - me) as 0 | 1;
    const prevPhase = m.phase;
    const prevRound = m.round;
    m.code = msg.code;
    m.you = me;
    m.phase = msg.phase;
    m.round = msg.round;
    m.maxHp = msg.maxHp;
    m.hp = [msg.hp[me], msg.hp[rival]];
    m.locked = [msg.locked[me], msg.locked[rival]];
    m.rivalConnected = msg.connected[rival];
    m.rivalIsAi = !!msg.ai?.[rival];
    m.names = [msg.names?.[me] ?? '', msg.names?.[rival] ?? ''];
    m.quick = !!msg.quick;
    m.phaseDuration = msg.phaseMs / 1000;
    m.phaseRemaining = Math.max(0, (msg.phaseMs - msg.phaseElapsedMs) / 1000);
    m.winner = msg.winner < 0 ? -1 : msg.winner === me ? 0 : 1;
    const ff = msg.forfeit ?? -1;
    m.forfeitedBy = ff < 0 ? -1 : ff === me ? 0 : 1;
    m.rematchRequested = msg.rematch[me];
    if (msg.phase !== 'reveal') m.displayHp = [m.hp[0], m.hp[1]];
    if (msg.phase === 'countdown' && (prevPhase !== 'countdown' || prevRound !== msg.round)) {
      m.myPick = null;
      m.candidate = null;
      m.lastReveal = null;
      this.latch.reset();
      this.lastBeat = -1;
    }
    if (msg.phase === 'choose' && prevPhase !== 'choose') sfx.go();
    if (msg.phase === 'calibrating' && !msg.ready[me] && this.ctx.arena.ready) {
      this.ctx.net.send({ type: 'ready' });
    }
    if (msg.phase === 'gameover' && prevPhase !== 'gameover') {
      if (m.winner === 0) sfx.win();
      else sfx.lose();
    }
    this.ctx.events.emit('state', msg);
  }

  private applyReveal(msg: RevealMsg): void {
    const m = this.ctx.match;
    const me = msg.you;
    const rival = (1 - me) as 0 | 1;
    const local: LocalReveal = {
      round: msg.round,
      picks: [msg.picks[me], msg.picks[rival]],
      winner: msg.winner < 0 ? -1 : msg.winner === me ? 0 : 1,
      damage: [msg.damage[me], msg.damage[rival]],
      reason: msg.reason,
      hp: [msg.hp[me], msg.hp[rival]],
      gameOver: msg.gameOver,
    };
    m.lastReveal = local;
    m.hp = local.hp;
    this.ctx.events.emit('reveal', local);
  }

  /** Lock a gesture for this round (hand tracking or keyboard). */
  submit(g: Gesture): void {
    const m = this.ctx.match;
    if (m.phase !== 'choose' || m.myPick) return;
    m.myPick = g;
    m.locked[0] = true;
    m.candidate = g;
    m.candidateProgress = 1;
    // The confirmation sound is per fighter and belongs with the rest of the
    // gesture feedback, so GestureFxSystem plays it off `pickLocked`.
    this.ctx.net.send({ type: 'pick', gesture: g });
    this.ctx.events.emit('pickLocked', g);
  }

  update(delta: number): void {
    const dt = Math.min(delta, 0.1);
    const m = this.ctx.match;
    m.phaseRemaining = Math.max(0, m.phaseRemaining - dt);

    // Live gesture readout for the tutorial and HUD feedback.
    const gs = this.ctx.gesture;
    const immersive = this.world.visibilityState.peek() !== VisibilityState.NonImmersive;
    const { left, right } = this.ctx.hands;
    const fromRight = immersive ? this.read(right) : null;
    const hand = fromRight ?? (immersive ? this.read(left) : null);
    const otherHand = fromRight ? left : right;
    gs.now = hand ?? (gs.keyed && this.ctx.time < gs.keyedUntil ? gs.keyed : null);

    if (m.phase === 'countdown') {
      const beat = Math.ceil((m.phaseRemaining / Math.max(0.001, m.phaseDuration)) * COUNTDOWN_BEATS);
      if (beat !== this.lastBeat && beat >= 1 && beat <= COUNTDOWN_BEATS) sfx.tick();
      this.lastBeat = beat;
    }

    if (m.phase !== 'choose' || m.myPick) {
      if (!m.myPick) {
        m.candidate = null;
        m.candidateProgress = 0;
      }
      this.latch.reset();
      return;
    }
    if (!immersive) return;

    const locked = this.latch.push(hand, dt);
    m.candidate = this.latch.current;
    m.candidateProgress = this.latch.progress;
    if (locked) this.submit(locked);
    // Shortcut: pinch with the other hand to lock at once. (Pinching with the
    // throwing hand would change the pose, so it is never used to confirm.)
    else if (hand && this.latch.held > 0.15 && this.pinching(otherHand)) this.submit(hand);
  }

  private pinching(h: HandData): boolean {
    return h.tracked && h.dist(J['thumb-tip'], J['index-finger-tip']) < 0.018;
  }

  private read(h: HandData): Gesture | null {
    if (!h.tracked) return null;
    const tableY = this.ctx.arena.center.y;
    if (h.palm.y < tableY + RAISE_HEIGHT) return null; // resting on the table
    if (isPalmFlatDown(h)) return null;
    return classifyGesture(h);
  }
}
