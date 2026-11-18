# HotHandZ — submission checklist

Ordered by what blocks what. Everything in P0 is a hard blocker: the game
cannot be played by a judge until all of it is done.

**What the competition actually requires.** In the organisers' own deployment
talk ([XR Bootcamp, with Felix — IWSDK tech lead at Meta — and Jimmy of Meta
Reality Labs](https://www.youtube.com/watch?v=4ioRoWZR0AM)), Felix is explicit
at 0:18: the only deployment requirement is *"a link that's easily accessible,
that's public… to users and judges, and that's it"*, and any existing workflow
is fine. Both presenters state that the PWA/APK and Horizon Store path is **not
required** — Jimmy repeats it at 11:29 before his section.

That link exists and works: <https://hothandz.nineart.studio>. So the remaining
work is the game itself, not the plumbing.

There may still be deliverables this list does not cover — a video, a written
entry, team details, the submission form itself. Check those separately.

---

## P0 — nothing can be submitted without these

- [x] ~~**Make this a git repository and push it.**~~ Done — pushed to
      <https://github.com/9ineart/HotHandZ>, 169 files, 10.19 MB.
- [ ] **Confirm the repo's visibility matches the competition's rules.** Most
      require a public repo. The commit was scanned for credentials and
      personal data before pushing and came back clean, so opening it up is
      safe, but check what they actually ask for.
- [x] ~~**Get a domain name.**~~ Done — `hothandz.nineart.studio`.
- [x] ~~**Create the Azure account.**~~ Done.
- [x] ~~**Create the VM.**~~ Done — `Standard_B2ats_v2` in `swedencentral`
      (B1s is restricted on this subscription in most regions), static IP
      `20.240.138.82`, ports 22/80/443 only.
- [x] ~~**Point DNS at the VM.**~~ Done — `hothandz.nineart.studio` and the
      `www` form both resolve to it.
- [x] ~~**Deploy the game and the room server.**~~ Done. Verified from outside:
      `200` over HTTPS with a valid Let's Encrypt certificate, `<title>HotHandZ`,
      the JS bundle (2.5 MB), `courtyard.glb`, the UIKitML panels and the scene
      JSON all serving, and `/hca-ws` reaching the room server through Caddy.
- [ ] **Play a full match on the deployed site**, in a browser and then on the
      Quest. Everything above proves it is served correctly; none of it proves
      the game plays.
- [ ] **Play it on a real Quest.** This has never been done. Every check so far
      has been the flat desktop view or the IWER emulator — which cannot prove
      hand tracking, gesture recognition, passthrough, table calibration,
      comfort, or frame rate. Budget real time here; it is the step most
      likely to produce surprises.

## P1 — asked for, not built

Both need a file from you before I can do anything.

- [x] ~~**Background music, 2–3 tracks.**~~ Done — three tracks, shuffled,
      starting once the battlefield is placed. They ride a `music` bus in the
      existing WebAudio graph, so the master level and the mute switch govern
      them, and the sound panel has its own Music row (40% by default). The
      supplied 134 MB of 24-bit WAV was transcoded to loudness-matched Ogg
      Vorbis — 6.1 MB for all three, build 12.6 → 18.7 MB.
- [ ] **HotHandZ logo in the centre of the field.** No logo or brand asset
      exists in the repo. A PNG or SVG can be placed as a texture on the arena
      floor. Without one the best available is a wordmark built from text.

## P2 — known defects

- [x] ~~**Name field defects.**~~ Fixed and verified in the running app. The
      field was controlled, writing its value back on every keystroke, which
      rebuilt the component's whole reactive property set mid-typing; it is
      now uncontrolled. The apparent "appending" was the remembered name with
      a caret after it, so the first focus now selects that text and the first
      keystroke replaces it. `readName` also read a property that does not
      exist, silently skipping the trim and the 16-char cap on every call.
      Still worth checking the XR virtual-keyboard path on device.
- [ ] **Verify the hand menu during calibration.** The gate was changed so the
      menu is available before the battlefield is placed, but it is XR-only by
      design and has not been seen working. Needs a headset or an emulated
      session with tracked hands.
- [ ] **Investigate scoreless rounds.** In a full simulated match, rounds 7, 8
      and 9 passed with no damage to either side after a legitimate clash in
      round 6. Could be a run of draws; could be picks not landing.

### Not a defect — the consent checkbox

Automated clicks on it did not register on the live site, which looked like a
hit-target bug that would strand a judge on the first screen. It is not: the
developer clicked it by hand in the same browser and it worked.

The panel is UIKit geometry in the 3D scene, not DOM, so a click has to be
resolved by a raycast through the pointer. A real mouse moves the pointer and
produces a tracked ray; a synthetic click at a screenshot coordinate does not
reliably produce one that lands on a 34px box. The box and the "I agree" label
are both bound (`ui-system.ts`), so the real hit area is wider than the square.

**Generalise this: synthetic clicks are not evidence about UIKit panels.** When
one looks unresponsive under automation, read the code or ask for a human click
rather than concluding the UI is broken.

## P3 — submission hygiene

- [x] ~~**Add a web app manifest and icons.**~~ Done and live — manifest serves
      as `application/manifest+json`, with a generated icon set.
- [x] ~~**Rewrite README.md.**~~ Done — rewritten while resolving the merge
      conflict against the README GitHub generated.
- [ ] **Fix or remove `npm run test:logic`.** It runs `node --test test/` and
      there is no `test/` directory, so it fails outright.
- [ ] **Add a LICENSE** if the competition requires one.
- [ ] **Check asset licensing.** `public/models/` ships `courtyard.glb`,
      `Stage 1.glb` and the three hand models. Confirm each is cleared for
      competition use and credit them if required.

---

## Parked — Horizon Store APK

Deliberately stopped, because the organisers say it is not required and the
remaining work is in the game. Everything below already works, so picking this
back up after the deadline is cheap. Full procedure in
[DEPLOY.md](DEPLOY.md) and the `iwsdk-pwa-packaging` skill.

Done and verified:

- Manifest and icons live on the domain, correct content type
- Auto-enter XR in `src/index.ts`, gated on `getDigitalGoodsService`, requesting
  `immersive-ar` to match `iwsdk.config.json`
- `twa/twa-manifest.json` — package `studio.nineart.hothandz`,
  `isMetaQuest: true`, `horizonOSAppMode: "immersive"`, `enableXRScene: true`
- Keystore at `~/keys/hothandz.keystore`, alias `hothandz`, outside the repo
- Android project generates; `USE_SCENE` and `HAND_TRACKING` permissions confirmed
  in the generated `AndroidManifest.xml`
- JDK 17 (Temurin) and the Android SDK wired into `~/.bubblewrap/config.json`
- build-tools `34.0.0` and platform `android-32` installed — the two things
  bubblewrap needs and the SDK lacked

Remaining, in order:

- [ ] `bubblewrap build` with `BUBBLEWRAP_KEYSTORE_PASSWORD` and
      `BUBBLEWRAP_KEY_PASSWORD` set
- [ ] `bubblewrap fingerprint add` to generate `.well-known/assetlinks.json`,
      then deploy it — **the TWA will not launch until that file is live**
- [ ] `adb install -r app-release-signed.apk`, launch from the Library
- [ ] Horizon App ID and secret, accept the Developer Distribution Agreement,
      upload with `ovr-platform-util`

Two traps worth remembering. Bubblewrap's own JDK download fetches the OpenJDK
**source tree**, which has no `keytool`; and the command-line tools it installs
are from 2020 and their `sdkmanager` needs `javax.xml.bind`, removed in Java 11.
Both are worked around above — don't let it install either.

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
