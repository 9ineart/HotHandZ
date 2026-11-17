/**
 * Message shapes exchanged with server/rooms.mjs. The server is authoritative;
 * clients send intents and render the state they receive.
 */

export type Gesture = 'rock' | 'paper' | 'scissors';
export type HeroKind = 'titan' | 'mystic' | 'assassin';

/**
 * Beats in the pre-throw count: "5", "4", "3", "2", "1", then the throw window.
 *
 * Three things read the server's countdown clock and have to agree on how many
 * beats fit inside it — the number on the HUD, the tick that plays under it,
 * and the fists chopping down on the table. They all divide by this, so the
 * count only has to be changed here. `RULES.countdownMs` in server/rooms.mjs
 * sets how long the phase lasts; keep it a whole multiple of this, or the
 * first beat is served short and the count opens out of step.
 */
export const COUNTDOWN_BEATS = 5;

export const HERO_FOR_GESTURE: Record<Gesture, HeroKind> = {
  rock: 'titan',
  paper: 'mystic',
  scissors: 'assassin',
};

export const HERO_LABEL: Record<HeroKind, string> = {
  // Internal kinds kept for wire/ECS compatibility; players see Rock, Paper and Scissors.
  titan: 'Rock',
  mystic: 'Paper',
  assassin: 'Scissors',
};

/** How each fighter is presented on cards and banners. */
export const FIGHTER: Record<Gesture, { name: string; role: string; color: string; bark: string }> = {
  rock: { name: 'ROCK', role: 'HEAVYWEIGHT', color: '#d9482b', bark: "Rock. Let's go." },
  paper: { name: 'PAPER', role: 'TACTICIAN', color: '#2b7fd9', bark: 'Paper. Read them.' },
  scissors: { name: 'SCISSORS', role: 'SPEED FIGHTER', color: '#1fa866', bark: 'Scissors. Too quick!' },
};

/** "ROCK crushes SCISSORS" */
export const BEAT_VERB: Record<Gesture, string> = {
  rock: 'crushes',
  paper: 'covers',
  scissors: 'cuts',
};

export type Phase =
  | 'offline'
  | 'waiting'
  | 'calibrating'
  | 'countdown'
  | 'choose'
  | 'reveal'
  | 'gameover';

export interface StateMsg {
  type: 'state';
  code: string;
  you: 0 | 1;
  phase: Exclude<Phase, 'offline'>;
  round: number;
  hp: [number, number];
  maxHp: number;
  connected: [boolean, boolean];
  /** Which seats are the server's AI rival. */
  ai: [boolean, boolean];
  names: [string, string];
  /** True for matchmaking rooms (no code to share). */
  quick: boolean;
  ready: [boolean, boolean];
  locked: [boolean, boolean];
  phaseMs: number;
  phaseElapsedMs: number;
  winner: number;
  /** Seat that conceded this match, or -1. */
  forfeit?: number;
  rematch: [boolean, boolean];
}

export interface RevealMsg {
  type: 'reveal';
  round: number;
  you: 0 | 1;
  picks: [Gesture | null, Gesture | null];
  winner: -1 | 0 | 1;
  damage: [number, number];
  reason: 'clash' | 'draw' | 'no-show' | 'both-no-show';
  hp: [number, number];
  gameOver: boolean;
}

export type ServerMsg =
  | StateMsg
  | RevealMsg
  | { type: 'hello'; rules: unknown }
  | { type: 'joined'; code: string; you: 0 | 1 }
  | { type: 'error'; message: string }
  | { type: 'opponent-left' }
  | LeaderboardMsg
  | { type: 'pong'; t: number };

/** One row of the shared board. The name is the identity: there are no accounts. */
export interface LeaderboardEntry {
  name: string;
  stars: number;
  wins: number;
  streak: number;
}

export interface LeaderboardMsg {
  type: 'leaderboard';
  top: LeaderboardEntry[];
  /** 1-based position of the asking player, or 0 if they are not on the board. */
  you: number;
  yourRow: LeaderboardEntry | null;
  /** How many players the board holds, so "7th" can be said "of 312". */
  total: number;
}

export type ClientMsg =
  | { type: 'create'; ready: boolean; ai?: boolean; name?: string }
  | { type: 'join'; code: string; ready: boolean; name?: string }
  | { type: 'quick'; ready: boolean; name?: string }
  | { type: 'ready' }
  | { type: 'pick'; gesture: Gesture }
  | { type: 'rematch' }
  /** Concede a running match: the sender loses, the rival wins. */
  | { type: 'forfeit' }
  | { type: 'leave' }
  /** Report this device's standing to the shared board. Monotonic server side. */
  | { type: 'score'; name: string; stars: number; wins: number; streak: number }
  | { type: 'leaderboard'; name?: string };
