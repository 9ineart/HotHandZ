import { Vector3 } from '@iwsdk/core';
import type { Entity, Group, World } from '@iwsdk/core';
import type { ParticlePool, RipplePool } from './fx.js';
import type { HandTracker } from './hands.js';
import type { NetClient } from './net.js';
import type { Profile } from './profile.js';
import type { Gesture, Phase, RevealMsg, StateMsg } from './protocol.js';

/**
 * Runtime state shared by the game systems. One instance per World, created by
 * CoreSystem. Systems read it; only the owning system writes each section.
 */

type Events = {
  arenaReady: void;
  state: StateMsg;
  reveal: LocalReveal;
  netError: string;
  opponentLeft: void;
  pickLocked: Gesture;
};

export class Emitter<T extends Record<string, unknown>> {
  private map = new Map<keyof T, Set<(v: never) => void>>();
  on<K extends keyof T>(k: K, fn: (v: T[K]) => void): () => void {
    let set = this.map.get(k);
    if (!set) this.map.set(k, (set = new Set()));
    set.add(fn as (v: never) => void);
    return () => set!.delete(fn as (v: never) => void);
  }
  emit<K extends keyof T>(k: K, v: T[K]): void {
    for (const fn of this.map.get(k) ?? []) (fn as (v: T[K]) => void)(v);
  }
}

/** A round result from the local player's perspective (0 = me, 1 = rival). */
export interface LocalReveal {
  round: number;
  picks: [Gesture | null, Gesture | null];
  winner: -1 | 0 | 1;
  damage: [number, number];
  reason: RevealMsg['reason'];
  hp: [number, number];
  gameOver: boolean;
}

export interface MatchView {
  phase: Phase;
  code: string;
  you: 0 | 1;
  round: number;
  /** [me, rival] from the local player's perspective. */
  hp: [number, number];
  maxHp: number;
  locked: [boolean, boolean];
  rivalConnected: boolean;
  /** True in a practice match against the server's AI. */
  rivalIsAi: boolean;
  /** Display names from the server, [me, rival]. */
  names: [string, string];
  /** In a matchmaking room rather than a private coded one. */
  quick: boolean;
  /** Seconds remaining in the current timed phase. */
  phaseRemaining: number;
  phaseDuration: number;
  myPick: Gesture | null;
  /** Gesture currently being held (before lock), for feedback. */
  candidate: Gesture | null;
  candidateProgress: number;
  /** -1 none/draw, 0 me, 1 rival (local perspective). */
  winner: number;
  /** -1 nobody, 0 I conceded, 1 my rival did. */
  forfeitedBy: -1 | 0 | 1;
  rematchRequested: boolean;
  lastReveal: LocalReveal | null;
  /** HP shown in UI/bars; lags `hp` until the combat impact lands. */
  displayHp: [number, number];
  message: string;
}

export interface GameContext {
  world: World;
  hands: HandTracker;
  particles: ParticlePool;
  /** Shared one-shot ripples: every expanding circle in the game uses these. */
  ripples: RipplePool;
  net: NetClient;
  events: Emitter<Events>;
  arena: {
    ready: boolean;
    entity: Entity | null;
    object: Group | null;
    width: number;
    depth: number;
    /** World-space centre of the table surface under the arena. */
    center: Vector3;
    yaw: number;
  };
  match: MatchView;
  calib: { state: string; progress: number };
  /**
   * The gesture recognised right now, every frame, match or not (written by
   * MatchSystem). Used by the tutorial. Keyboard 1/2/3 stand in on desktop.
   */
  gesture: { now: Gesture | null; keyed: Gesture | null; keyedUntil: number };
  /** Device profile plus the latest result summary (written by ProgressSystem). */
  progress: { profile: Profile; lines: string[]; notice: string; noticeUntil: number };
  /** Onboarding demo hand beside the lobby (written by UiSystem, drawn by DemoHandSystem). */
  demo: { pose: Gesture | null; wave: boolean };
  time: number;
}

const contexts = new WeakMap<World, GameContext>();

export function setGame(world: World, ctx: GameContext) {
  contexts.set(world, ctx);
}

export function getGame(world: World): GameContext {
  const ctx = contexts.get(world);
  if (!ctx) throw new Error('GameContext missing: register CoreSystem first');
  return ctx;
}

export function initialMatch(): MatchView {
  return {
    phase: 'offline',
    code: '',
    you: 0,
    round: 0,
    hp: [100, 100],
    maxHp: 100,
    locked: [false, false],
    rivalConnected: false,
    rivalIsAi: false,
    names: ['', ''],
    quick: false,
    phaseRemaining: 0,
    phaseDuration: 0,
    myPick: null,
    candidate: null,
    candidateProgress: 0,
    winner: -1,
    forfeitedBy: -1,
    rematchRequested: false,
    lastReveal: null,
    displayHp: [100, 100],
    message: '',
  };
}
