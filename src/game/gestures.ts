import { FINGERS, J } from './joints.js';
import type { HandData } from './hands.js';
import type { Gesture } from './protocol.js';

/**
 * Rock / Paper / Scissors classification from hand-tracking joints.
 *
 * Each of the four long fingers is scored on how straight it is: the direct
 * distance from knuckle to fingertip divided by the length of the bent finger
 * path. A straight finger scores ~1, a fist ~0.3-0.5. A finger also counts as
 * curled when its tip is closer to the wrist than its knuckle is. The thumb is
 * ignored because people throw "rock" and "scissors" with it both in and out.
 *
 *   rock     - all four fingers curled
 *   paper    - all four fingers extended
 *   scissors - index + middle extended, ring + pinky curled
 */

export const EXTENDED = 0.86;
export const CURLED = 0.72;

export type FingerState = 'extended' | 'curled' | 'unsure';

/** Joint accessor so the classifier can be unit-tested without XR. */
export interface JointSource {
  dist(a: number, b: number): number;
}

export function fingerStraightness(h: JointSource, f: readonly number[]): number {
  const path = h.dist(f[1], f[2]) + h.dist(f[2], f[3]) + h.dist(f[3], f[4]);
  if (path < 1e-5) return 0;
  return h.dist(f[1], f[4]) / path;
}

export function fingerState(h: JointSource, f: readonly number[]): FingerState {
  const s = fingerStraightness(h, f);
  const tipToWrist = h.dist(f[4], J.wrist);
  const knuckleToWrist = h.dist(f[1], J.wrist);
  if (tipToWrist < knuckleToWrist * 1.05 || s < CURLED) return 'curled';
  if (s > EXTENDED && tipToWrist > knuckleToWrist * 1.35) return 'extended';
  return 'unsure';
}

export function classifyGesture(h: JointSource): Gesture | null {
  const i = fingerState(h, FINGERS.index);
  const m = fingerState(h, FINGERS.middle);
  const r = fingerState(h, FINGERS.ring);
  const p = fingerState(h, FINGERS.pinky);
  if (i === 'curled' && m === 'curled' && r === 'curled' && p === 'curled')
    return 'rock';
  if (i === 'extended' && m === 'extended' && r === 'extended' && p === 'extended')
    return 'paper';
  if (i === 'extended' && m === 'extended' && r === 'curled' && p === 'curled')
    return 'scissors';
  return null;
}

/** True when a tracked hand is lying flat, back of the hand facing up. */
export function isPalmFlatDown(h: HandData): boolean {
  if (!h.tracked) return false;
  if (h.backNormal.y < 0.78) return false;
  // Fingers lying out, not curled.
  if (fingerState(h, FINGERS.index) !== 'extended') return false;
  if (fingerState(h, FINGERS.middle) !== 'extended') return false;
  // Fingertips roughly level with the knuckles (flat on a surface).
  const tipDrop = Math.abs(h.y(J['middle-finger-tip']) - h.y(J['middle-finger-phalanx-proximal']));
  return tipDrop < 0.035;
}

/**
 * Debounces per-frame classifications into a locked choice: the same gesture
 * must be held continuously for `holdSeconds`.
 */
export class GestureLatch {
  current: Gesture | null = null;
  held = 0;
  constructor(public holdSeconds = 0.35) {}

  reset() {
    this.current = null;
    this.held = 0;
  }

  /** Returns the gesture once it has been held long enough, else null. */
  push(g: Gesture | null, delta: number): Gesture | null {
    if (g !== this.current) {
      this.current = g;
      this.held = 0;
      return null;
    }
    if (g == null) return null;
    this.held += delta;
    return this.held >= this.holdSeconds ? g : null;
  }

  /** 0..1 progress toward locking the current gesture. */
  get progress(): number {
    return this.current ? Math.min(1, this.held / this.holdSeconds) : 0;
  }
}
