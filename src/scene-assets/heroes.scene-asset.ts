import { Group } from '@iwsdk/core';
import type { Material, Mesh } from '@iwsdk/core';
import { addEmptyPivots, buildHand, exposeFingerPivot } from './hand-kit.js';
import type { FingerPose, HandPose } from './hand-kit.js';
import { bevelBox } from './lib/hardsurface.js';
import { lathe, mesh, std, torus } from './kit.js';

/**
 * The three fighters: athlete hands (~8-11 cm tall) on corner podiums.
 * Origin is the floor contact point, +Z faces the opponent once placed.
 *
 *   ROCK      heavyweight: red boxing glove, white cuff, championship belt
 *   PAPER     tactician: white glove, blue sleeve, wrist tape, captain's armband
 *   SCISSORS  speed fighter: green glove, black sleeve, sweatband, taped fingers
 *
 * Rig contract used by the combat animator:
 *   Body            whole hand, pivot at the wrist base
 *   ArmL / ArmR     scissors: middle / index finger pivots (snip about Z);
 *                   rock and paper: empty pivots
 *
 * The stone / paper / steel looks in hand-materials.ts are kept for future
 * unlockable skins.
 */

const podium = std('#22262b', { metal: 0.3, rough: 0.6 });
const white = std('#f3efe6', { metal: 0, rough: 0.85 });
const black = std('#15181c', { metal: 0.1, rough: 0.7 });
const gold = std('#e8b93a', { metal: 0.9, rough: 0.3 });

const rockGlove = std('#c8261c', { metal: 0.05, rough: 0.35 });
const rockTrim = std('#7d120d', { metal: 0.05, rough: 0.45 });
const paperGlove = std('#f7f4ec', { metal: 0, rough: 0.8 });
const paperSleeve = std('#2b7fd9', { metal: 0, rough: 0.7 });
const captain = std('#ffd23f', { metal: 0, rough: 0.6 });
const scissorsGlove = std('#1fa866', { metal: 0, rough: 0.6 });
const sweat = std('#ffe14a', { metal: 0, rough: 1 });

const straight = (splay: number): FingerPose => ({ curl: [0.05, 0.06, 0.04], splay });
// Knuckle forward, middle segment straight down the palm front, tip tucked in.
const curled = (splay = 0): FingerPose => ({ curl: [1.45, 1.75, 1.4], splay });

const FIST: HandPose = {
  palmHeight: 0.026,
  girth: 1.3,
  index: curled(0.02),
  middle: curled(0),
  ring: curled(-0.02),
  pinky: curled(-0.04),
  // Thumb wraps across the front of the curled fingers.
  thumb: { lean: 1.85, swing: 0.75, curl: [0.25, 0.35] },
};

const OPEN: HandPose = {
  index: straight(-0.13),
  middle: straight(-0.03),
  ring: straight(0.07),
  pinky: straight(0.18),
  thumb: { lean: 0, swing: 0.3, curl: [0.15, 0.1] },
};

const PEACE: HandPose = {
  index: straight(-0.24),
  middle: straight(0.14),
  ring: curled(0),
  pinky: curled(-0.03),
  // Thumb folds over the curled ring and little fingers.
  thumb: { lean: 1.55, swing: 0.85, curl: [0.3, 0.45] },
};

/** A band around the forearm (which is an oval: 1.15 wide, 0.78 deep). */
function wristBand(name: string, y: number, h: number, r: number, mat: Material): Mesh {
  const m = mesh(name, lathe([[r - 0.0012, 0], [r, 0.0008], [r, h - 0.0008], [r - 0.0012, h]], 22), mat, 0, y, 0);
  m.scale.set(1.15, 1, 0.78);
  return m;
}

/** A tape ring around one finger segment (0 = knuckle segment, 1 = middle, 2 = tip). */
function fingerTape(root: Group, finger: string, segment: 0 | 1 | 2, mat: Material): void {
  const parent = segment === 0 ? root.getObjectByName(finger) : root.getObjectByName(`${finger}Joint${segment}`);
  if (!parent) return;
  const ring = mesh(`${finger}Tape${segment}`, torus(0.0046, 0.0011, 16), mat, 0, 0.006, 0);
  ring.rotation.x = Math.PI / 2;
  parent.add(ring);
}

/** Coloured rim on the podium so each corner reads at a glance. */
function podiumRim(root: Group, mat: Material): void {
  const rim = mesh('PodiumRim', torus(0.0285, 0.0014, 36), mat, 0, 0.0088, 0);
  rim.rotation.x = Math.PI / 2;
  root.add(rim);
}

/** ROCK: the heavyweight. */
export function createRockFist(): Group {
  const root = buildHand('RockFighter', FIST, rockGlove, podium, white);
  addEmptyPivots(root);
  const body = root.getObjectByName('Body')!;
  body.add(
    wristBand('GloveCuff', 0.021, 0.012, 0.0158, white),
    wristBand('CuffTrim', 0.0245, 0.004, 0.0164, rockTrim),
  );
  // Championship belt around the podium, plate facing the opponent.
  const strap = mesh('BeltStrap', torus(0.0312, 0.0026, 36), black, 0, 0.0048, 0);
  strap.rotation.x = Math.PI / 2;
  const plate = mesh('BeltPlate', bevelBox(0.024, 0.013, 0.003, 0.001, 0.003, 3), gold, 0, 0.0052, 0.0325);
  const studL = mesh('BeltStudL', bevelBox(0.008, 0.008, 0.0024, 0.0008, 0.002, 3), gold, -0.019, 0.005, 0.0262);
  studL.rotation.y = -0.63;
  const studR = mesh('BeltStudR', bevelBox(0.008, 0.008, 0.0024, 0.0008, 0.002, 3), gold, 0.019, 0.005, 0.0262);
  studR.rotation.y = 0.63;
  root.add(strap, plate, studL, studR);
  podiumRim(root, rockGlove);
  root.userData.heightM = 0.08;
  return root;
}

/** PAPER: the tactician. */
export function createPaperHand(): Group {
  const root = buildHand('PaperFighter', OPEN, paperGlove, podium, paperSleeve);
  addEmptyPivots(root);
  const body = root.getObjectByName('Body')!;
  body.add(
    wristBand('WristTape', 0.024, 0.009, 0.0138, white),
    wristBand('CaptainBand', 0.008, 0.007, 0.0162, captain),
  );
  fingerTape(root, 'FingerIndex', 1, paperSleeve);
  fingerTape(root, 'FingerMiddle', 1, paperSleeve);
  podiumRim(root, paperSleeve);
  root.userData.heightM = 0.115;
  return root;
}

/** SCISSORS: the speed fighter. The two fingers are the snip pivots. */
export function createScissorsHand(): Group {
  const root = buildHand('ScissorsFighter', PEACE, scissorsGlove, podium, black);
  const body = root.getObjectByName('Body')!;
  body.add(wristBand('Sweatband', 0.02, 0.012, 0.0152, sweat));
  fingerTape(root, 'FingerIndex', 2, sweat);
  fingerTape(root, 'FingerMiddle', 2, sweat);
  exposeFingerPivot(root, 'FingerIndex', 'ArmR');
  exposeFingerPivot(root, 'FingerMiddle', 'ArmL');
  podiumRim(root, scissorsGlove);
  root.userData.heightM = 0.11;
  return root;
}
