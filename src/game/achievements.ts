import type { Profile } from './profile.js';

/**
 * Achievements: long-horizon goals that outlive a single match, and the one
 * place stars are earned outside winning.
 *
 * Pure data and rules with no engine imports, exactly like profile.ts, so the
 * panel, the notice line and any future server account all read the same
 * answers. Two ladders for now: hot streaks, and total wins.
 */

/** Where an achievement reads its progress from. */
export type Track = 'streak' | 'wins';

export interface Achievement {
  id: string;
  /** Short name, shown large on the card. */
  title: string;
  /** What it takes, in words. */
  detail: string;
  track: Track;
  goal: number;
  /**
   * Stars added to the player's rank the first time it is earned.
   *
   * Deliberately steep at the top: a streak of 20 is worth more than four
   * streaks of 5, or the ladder gives no reason to push past the first rung.
   */
  stars: number;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'streak-5', title: 'On Fire', detail: 'Win 5 matches in a row', track: 'streak', goal: 5, stars: 2 },
  { id: 'streak-10', title: 'Unstoppable', detail: 'Win 10 matches in a row', track: 'streak', goal: 10, stars: 4 },
  { id: 'streak-15', title: 'Untouchable', detail: 'Win 15 matches in a row', track: 'streak', goal: 15, stars: 7 },
  { id: 'streak-20', title: 'Legendary', detail: 'Win 20 matches in a row', track: 'streak', goal: 20, stars: 12 },
  { id: 'wins-10', title: 'Regular', detail: 'Win 10 matches', track: 'wins', goal: 10, stars: 2 },
  { id: 'wins-20', title: 'Seasoned', detail: 'Win 20 matches', track: 'wins', goal: 20, stars: 4 },
  { id: 'wins-30', title: 'Veteran', detail: 'Win 30 matches', track: 'wins', goal: 30, stars: 7 },
];

/**
 * How far along this achievement the player is, capped at its goal.
 *
 * Streaks read `bestStreak`, not the live one: an achievement already earned
 * must not un-earn itself the moment the run ends.
 */
export function progressOf(p: Profile, a: Achievement): number {
  const raw = a.track === 'streak' ? p.bestStreak : p.wins;
  return Math.min(raw, a.goal);
}

export function isEarned(p: Profile, a: Achievement): boolean {
  return progressOf(p, a) >= a.goal;
}

export function earnedCount(p: Profile): number {
  return ACHIEVEMENTS.filter((a) => isEarned(p, a)).length;
}

/** Stars this player has banked from achievements, for the panel's total. */
export function achievementStars(p: Profile): number {
  return ACHIEVEMENTS.filter((a) => (p.claimed ?? []).includes(a.id)).reduce((n, a) => n + a.stars, 0);
}

/**
 * Pay out any achievement earned since the last call and return notices for
 * the result screen.
 *
 * Claiming is recorded on the profile rather than recomputed, so the stars are
 * granted exactly once however the thresholds are later re-tuned. Called at
 * the end of a match, after the win and streak counters have moved.
 */
export function claimAchievements(p: Profile): string[] {
  const claimed = (p.claimed ??= []);
  const lines: string[] = [];
  for (const a of ACHIEVEMENTS) {
    if (claimed.includes(a.id) || !isEarned(p, a)) continue;
    claimed.push(a.id);
    p.stars += a.stars;
    lines.push(`${a.title} unlocked  +${a.stars} stars`);
  }
  return lines;
}
