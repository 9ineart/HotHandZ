import { BufferAttribute, Group } from '@iwsdk/core';
import type { BufferGeometry, Material } from '@iwsdk/core';
import { bevelBox } from './lib/hardsurface.js';
import { group, lathe, limb, mesh, sphere } from './kit.js';

/**
 * Builds a stylised right hand sculpture on a plinth.
 *
 * Hand space: fingers point +Y, the palm faces +Z (toward the opponent once
 * placed), the thumb sits on the +X side. Every finger is a chain of pivot
 * groups; positive rotation.x curls a joint toward the palm (+Z).
 *
 * Hierarchy (names are what the combat animator drives):
 *   <Root>/Plinth, <Root>/Body/{Forearm, Hand/{Palm, Finger*, Thumb}}
 */

export interface FingerPose {
  /** Curl at knuckle, middle and tip joints (radians, + toward the palm). */
  curl: [number, number, number];
  /** Sideways splay at the knuckle (rotation.z, + leans toward -X). */
  splay: number;
}

export interface ThumbPose {
  /** Lean of the whole thumb at its base (rotation.z, + toward -X / across the palm). */
  lean: number;
  /** Forward swing at the base (rotation.x, + toward the palm side). */
  swing: number;
  curl: [number, number];
}

export interface HandPose {
  index: FingerPose;
  middle: FingerPose;
  ring: FingerPose;
  pinky: FingerPose;
  thumb: ThumbPose;
  /** Palm height override (a fist reads better with a shorter, chunkier palm). */
  palmHeight?: number;
  /** Finger radius multiplier. */
  girth?: number;
}

/** Box-project 0..1 UVs onto a block authored in metres (bevelBox UVs are in metres). */
function boxUV(geo: BufferGeometry): BufferGeometry {
  geo.computeBoundingBox();
  const b = geo.boundingBox!;
  const w = Math.max(1e-6, b.max.x - b.min.x);
  const h = Math.max(1e-6, b.max.y - b.min.y);
  const d = Math.max(1e-6, b.max.z - b.min.z);
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const u = (pos.getX(i) - b.min.x) / w;
    const v = (pos.getY(i) - b.min.y) / h;
    // Side faces use depth for U so the texture doesn't smear across them.
    const side = nrm && Math.abs(nrm.getX(i)) > 0.7;
    uv[i * 2] = side ? (pos.getZ(i) - b.min.z) / d * 0.4 : u;
    uv[i * 2 + 1] = v;
  }
  geo.setAttribute('uv', new BufferAttribute(uv, 2));
  return geo;
}

const PALM_W = 0.034;
const PALM_H = 0.036;
const PALM_T = 0.014;
const FOREARM_H = 0.03;
const PLINTH_H = 0.009;

const FINGERS = {
  index: { x: 0.0118, len: [0.016, 0.011, 0.009], r: 0.0043 },
  middle: { x: 0.0037, len: [0.018, 0.012, 0.0095], r: 0.0045 },
  ring: { x: -0.0045, len: [0.017, 0.011, 0.009], r: 0.0042 },
  pinky: { x: -0.0122, len: [0.013, 0.0095, 0.008], r: 0.0036 },
} as const;

function fingerChain(name: string, lens: readonly number[], r: number, pose: FingerPose, mat: Material): Group {
  const knuckle = group(name, 0, 0, 0);
  knuckle.rotation.set(pose.curl[0], 0, pose.splay);
  // Knuckle cap blends the finger root into the palm top.
  knuckle.add(mesh(`${name}Knuckle`, sphere(r * 1.15, 12, 10), mat));
  let parent = knuckle;
  for (let i = 0; i < 3; i++) {
    const seg = mesh(`${name}Seg${i}`, limb(r * (1 - i * 0.08), lens[i] + r * 0.6, 10), mat, 0, 0, 0);
    parent.add(seg);
    if (i < 2) {
      const joint = group(`${name}Joint${i + 1}`, 0, lens[i], 0);
      joint.rotation.x = pose.curl[i + 1];
      parent.add(joint);
      parent = joint;
    }
  }
  return knuckle;
}

function thumbChain(pose: ThumbPose, mat: Material, palmH: number): Group {
  const base = group('Thumb', PALM_W / 2 - 0.002, -palmH / 2 + 0.01, 0.002);
  base.rotation.set(pose.swing, 0, -0.75 + pose.lean);
  // Thenar pad: the fleshy root that ties the thumb into the palm.
  const pad = mesh('ThumbPad', sphere(0.0085, 14, 10), mat, -0.002, 0.002, 0.001);
  pad.scale.set(0.9, 1.25, 0.85);
  base.add(pad);
  const seg0 = mesh('ThumbSeg0', limb(0.0052, 0.017, 10), mat);
  const joint = group('ThumbJoint1', 0, 0.014, 0);
  joint.rotation.x = pose.curl[1];
  joint.add(mesh('ThumbSeg1', limb(0.0048, 0.014, 10), mat));
  const tilt = group('ThumbBase', 0, 0, 0, seg0, joint);
  tilt.rotation.x = pose.curl[0];
  base.add(tilt);
  return base;
}

/** Full sculpture. `plinthMat` lets the base differ (e.g. darker stone). */
export function buildHand(rootName: string, pose: HandPose, mat: Material, plinthMat: Material, armMat: Material = mat): Group {
  const root = group(rootName);
  const plinth = mesh('Plinth', lathe([[0.001, 0], [0.03, 0], [0.031, 0.003], [0.027, PLINTH_H], [0.001, PLINTH_H]], 28), plinthMat);
  root.add(plinth);

  const body = group('Body', 0, PLINTH_H, 0);
  // Forearm: flared root, slim wrist, flattened front-to-back like a real arm.
  const forearm = mesh('Forearm', lathe([[0.001, -0.002], [0.016, -0.002], [0.0145, 0.008], [0.0125, 0.02], [0.0118, FOREARM_H], [0.012, FOREARM_H + 0.006], [0.001, FOREARM_H + 0.007]], 22), armMat);
  forearm.scale.set(1.15, 1, 0.78);
  body.add(forearm);

  const palmH = pose.palmHeight ?? PALM_H;
  const girth = pose.girth ?? 1;
  const hand = group('Hand', 0, FOREARM_H + palmH / 2 - 0.002, 0);
  const palmGeo = boxUV(bevelBox(PALM_W, palmH, PALM_T, 0.004, 0.006, 4));
  hand.add(mesh('Palm', palmGeo, mat));

  for (const key of ['index', 'middle', 'ring', 'pinky'] as const) {
    const f = FINGERS[key];
    const name = `Finger${key[0].toUpperCase()}${key.slice(1)}`;
    const chain = fingerChain(name, f.len, f.r * girth, pose[key], mat);
    chain.position.set(f.x, palmH / 2 - 0.002, 0.0005);
    hand.add(chain);
  }
  hand.add(thumbChain(pose.thumb, mat, palmH));
  body.add(hand);
  root.add(body);
  return root;
}

/** Re-parent a named finger under a combat pivot (ArmL/ArmR) without moving it. */
export function exposeFingerPivot(root: Group, fingerName: string, pivotName: string): Group {
  const finger = root.getObjectByName(fingerName) as Group;
  finger.name = pivotName;
  // Keep the original semantic name on a child marker for inspection.
  const marker = new Group();
  marker.name = fingerName;
  finger.add(marker);
  return finger;
}

/** Empty, invisible pivots so non-articulated hands satisfy the rig contract. */
export function addEmptyPivots(root: Group): void {
  const hand = root.getObjectByName('Hand')!;
  for (const n of ['ArmL', 'ArmR']) {
    const g = new Group();
    g.name = n;
    hand.add(g);
  }
}
