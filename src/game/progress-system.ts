import { createSystem } from '@iwsdk/core';
import { getGame } from './context.js';
import type { GameContext, LocalReveal } from './context.js';
import { claimAchievements } from './achievements.js';
import { applyMatchEnd, applyRound, MatchTracker, saveProfile } from './profile.js';

/**
 * Feeds round and match results into the device profile: fighter XP, gesture
 * mastery, win streaks, stars and match awards. The summary lines are shown
 * on the result screen by UiSystem.
 */
export class ProgressSystem extends createSystem({}) {
  private ctx!: GameContext;
  private tracker = new MatchTracker();

  init(): void {
    this.ctx = getGame(this.world);
    this.cleanupFuncs.push(this.ctx.events.on('reveal', (r) => this.onReveal(r)));
  }

  private onReveal(r: LocalReveal): void {
    const progress = this.ctx.progress;
    if (r.round === 1) {
      this.tracker = new MatchTracker();
      progress.lines = [];
    }
    const notices = applyRound(progress.profile, this.tracker, {
      pick: r.picks[0],
      won: r.winner === 0,
      damageTaken: r.damage[0],
    });
    if (r.gameOver) {
      const mine = r.hp[0];
      const theirs = r.hp[1];
      const result = mine > 0 && theirs <= 0 ? 'win' : theirs > 0 && mine <= 0 ? 'loss' : 'draw';
      // Achievements are claimed after the match counters have moved, so a
      // win that completes a ladder pays out on the same result screen.
      const earned = claimAchievements(progress.profile);
      progress.lines = [...applyMatchEnd(progress.profile, this.tracker, result, mine), ...earned, ...notices];
      this.report();
    } else if (notices.length) {
      progress.notice = notices[0];
      progress.noticeUntil = this.ctx.time + 4;
    }
    saveProfile(progress.profile);
  }

  /**
   * Tell the room server where this player now stands, for the shared board
   * behind the courtyard's Leaderboard panel.
   *
   * Fire and forget: the board is a nicety, and a player with no connection
   * still keeps every star locally. The server only ever raises a row, so a
   * stale or duplicated report cannot pull someone down.
   */
  private report(): void {
    const p = this.ctx.progress.profile;
    const name = this.ctx.match.names[0] || readName();
    if (!name) return;
    this.ctx.net.send({ type: 'score', name, stars: p.stars, wins: p.wins, streak: p.bestStreak });
  }
}

function readName(): string {
  try {
    return localStorage.getItem('hca.name') ?? '';
  } catch {
    return '';
  }
}
