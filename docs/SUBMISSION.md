# HotHandZ — submission checklist

Ordered by what blocks what. Everything in P0 is a hard blocker: the game
cannot be played by a judge until all of it is done.

I don't know this competition's own rules. Map its stated requirements onto
this list before trusting it — there may be deliverables here that nothing
below covers (video, written entry, deadline format, team details).

---

## P0 — nothing can be submitted without these

- [x] ~~**Make this a git repository and push it.**~~ Done — pushed to
      <https://github.com/9ineart/HotHandZ>, 169 files, 10.19 MB.
- [ ] **Confirm the repo's visibility matches the competition's rules.** Most
      require a public repo. The commit was scanned for credentials and
      personal data before pushing and came back clean, so opening it up is
      safe, but check what they actually ask for.
- [ ] **Get a domain name.** The page is HTTPS, so the socket must be `wss://`,
      which needs a certificate, which is never issued for a bare IP. Without
      a hostname there is no deployment. This is the long-lead item if you
      don't already own one.
- [ ] **Create the Azure account and the B1s VM** — `docs/DEPLOY.md`.
- [ ] **Deploy the room server** and confirm `curl https://rooms.yourdomain.com`
      returns the health line over https.
- [ ] **Build the front end with the socket URL baked in** and deploy `dist/`.
      `VITE_HCA_SERVER_URL` is read at build time; setting it afterwards does
      nothing.
- [ ] **Play it on a real Quest.** This has never been done. Every check so far
      has been the flat desktop view or the IWER emulator — which cannot prove
      hand tracking, gesture recognition, passthrough, table calibration,
      comfort, or frame rate. Budget real time here; it is the step most
      likely to produce surprises.

## P1 — asked for, not built

Both need a file from you before I can do anything.

- [ ] **Background music, 2–3 tracks.** There is no audio pipeline at all:
      `sfx.ts` synthesises every sound from oscillators and the project
      contains no audio files. Supply licensed tracks and the music bus,
      looping, state-based switching and a volume row in the sound panel can
      be built around them.
- [ ] **HotHandZ logo in the centre of the field.** No logo or brand asset
      exists in the repo. A PNG or SVG can be placed as a texture on the arena
      floor. Without one the best available is a wordmark built from text.

## P2 — known defects

- [ ] **Name field keeps its old value after you tap it.** The box renders
      empty but the stored name is still there, so typing appends: renaming
      from "test" to "Nayin" produced **"testNayin"**. Confirmed in the running
      app.
- [ ] **Name field loses focus silently.** After a short burst of typing,
      further keystrokes and backspace did nothing; a snapshot confirmed focus
      had dropped with no visual cue. Both of these were found with a desktop
      keyboard — check the XR virtual-keyboard path too, it may differ.
- [ ] **Verify the hand menu during calibration.** The gate was changed so the
      menu is available before the battlefield is placed, but it is XR-only by
      design and has not been seen working. Needs a headset or an emulated
      session with tracked hands.
- [ ] **Investigate scoreless rounds.** In a full simulated match, rounds 7, 8
      and 9 passed with no damage to either side after a legitimate clash in
      round 6. Could be a run of draws; could be picks not landing.

## P3 — submission hygiene

- [ ] **Add a web app manifest and icons.** There are none. `index.html` has
      `<link rel="icon" href="data:," />`, an empty placeholder. A valid Web
      App Manifest on a public HTTPS URL is a prerequisite for PWA install and
      for Bubblewrap / Horizon Store packaging, so this is a blocker *if* the
      competition wants an installable app or an APK rather than a URL.
- [x] ~~**Rewrite README.md.**~~ Done — rewritten while resolving the merge
      conflict against the README GitHub generated.
- [ ] **Fix or remove `npm run test:logic`.** It runs `node --test test/` and
      there is no `test/` directory, so it fails outright.
- [ ] **Add a LICENSE** if the competition requires one.
- [ ] **Check asset licensing.** `public/models/` ships `courtyard.glb`,
      `Stage 1.glb` and the three hand models. Confirm each is cleared for
      competition use and credit them if required.

---

## Already done

- [x] Gameplay does not start until the player picks a mode
- [x] Points animation on a won round
- [x] Onboarding copy, left-aligned training text, Today's Challenges removed
- [x] Hover and click sounds on every button
- [x] Fire bursts around the round's loser, after the particle blast
- [x] Corner-radius pass across all nine panels
- [x] Countdown runs 5-4-3-2-1, with the fists chopping on every beat
- [x] Renamed to HotHandZ everywhere in the UI
- [x] Stray Visual Studio `.vs` folder removed from `public/` and the build
- [x] `ws` moved to `dependencies` — a production install would have crashed
- [x] Name entry confirmed working end to end, despite the defects above
- [x] 410 MB of unreferenced models deleted — one of them was 151 MB, over
      GitHub's hard per-file limit, so the push would have been rejected. The
      build went from 422.8 MB to 12.6 MB.
