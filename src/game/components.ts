import { createComponent, Types } from '@iwsdk/core';
import { ARENA_D, ARENA_W } from './arena-shape.js';

/** System-free component declarations for HotHandZ. */

export const HeroKinds = {
  Titan: 'titan',
  Mystic: 'mystic',
  Assassin: 'assassin',
} as const;

/** A summoned hero on the arena. side 0 = you (near), 1 = rival (far). */
export const Hero = createComponent('Hero', {
  kind: { type: Types.Enum, enum: HeroKinds, default: HeroKinds.Titan },
  side: { type: Types.Int8, default: 0 },
  /** Seconds since the hero was summoned (driven by CombatSystem). */
  age: { type: Types.Float32, default: 0 },
});

/** The calibrated tabletop arena root. */
export const ArenaRoot = createComponent('ArenaRoot', {
  width: { type: Types.Float32, default: ARENA_W },
  depth: { type: Types.Float32, default: ARENA_D },
  anchored: { type: Types.Boolean, default: false },
});
