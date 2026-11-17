import type { Gesture } from './protocol.js';

/**
 * The player's progress, saved on this device (localStorage). Pure data and
 * rules, with no engine imports, so it can be unit-tested and later moved to
 * a server account unchanged. See docs/DESIGN.md section 6.
 */

const KEY = 'hca.profile.v1';

export interface FighterProgress {
  xp: number;
  throws: number;
  wins: number;
}

export interface Profile {
  v: 1;
  stars: number;
  /** Match wins in a row. */
  streak: number;
  bestStreak: number;
  matches: number;
  wins: number;
  fighters: Record<Gesture, FighterProgress>;
  badges: string[];
  /** Achievement ids already paid out in stars. See achievements.ts. */
  claimed?: string[];
  daily?: DailyState;
}

export const RANKS = [
  { name: 'Rookie', stars: 0 },
  { name: 'Amateur', stars: 5 },
  { name: 'Contender', stars: 15 },
  { name: 'Challenger', stars: 30 },
  { name: 'Champion', stars: 50 },
  { name: 'Hall of Fame', stars: 80 },
] as const;

/** Losses cost no star until the player has reached Contender. */
const STAR_FLOOR = 15;
const XP_PLAYED = 10;
const XP_WON = 25;
const XP_MATCH_WINNER = 50;
export const MAX_LEVEL = 20;
const MASTERY_TIERS = [50, 250, 500, 1000, 2500];
const STREAKS: [number, string][] = [
  [20, 'LEGENDARY'],
  [10, 'UNSTOPPABLE'],
  [5, 'ON FIRE'],
  [3, 'HOT HAND'],
];
const LABEL: Record<Gesture, string> = { rock: 'Rock', paper: 'Paper', scissors: 'Scissors' };

export function newProfile(): Profile {
  const f = (): FighterProgress => ({ xp: 0, throws: 0, wins: 0 });
  return { v: 1, stars: 0, streak: 0, bestStreak: 0, matches: 0, wins: 0, fighters: { rock: f(), paper: f(), scissors: f() }, badges: [] };
}

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Profile;
      if (p && p.v === 1 && p.fighters?.rock && p.fighters.paper && p.fighters.scissors) return p;
    }
  } catch {
    /* unreadable or blocked storage: start fresh */
  }
  return newProfile();
}

export function saveProfile(p: Profile): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* progress simply is not kept */
  }
}

export function rankOf(stars: number): string {
  let name: string = RANKS[0].name;
  for (const r of RANKS) if (stars >= r.stars) name = r.name;
  return name;
}

/** Level 5 after roughly 30 minutes with a fighter, level 20 after roughly 8 hours. */
export function levelOf(xp: number): number {
  return Math.min(MAX_LEVEL, Math.floor(Math.sqrt(xp / 140)) + 1);
}

export function streakTitle(streak: number): string {
  for (const [n, title] of STREAKS) if (streak >= n) return title;
  return '';
}

function addBadge(p: Profile, badge: string): boolean {
  if (p.badges.includes(badge)) return false;
  p.badges.push(badge);
  return true;
}

/** What happened to the local player during one match. */
export class MatchTracker {
  roundStreak = 0;
  bestRoundStreak = 0;
  damageTaken = 0;
  lastWinPick: Gesture | null = null;
}

/** Apply one revealed round. Returns notices worth showing (level-ups, mastery). */
export function applyRound(
  p: Profile,
  t: MatchTracker,
  round: { pick: Gesture | null; won: boolean; damageTaken: number },
): string[] {
  const notices: string[] = [];
  t.damageTaken += round.damageTaken;
  if (round.won) {
    t.roundStreak += 1;
    t.bestRoundStreak = Math.max(t.bestRoundStreak, t.roundStreak);
    t.lastWinPick = round.pick;
  } else {
    t.roundStreak = 0;
  }
  notices.push(...dailyRound(p, round.pick, round.won, t.roundStreak));
  if (!round.pick) return notices;

  const f = p.fighters[round.pick];
  const before = levelOf(f.xp);
  f.throws += 1;
  f.xp += XP_PLAYED + (round.won ? XP_WON : 0);
  if (round.won) f.wins += 1;
  const after = levelOf(f.xp);
  if (after > before) notices.push(`${LABEL[round.pick]} reached level ${after}`);
  if (MASTERY_TIERS.includes(f.throws)) {
    const master = f.throws === 500;
    if (master) addBadge(p, `${LABEL[round.pick]} Master`);
    notices.push(master ? `${LABEL[round.pick]} Master badge earned` : `${f.throws} ${LABEL[round.pick]} throws`);
  }
  return notices;
}

/**
 * What one revealed round is worth to the local player's fighter, so the
 * points pop over the nameplate shows the same figure `applyRound` banks.
 */
export function roundPoints(pick: Gesture | null, won: boolean): number {
  if (!pick) return 0;
  return XP_PLAYED + (won ? XP_WON : 0);
}

/** Apply the end of a match. Returns summary lines for the result screen. */
export function applyMatchEnd(
  p: Profile,
  t: MatchTracker,
  result: 'win' | 'loss' | 'draw',
  finalHp: number,
): string[] {
  const lines: string[] = [];
  const rankBefore = rankOf(p.stars);
  p.matches += 1;

  if (result === 'win') {
    p.wins += 1;
    p.streak += 1;
    p.bestStreak = Math.max(p.bestStreak, p.streak);
    const gain = p.streak >= 3 ? 2 : 1;
    p.stars += gain;
    lines.push(`+${gain} star${gain > 1 ? 's' : ''}`);
    if (t.lastWinPick) {
      const f = p.fighters[t.lastWinPick];
      const before = levelOf(f.xp);
      f.xp += XP_MATCH_WINNER;
      if (levelOf(f.xp) > before) lines.push(`${LABEL[t.lastWinPick]} reached level ${levelOf(f.xp)}`);
    }
    if (t.damageTaken === 0) lines.push('PERFECT');
    else if (finalHp <= 20) lines.push('COMEBACK');
    if (t.bestRoundStreak >= 3) lines.push('MIND READER');
    const title = streakTitle(p.streak);
    if (title) lines.push(`${p.streak} in a row: ${title}`);
    if (p.streak >= 20 && addBadge(p, 'Legendary Streak')) lines.push('Legendary badge earned');
  } else if (result === 'loss') {
    if (p.streak >= 3) lines.push(`Streak of ${p.streak} ended`);
    p.streak = 0;
    if (p.stars > STAR_FLOOR) {
      p.stars -= 1;
      lines.push('-1 star');
    }
  }

  lines.push(...dailyMatch(p, result));
  const rankAfter = rankOf(p.stars);
  if (rankAfter !== rankBefore && p.stars >= (RANKS.find((r) => r.name === rankAfter)?.stars ?? 0) && result === 'win')
    lines.push(`Promoted to ${rankAfter}!`);
  lines.push(`${rankAfter}, ${p.stars} star${p.stars === 1 ? '' : 's'}`);
  return lines;
}

// ---------------------------------------------------------------- daily challenges

export type DailyId = 'win-rock' | 'win-paper' | 'win-scissors' | 'play' | 'win-match' | 'all-three' | 'streak';

export interface DailyItem {
  id: DailyId;
  goal: number;
  progress: number;
  done: boolean;
  /** For 'all-three': fighters already won with today. */
  seen?: Gesture[];
}

export interface DailyState {
  /** Local calendar day, YYYY-MM-DD. */
  date: string;
  items: DailyItem[];
  bonusGiven: boolean;
}

const DAILY_XP = 100;
const GESTURES: Gesture[] = ['rock', 'paper', 'scissors'];
const GENERAL: [DailyId, number][] = [
  ['play', 2],
  ['win-match', 1],
  ['all-three', 3],
  ['streak', 3],
];
const DAILY_TITLE: Record<DailyId, string> = {
  'win-rock': 'Win 3 rounds with Rock',
  'win-paper': 'Win 3 rounds with Paper',
  'win-scissors': 'Win 3 rounds with Scissors',
  play: 'Play 2 matches',
  'win-match': 'Win a match',
  'all-three': 'Win a round with every fighter',
  streak: 'Win 3 rounds in a row',
};

export function todayKey(d = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + m + '-' + day;
}

/** Make sure the profile holds today's three challenges (same set for everyone that day). */
export function ensureDaily(p: Profile, today = todayKey()): DailyState {
  if (p.daily && p.daily.date === today) return p.daily;
  let h = 7;
  for (let i = 0; i < today.length; i++) h = (h * 31 + today.charCodeAt(i)) >>> 0;
  const fighter = GESTURES[h % 3];
  const a = (h >>> 2) % GENERAL.length;
  const b = (a + 1 + ((h >>> 5) % (GENERAL.length - 1))) % GENERAL.length;
  const item = (id: DailyId, goal: number): DailyItem => ({ id, goal, progress: 0, done: false });
  p.daily = {
    date: today,
    items: [item(('win-' + fighter) as DailyId, 3), item(...GENERAL[a]), item(...GENERAL[b])],
    bonusGiven: false,
  };
  return p.daily;
}

/** "Win 3 rounds with Rock  1/3" or "... DONE". */
/** Challenge name only, without progress. */
export function dailyTitle(item: DailyItem): string {
  return DAILY_TITLE[item.id];
}

export function dailyLabel(item: DailyItem): string {
  return DAILY_TITLE[item.id] + (item.done ? '   DONE' : '   ' + item.progress + '/' + item.goal);
}

function finish(p: Profile, item: DailyItem, notices: string[]): void {
  if (item.done || item.progress < item.goal) return;
  item.done = true;
  // Reward: XP for the challenge's fighter, or the player's most-used fighter.
  const named = item.id.startsWith('win-') && item.id !== 'win-match' ? (item.id.slice(4) as Gesture) : null;
  const target = named ?? GESTURES.reduce((x, y) => (p.fighters[y].throws > p.fighters[x].throws ? y : x));
  p.fighters[target].xp += DAILY_XP;
  notices.push('Daily done: ' + DAILY_TITLE[item.id]);
  const d = p.daily!;
  if (!d.bonusGiven && d.items.every((i) => i.done)) {
    d.bonusGiven = true;
    p.stars += 1;
    notices.push('All daily challenges done: +1 star');
  }
}

function dailyRound(p: Profile, pick: Gesture | null, won: boolean, roundStreak: number): string[] {
  const notices: string[] = [];
  for (const item of ensureDaily(p).items) {
    if (item.done) continue;
    if (won && pick && item.id === 'win-' + pick) item.progress += 1;
    else if (item.id === 'all-three' && won && pick) {
      item.seen = item.seen ?? [];
      if (!item.seen.includes(pick)) item.seen.push(pick);
      item.progress = item.seen.length;
    } else if (item.id === 'streak') item.progress = Math.max(item.progress, Math.min(item.goal, roundStreak));
    finish(p, item, notices);
  }
  return notices;
}

function dailyMatch(p: Profile, result: 'win' | 'loss' | 'draw'): string[] {
  const notices: string[] = [];
  for (const item of ensureDaily(p).items) {
    if (item.done) continue;
    if (item.id === 'play') item.progress += 1;
    else if (item.id === 'win-match' && result === 'win') item.progress += 1;
    finish(p, item, notices);
  }
  return notices;
}