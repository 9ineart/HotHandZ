/**
 * The two players' identity colours, in one place.
 *
 * Index 0 is always the local player ("you") and 1 the rival, matching the
 * `[me, rival]` ordering used throughout MatchView. Every surface that says
 * whose something is -- the HUD bars, the fighter cards, the spawn rings, the
 * fighters' own gloves -- reads from here, so a hand on the table and a bar in
 * the HUD are never two different shades of the same idea.
 *
 * Dependency-free on purpose: ECS component declarations and the asset
 * manifest both import it, and neither may pull in a system or the renderer.
 */

/** Mint for you, amber for the rival. */
export const PLAYER_COLOR = ['#70e9d0', '#ffb56e'] as const;

/**
 * Darker companions for coloured *text* on the cards' near-white stock, where
 * the colours above are too light to read. Same hue, enough contrast to pass.
 */
export const PLAYER_INK = ['#0e7a65', '#9c530b'] as const;

/** Ink that reads on a player-coloured block, which is light in both cases. */
export const PLAYER_ON_COLOR = '#202b3b';
