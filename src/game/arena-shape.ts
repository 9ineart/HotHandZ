/**
 * The arena's proportions, taken from the courtyard's real tiled deck.
 *
 * Not from the courtyard object's bounding box. That box is 1.6 x 2.1, but
 * only about 71% of it is tile: the water channel, the altar island and the
 * bridges occupy the southern third, and there are raised borders along the
 * sides and the north end. Sizing the play area to the box put the local
 * player's pad, core and fighter directly over open water.
 *
 * The figures below come from ray casting a grid down onto the model and
 * growing the largest solid-tile rectangle symmetric about x=0:
 *
 *   deck      1.56 wide x 1.2923 deep, centred at y = +0.2019
 *   aspect    0.8284 (wider than deep)
 *
 * They are then pulled in slightly, because the sample grid was about 2 cm
 * and the play area should sit inside the deck rather than flush to its rim,
 * leaving a visible tile border around the fight.
 *
 * Dependency-free on purpose: the ECS component declarations import these for
 * their defaults, and must stay clear of renderer and system imports.
 */

/** Usable deck in model units, inset from the measured 1.56 x 1.2923. */
export const DECK_WIDTH = 1.52;
export const DECK_DEPTH = 1.26;

/**
 * Deck centre along the model's depth axis, in model units, measured from
 * the courtyard object's own centre. Positive is away from the player, so
 * StageSystem shifts the set toward the player by this much to bring the
 * deck's middle onto the arena origin.
 */
export const DECK_CENTER = 0.2019;

/** depth / width. Wider than deep, as the deck is. */
export const ARENA_ASPECT = DECK_DEPTH / DECK_WIDTH;

/** Default width in metres, used on desktop and before any table fit. */
export const ARENA_W = 0.44;
export const ARENA_D = ARENA_W * ARENA_ASPECT;

/** Width limits. Depth follows from the aspect. */
/**
 * The courtyard's water channel, in the model's own units, measured from the
 * POSITION accessor bounds in `public/models/courtyard.glb`.
 *
 * It runs the full width of the set across the player's end, starting where
 * the usable tile stops. `WATER_FAR_Z` is its edge nearest the player -- the
 * stone the kiosk stands on. Convert either to arena metres with
 * `(z + DECK_CENTER) * (arenaWidth / DECK_WIDTH)`, the same shift and scale
 * StageSystem applies to the set itself.
 */
export const WATER_NEAR_Z = 0.4399;
export const WATER_FAR_Z = 1.05;

export const ARENA_W_MIN = 0.34;
export const ARENA_W_MAX = 0.56;

/**
 * Largest aspect-correct arena inside a table's usable extents.
 *
 * Width binds first now that the arena is wider than it is deep, but both are
 * checked so a shallow table still shrinks the whole thing rather than
 * squashing it out of shape.
 */
export function fitArena(maxWidth: number, maxDepth: number): { w: number; d: number } {
  const byDepth = maxDepth / ARENA_ASPECT;
  const w = Math.min(ARENA_W_MAX, Math.max(ARENA_W_MIN, Math.min(maxWidth, byDepth)));
  return { w, d: w * ARENA_ASPECT };
}
