import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { CalibrationSystem } from './game/calibration-system.js';
import { CardSystem } from './game/card-system.js';
import { CombatSystem } from './game/combat-system.js';
import { CoreSystem } from './game/core-system.js';
import { DemoHandSystem } from './game/demo-hand-system.js';
import { GestureFxSystem } from './game/gesture-fx-system.js';
import { MatchSystem } from './game/match-system.js';
import { PlateSystem } from './game/plate-system.js';
import { ProgressSystem } from './game/progress-system.js';
import { StageSystem } from './game/stage-system.js';
import { KioskSystem } from './game/kiosk-system.js';
import { UiSystem } from './game/ui-system.js';

World.create(
  document.getElementById('scene-container') as HTMLDivElement,
  projectOptions,
).then((world) => {
  // Order matters: CoreSystem refreshes hand tracking before anyone reads it.
  world.registerSystem(CoreSystem);
  world.registerSystem(CalibrationSystem);
  world.registerSystem(MatchSystem);
  world.registerSystem(CombatSystem);
  world.registerSystem(UiSystem);
  world.registerSystem(DemoHandSystem);
  world.registerSystem(CardSystem);
  world.registerSystem(PlateSystem);
  world.registerSystem(GestureFxSystem);
  world.registerSystem(ProgressSystem);
  world.registerSystem(StageSystem);
  world.registerSystem(KioskSystem);

  // Installed as a Horizon Store app there is no 2D page to press, so nothing
  // would ever ask for a session: tapping the app icon is the user activation,
  // and the app has to spend it itself or it opens to a loading screen and
  // stops there.
  //
  // `getDigitalGoodsService` exists only inside an installed PWA, so a browser
  // tab skips this and keeps its ordinary Enter XR button. That also means this
  // path cannot be exercised on desktop or in the emulator -- it is only real
  // once the APK is sideloaded onto a headset.
  //
  // 'immersive-ar' because iwsdk.config.json sets xr.mode to "ar": this game is
  // played on your own table through passthrough, not inside a virtual room.
  const nav = navigator as Navigator & {
    xr?: { isSessionSupported?: (mode: string) => Promise<boolean> };
  };
  if ('getDigitalGoodsService' in window && nav.xr?.isSessionSupported) {
    nav.xr
      .isSessionSupported('immersive-ar')
      .then((supported) => {
        // launchXR is IWSDK's requestSession plus its session wiring; calling
        // navigator.xr.requestSession directly would skip that setup.
        if (supported) world.launchXR();
      })
      .catch(() => {});
  }
});
