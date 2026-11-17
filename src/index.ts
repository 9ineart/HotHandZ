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
});
