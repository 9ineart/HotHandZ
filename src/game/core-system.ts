import { createSystem, Vector3 } from '@iwsdk/core';
import { ARENA_D, ARENA_W } from './arena-shape.js';
import { Emitter, initialMatch, setGame } from './context.js';
import type { GameContext } from './context.js';
import { ParticlePool, RipplePool } from './fx.js';
import { HandTracker } from './hands.js';
import { NetClient } from './net.js';
import { ensureDaily, loadProfile } from './profile.js';

/**
 * Owns the shared GameContext: hand tracking, the world-space particle pool
 * and the room-server connection. Registered first so later systems can rely
 * on fresh hand data every frame.
 */
export class CoreSystem extends createSystem({}) {
  private ctx!: GameContext;

  init(): void {
    const particles = new ParticlePool(2400);
    const ripples = new RipplePool(8);
    const net = new NetClient();
    this.ctx = {
      world: this.world,
      hands: new HandTracker(this.world),
      particles,
      ripples,
      net,
      events: new Emitter(),
      arena: {
        ready: false,
        entity: null,
        object: null,
        width: ARENA_W,
        depth: ARENA_D,
        center: new Vector3(),
        yaw: 0,
      },
      match: initialMatch(),
      calib: { state: 'idle', progress: 0 },
      gesture: { now: null, keyed: null, keyedUntil: 0 },
      demo: { pose: null, wave: false },
      progress: { profile: loadProfile(), lines: [], notice: '', noticeUntil: 0 },
      time: 0,
    };
    ensureDaily(this.ctx.progress.profile);
    setGame(this.world, this.ctx);
    this.world.createTransformEntity(particles.points, { persistent: true });
    this.world.createTransformEntity(ripples.group, { persistent: true });
    net.connect();
    this.cleanupFuncs.push(() => net.dispose());
  }

  update(delta: number, time: number): void {
    const dt = Math.min(delta, 0.1);
    this.ctx.time = time;
    this.ctx.hands.update(dt);
    this.ctx.particles.update(dt);
    this.ctx.ripples.update(dt);
  }
}
