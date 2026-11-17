import { Matrix4, Quaternion, Vector3 } from '@iwsdk/core';
import type { World } from '@iwsdk/core';

/**
 * Reads WebXR hand-tracking joints once per frame into preallocated, world-space
 * buffers. Hand-tracking joints come from the XRFrame in the player's reference
 * space; we multiply by the player rig's world matrix so every consumer works in
 * scene coordinates. Nothing in update() allocates.
 */

export { FINGERS, J, JOINTS } from './joints.js';
export type { JointName } from './joints.js';
import { J, JOINTS } from './joints.js';

export class HandData {
  tracked = false;
  /** xyz per joint, world space. */
  readonly pos = new Float32Array(JOINTS.length * 3);
  readonly radius = new Float32Array(JOINTS.length);
  /** World-space wrist orientation. */
  readonly wristQuat = new Quaternion();
  /** Unit vector out of the back of the hand (WebXR joint +Y). */
  readonly backNormal = new Vector3(0, 1, 0);
  /** Palm centre: midpoint of wrist and middle knuckle. */
  readonly palm = new Vector3();
  readonly palmVelocity = new Vector3();
  /** Smoothed palm speed in m/s. */
  speed = 0;
  private readonly lastPalm = new Vector3();
  private hasLast = false;

  constructor(readonly handedness: 'left' | 'right') {}

  x(j: number) {
    return this.pos[j * 3];
  }
  y(j: number) {
    return this.pos[j * 3 + 1];
  }
  z(j: number) {
    return this.pos[j * 3 + 2];
  }

  /** Distance between two joints. */
  dist(a: number, b: number): number {
    const dx = this.pos[a * 3] - this.pos[b * 3];
    const dy = this.pos[a * 3 + 1] - this.pos[b * 3 + 1];
    const dz = this.pos[a * 3 + 2] - this.pos[b * 3 + 2];
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /** @internal */
  finishFrame(delta: number) {
    const w = J.wrist * 3;
    const k = J['middle-finger-phalanx-proximal'] * 3;
    this.palm.set(
      (this.pos[w] + this.pos[k]) * 0.5,
      (this.pos[w + 1] + this.pos[k + 1]) * 0.5,
      (this.pos[w + 2] + this.pos[k + 2]) * 0.5,
    );
    if (this.hasLast && delta > 0) {
      this.palmVelocity.subVectors(this.palm, this.lastPalm).divideScalar(delta);
      const s = this.palmVelocity.length();
      this.speed += (s - this.speed) * Math.min(1, delta * 8);
    }
    this.lastPalm.copy(this.palm);
    this.hasLast = true;
  }

  /** @internal */
  lose() {
    this.tracked = false;
    this.hasLast = false;
    this.speed = 0;
  }
}

export class HandTracker {
  readonly left = new HandData('left');
  readonly right = new HandData('right');
  private readonly spaces: XRJointSpace[] = [];
  private readonly poses = new Float32Array(JOINTS.length * 16);
  private readonly radii = new Float32Array(JOINTS.length);
  private readonly rig = new Matrix4();
  private readonly m = new Matrix4();
  private readonly v = new Vector3();
  private readonly rigQuat = new Quaternion();
  private readonly tmpQ = new Quaternion();
  private readonly tmpS = new Vector3();

  constructor(private readonly world: World) {}

  get both(): boolean {
    return this.left.tracked && this.right.tracked;
  }

  update(delta: number) {
    const frame = this.world.xrFrame;
    const ref = this.world.xrReferenceSpace;
    const session = this.world.session;
    let sawLeft = false;
    let sawRight = false;
    if (frame && ref && session) {
      this.world.player.updateWorldMatrix(true, false);
      this.rig.copy(this.world.player.matrixWorld);
      this.rig.decompose(this.v, this.rigQuat, this.tmpS);
      for (const source of session.inputSources) {
        const hand = source.hand;
        if (!hand || (source.handedness !== 'left' && source.handedness !== 'right'))
          continue;
        const data = source.handedness === 'left' ? this.left : this.right;
        if (this.read(frame, ref, hand, data)) {
          data.finishFrame(delta);
          if (data === this.left) sawLeft = true;
          else sawRight = true;
        }
      }
    }
    if (!sawLeft) this.left.lose();
    if (!sawRight) this.right.lose();
  }

  private read(
    frame: XRFrame,
    ref: XRReferenceSpace,
    hand: XRHand,
    out: HandData,
  ): boolean {
    this.spaces.length = 0;
    for (const name of JOINTS) {
      const space = hand.get(name as XRHandJoint);
      if (!space) return false;
      this.spaces.push(space);
    }
    let ok = false;
    const batch = frame as XRFrame & {
      fillPoses?: (spaces: XRSpace[], base: XRSpace, out: Float32Array) => boolean;
      fillJointRadii?: (spaces: XRJointSpace[], out: Float32Array) => boolean;
    };
    if (typeof batch.fillPoses === 'function') {
      ok = batch.fillPoses(this.spaces, ref, this.poses);
      if (ok && typeof batch.fillJointRadii === 'function')
        batch.fillJointRadii(this.spaces, this.radii);
    } else {
      ok = true;
      for (let i = 0; i < this.spaces.length; i++) {
        const pose = frame.getJointPose?.(this.spaces[i], ref);
        if (!pose) {
          ok = false;
          break;
        }
        this.poses.set(pose.transform.matrix, i * 16);
        this.radii[i] = pose.radius ?? 0.008;
      }
    }
    if (!ok) return false;
    for (let i = 0; i < JOINTS.length; i++) {
      this.m.fromArray(this.poses, i * 16).premultiply(this.rig);
      this.v.setFromMatrixPosition(this.m);
      out.pos[i * 3] = this.v.x;
      out.pos[i * 3 + 1] = this.v.y;
      out.pos[i * 3 + 2] = this.v.z;
      out.radius[i] = this.radii[i] || 0.008;
      if (i === 0) {
        this.m.decompose(this.v, out.wristQuat, this.tmpS);
        out.backNormal.set(0, 1, 0).applyQuaternion(out.wristQuat);
      }
    }
    out.tracked = true;
    return true;
  }
}
