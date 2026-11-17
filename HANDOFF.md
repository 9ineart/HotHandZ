# Hand Clash Arena: handoff to Claude Code

The first build was done in a cloud session that couldn't run anything on this
PC. The code below **typechecks and `npm run build` passes**. It has **not yet
been run in a browser, in the IWER emulator, or on a Quest**.

## First steps in Claude Code

1. `npm install` (adds `ws` and `@types/ws` for the room server).
2. Delete the unused starter files, which nothing imports any more:
   `src/robot.ts`, `src/robot-component.ts`, `src/panel.ts`,
   `src/scene-assets/decor.scene-asset.ts`, `src/scene-assets/studio.scene-asset.ts`,
   `public/ui/welcome.uikitml`, `public/ui/label-*.uikitml`, `public/audio/chime.mp3`.
3. `npm run typecheck`, then `npm run dev`. Verify in the managed browser:
   - On desktop the arena forms on a virtual table automatically (press `C` to re-place it).
   - Create Room shows a 4-digit code. Open a second browser tab and use Join Room + keypad.
   - In a match, the keys `1`/`2`/`3` (or `R`/`P`/`S`) throw Rock/Paper/Scissors.
4. Then test in XR with IWER hand mode, and on a Quest via `iwsdk-native-xr-test`.

## Verified in Claude Code (2026-11-10)

- Steps 1-3 above are done (deps installed, starter files removed).
- Fixed: the arena floor shader used `half` (a reserved GLSL word) as a
  variable name, so it failed to compile. It is renamed in `src/game/fx.ts`.
- Desktop run in the managed browser: the arena forms, Create Room gives a code,
  and a full match plays out against `scripts/rival-bot.mjs`. That covered
  clash damage, the no-show penalty, HP sync, the VICTORY HUD and the Rematch
  button. There were no console errors, and `npm run build` passes.
- Solo testing: `node scripts/rival-bot.mjs join <code> [--pick rock|paper|scissors|random]`.

- IWER (emulator) hand mode: both palms flat filled the rings and formed the
  arena. Fist, open hand and peace sign were classified as Rock, Paper and
  Scissors in a live match. Ray-and-pinch on the lobby button created a room.
- Fixed: after calibration finished with the palms still down, it restarted
  every 4 s. It now waits for the hands to lift (`needLift`).
- Fixed: the lobby hid the "place both palms" guidance while you were in a
  room, and a stale "rival left" message overrode it.

- Added: **Practice vs AI rival**. The room server seats a virtual player
  (`AI_PLAYER` in `server/rooms.mjs`) that is always ready, locks a hidden pick
  0.9â€“3.3 s into each choose window (`aiChoose`: mostly random, 40% chance to
  counter your recent favourite) and accepts rematches. The HUD labels it
  "AI RIVAL". Verified on desktop, and in IWER with hands (button poked before
  calibration, then rounds played with hand gestures).

- Fighters are now hand sculptures (`src/scene-assets/heroes.scene-asset.ts`,
  built by `hand-kit.ts` with procedural `DataTexture`s in `hand-materials.ts`):
  Rock = stone fist (`hca-rock-fist`), Paper = paper open hand with orbiting
  cards (`hca-paper-hand`), Scissors = brushed-steel peace sign
  (`hca-scissors-hand`; ArmR/ArmL are the index/middle fingers and snip about Z).
  Internal kinds stay `titan` / `mystic` / `assassin` for the wire protocol and
  ECS; display names are in `HERO_LABEL`.

- Onboarding now follows the user's 5-screen reference flow (its sequence, not
  its art or branding): 1 name (UIKit `Input`, Shuffle for generated names,
  saved as `hca.name`) â†’ 2 consent ("I agree" + Start launches AR; Skip = desktop
  mode) â†’ 3 "Raise your hand to join us" â†’ 4 "Make a rock/paper/scissors" with a
  large demo hand (`DemoHandSystem`) and Skip tutorial â†’ place the battlefield â†’
  5 "We're looking for a challenger" (server `quick` matchmaking; an AI rival
  steps in after 15 s). Private rooms and AI are under "Play a friend". Entering
  AR via the browser's own XR button skips steps 1â€“2 automatically.
- Names travel to the server (`create`/`join`/`quick` carry `name`) and appear
  on the HUD. `node scripts/rival-bot.mjs quick` tests matchmaking.

## Still to do / unverified

- FIXED (root cause): `@pmndrs/pointer-events` only emits `click` when the
  release comes within 300 ms of the press (`clickThresholdMs`). Hand pokes and
  pinches routinely take longer, especially once the arena makes frames slower,
  so buttons felt dead in XR. `UiSystem.press()` now fires on pointerdown +
  pointerup on the same element, whatever the duration. Don't go back to
  `addEventListener('click')` for spatial buttons.
- New flow: Welcome (Learn the gestures / Skip tutorial) â†’ 5-step tutorial
  (hand presses, Rock, Paper, Scissors with live recognition, round rules; each
  gesture completes after a 0.6 s hold; Skip available on every step;
  remembered in localStorage `hca.tutorialDone`) â†’ place the battlefield â†’
  mode menu (Practice vs AI / Create / Join / How to play) â†’ match.
  Verified in IWER with emulated hands, end to end.

- Fixed: hand poke on Create Room. Before calibration the lobby spawned
  *behind* the player, because `getWorldDirection` on the head returns its look
  direction. After calibration it sat too low (~0.2 m above the table) to take
  pokes. It is now 0.4 m up. Poke works in IWER both before and after
  calibration. Confirm on a real Quest.
- Classifier thresholds have only been checked against IWER's canned poses.
  Tune them on real hands.

- Panel scale and placement (`public/scenes/main.iwsdk.scene.json` node scale
  0.075/0.07, `ui-system.ts` placement). This needs a visual check.
- The gesture classifier thresholds (`EXTENDED`/`CURLED` in `src/game/gestures.ts`)
  and palm-flat detection (`isPalmFlatDown`) need tuning on a real Quest.
- There's no automated test yet. Suggested: unit-test `classifyGesture` with
  synthetic joint data and `resolveRound` from `server/rooms.mjs`.
- Hosting: the room server runs inside the Vite dev/preview server at
  `wss://<host>/hca-ws`. For a deployed build, run `npm run server` somewhere and
  set `VITE_HCA_SERVER_URL`.

## Architecture

| File | Role |
| --- | --- |
| `server/rooms.mjs` | Authoritative room server: 4-digit codes, hidden picks, round timer, damage, rematch. A Vite plugin (`handClashRooms`) or standalone. |
| `src/game/core-system.ts` | Creates the shared `GameContext` (`context.ts`): hand tracker, particle pool, net client. |
| `src/game/hands.ts`, `joints.ts` | Reads WebXR hand joints into world-space buffers each frame. |
| `src/game/gestures.ts` | Classifies Rock/Paper/Scissors from finger straightness and debounces with `GestureLatch`. |
| `src/game/calibration-system.ts` | Detects both palms held flat for 4 s. Rings fill, expand and merge into the arena boundary, which is fitted to a detected plane when one is available. Ends with a particle dissolve and an XR anchor. |
| `src/game/match-system.ts` | Mirrors server state from the local player's perspective, runs the countdown and locks in gestures (keyboard fallback). |
| `src/game/combat-system.ts` | Summons the heroes and plays each attack: Titan leap-slam with shockwave, Mystic shield plus an orb volley, Assassin dash-strike with trails. Also handles hits, HP bars, cores, defeat and victory. |
| `src/game/ui-system.ts` | Lobby panel (create/join keypad) and match HUD, parked behind the far edge of the arena. |
| `src/scene-assets/arena.scene-asset.ts`, `heroes.scene-asset.ts` | Procedural holographic arena and the hero miniatures. |
| `src/game/fx.ts`, `sfx.ts` | Particle pool, holographic shaders and synthesized sound effects. |

Rules (in `server/rooms.mjs` `RULES`): 100 HP. Titan 30 damage, Assassin 25,
Mystic 20. A losing Mystic's shield blocks 5. A player who doesn't choose in
time takes 20. Each round is a 3.6 s countdown, then a 6 s window to choose.

## 2026-11-11

- Design lives in docs/DESIGN.md (agreed). Selection cards (src/game/card-system.ts) and the athlete re-skin are built; magic effects (summon beams, Paper shield and orbs, orbiting cards) are removed. Paper attacks with Palm Push; fighters hop in from their own edge.
- Not yet built from the MVP list: crowd audio, draw hype, streaks and awards, device profile, daily challenges, victory share moment.

- Device profile (src/game/profile.ts, localStorage key hca.profile.v1) and ProgressSystem are built: stars and rank, per-fighter XP and levels, gesture mastery, win streak titles, match awards (Perfect, Comeback, Mind Reader). Upset award, streak hand glow and level unlocks are not built.

- Daily challenges built (rules at the end of src/game/profile.ts): three per local day, same set for everyone, shown on the matchmaking and menu screens. 100 XP each, +1 star for all three. A Leave button on the result screen returns to matchmaking. Weekly and seasonal challenges are not built.

- Stage 1.glb registered as 'hca-stage-1' (background priority) and spawned by src/game/stage-system.ts as a child of ArenaRoot, visible only during a live match. Inverted so the peak hangs below the floor; SPREAD/FLATTEN/SINK constants tune the fit.


## Viewer-anchored panels and the three-count (2026-11-12)

`src/game/arena-view.ts` places the HUD, lobby and both fighter cards against
where the player is standing rather than the arena yaw fixed at calibration.
The HUD sits across the arena facing you; the cards flank it, yours on your
left. Walk round the table and they follow. Yaw is quantised to ~15 steps per
turn so small head movements do not re-place them every frame.

`CombatSystem` now spawns two fists on the pads at the start of each countdown
(`prep` rigs) that chop on the beat -- the real-life shake -- and dissolve when
the throw window opens. `PUMPS` and `PUMP_RISE` tune it.


## Frozen panel anchors, forfeit and End game (2026-11-12)

Panels no longer follow the head. They are still placed from the viewer's
direction, but only once: the HUD and lobby re-place when the arena moves or
when the other panel takes over (`showing` in the `UiSystem.place` key), and
the cards only when the arena moves. The `visibilityState` subscription
deliberately no longer clears `placedFor` -- a blur and focus round trip was
re-anchoring parked panels to wherever the player had since moved.

Forfeit: `forfeit-button` on the HUD during countdown/choose/reveal. One press
arms it for `FORFEIT_ARM` seconds (label becomes "Yes, forfeit", a "Keep
playing" button appears, the sub line warns); a second press sends
`{type:'forfeit'}`. `Room.forfeit(seat)` in server/rooms.mjs drops that seat's
HP to zero, sets the other as winner and records `forfeitBy`, broadcast as
`forfeit` on the state message and mapped to `match.forfeitedBy` (local
perspective). Gameover then reads FORFEIT rather than DEFEAT.

End game: `quit-button` in the lobby on the matchmaking and room-menu screens.
Leaves the room, calls `world.exitXR()` and moves to the new `ended` stage --
a sign-off screen with the rank line and a "Play again" button. The page stays
loaded; a web app cannot close its own tab.

## UIKitML trap (2026-11-12)

`/* */` comments inside a UIKitML `<style>` block are not stripped. The parser
folds the comment into the next selector and rejects it, the asset fails to
parse, `LevelSystem` throws, and the app renders a black screen with no scene
at all. Put explanations in the HTML comment above `<style>`. Also recorded in
.claude/rules/uikitml.md.
