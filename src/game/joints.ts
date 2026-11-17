/** WebXR hand joint names and indices (dependency-free). */

export const JOINTS = [
  'wrist',
  'thumb-metacarpal',
  'thumb-phalanx-proximal',
  'thumb-phalanx-distal',
  'thumb-tip',
  'index-finger-metacarpal',
  'index-finger-phalanx-proximal',
  'index-finger-phalanx-intermediate',
  'index-finger-phalanx-distal',
  'index-finger-tip',
  'middle-finger-metacarpal',
  'middle-finger-phalanx-proximal',
  'middle-finger-phalanx-intermediate',
  'middle-finger-phalanx-distal',
  'middle-finger-tip',
  'ring-finger-metacarpal',
  'ring-finger-phalanx-proximal',
  'ring-finger-phalanx-intermediate',
  'ring-finger-phalanx-distal',
  'ring-finger-tip',
  'pinky-finger-metacarpal',
  'pinky-finger-phalanx-proximal',
  'pinky-finger-phalanx-intermediate',
  'pinky-finger-phalanx-distal',
  'pinky-finger-tip',
] as const;

export type JointName = (typeof JOINTS)[number];
export const J = Object.fromEntries(JOINTS.map((n, i) => [n, i])) as Record<
  JointName,
  number
>;

/** Finger joint indices: metacarpal, proximal, intermediate, distal, tip. */
export const FINGERS = {
  index: [5, 6, 7, 8, 9],
  middle: [10, 11, 12, 13, 14],
  ring: [15, 16, 17, 18, 19],
  pinky: [20, 21, 22, 23, 24],
} as const;

