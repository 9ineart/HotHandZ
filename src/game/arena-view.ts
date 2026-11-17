import type { Vector3 } from '@iwsdk/core';
import type { GameContext } from './context.js';

/**
 * Where the player is standing relative to the arena.
 *
 * Panels and cards used to be pinned to the arena's own yaw, fixed at
 * calibration. Walk round the table and they turned away from you, or left the
 * view entirely. These helpers place them against the viewer instead, so the
 * HUD always sits across the battlefield facing you and the cards always flank
 * it, from wherever you happen to be standing.
 *
 * Nothing here allocates: callers pass in the vectors to fill.
 */

/**
 * Unit direction from the arena centre to the player's head, flattened to the
 * horizontal plane. Falls back to the arena's own forward when the head is
 * directly above the centre.
 */
export function viewDir(ctx: GameContext, head: Vector3, out: Vector3): Vector3 {
  const c = ctx.arena.center;
  out.set(head.x - c.x, 0, head.z - c.z);
  if (out.lengthSq() < 1e-6) out.set(Math.sin(ctx.arena.yaw), 0, Math.cos(ctx.arena.yaw));
  return out.normalize();
}

/**
 * Yaw that turns a panel's +Z face toward the player. UIKitML panels are
 * single-sided and face +Z, so there is no 180-degree term here.
 */
export function faceYaw(dir: Vector3): number {
  return Math.atan2(dir.x, dir.z);
}

/**
 * Distance from the arena centre to its boundary along `dir`, treating the
 * footprint as an ellipse through the rectangle's edge midpoints. A square
 * radius would push content off the long sides and bury it in the short ones.
 */
export function edgeRadius(ctx: GameContext, dir: Vector3, margin: number): number {
  const a = (dir.x * ctx.arena.width) / 2;
  const b = (dir.z * ctx.arena.depth) / 2;
  return Math.hypot(a, b) + margin;
}
