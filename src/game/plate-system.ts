import { createSystem, Euler, Quaternion, UIKit, UIKitMLAsset, Vector3 } from '@iwsdk/core';
import { faceYaw, viewDir } from './arena-view.js';
import { getGame } from './context.js';
import type { GameContext, LocalReveal } from './context.js';
import { roundPoints } from './profile.js';

type El = UIKit.Component;

const ELEMENTS = ['plate-badge', 'plate-name', 'plate-fill', 'plate-icon-rock', 'plate-icon-paper', 'plate-icon-scissors'];
/** Badge colour per side, matching the HP bars on the HUD. */
const BADGE = ['#70e9d0', '#ff9b47'];
/** Health fill per side ("Champion Arcade" palette); red when nearly out. */
const FILL = ['#168ca7', '#ef7926'];
/** Width of the bar's track, in panel units. Must match `.track` in plate.uikitml. */
const BAR_W = 136;
/** Metres above the arena floor: clears a 0.115 m fighter and its leap. */
const LIFT = 0.18;
/** Fraction of arena depth out to a fighter pad; mirrors CombatSystem.padZ(). */
const PAD_Z = 0.24;
/** Seconds the won-round points chip is on screen, start to finish. */
const POP_LIFE = 1.5;
/** Metres the chip climbs over its life, from just above the player's plate. */
const POP_RISE = 0.14;
/** Metres above the plate the chip starts, so it clears the nameplate itself. */
const POP_BASE = 0.07;
/** Resting scale of the points chip; it springs past this on the way in. */
const POP_SCALE = 0.05;

interface PlateView {
  obj: UIKitMLAsset;
  el: Record<string, El>;
  last: Map<string, string>;
}

/**
 * A nameplate above each fighter, after the Pokemon battle plate: name and
 * health bar on a white capsule, floating over that side's pad.
 *
 * The bar runs green to yellow to red as a fighter is worn down. Which side a
 * plate belongs to is carried by the badge colour and the name, so the bar is
 * free to show how much is left instead.
 */
export class PlateSystem extends createSystem({}) {
  private ctx!: GameContext;
  private plates!: [PlateView, PlateView];
  private points!: UIKitMLAsset;
  private pointsFigure!: El;
  /** Seconds into the points pop; negative when it is not running. */
  private popT = -1;
  private placedFor = '';

  private readonly v = new Vector3();
  private readonly p = new Vector3();
  private readonly popAt = new Vector3();
  private readonly head = new Vector3();
  private readonly q = new Quaternion();
  private readonly tilt = new Quaternion().setFromEuler(new Euler(-0.18, 0, 0));
  private readonly yAxis = new Vector3(0, 1, 0);

  init(): void {
    this.ctx = getGame(this.world);
    const make = (id: string, side: number): PlateView => {
      const obj = this.world.requireSceneObject<UIKitMLAsset>(id);
      const el: Record<string, El> = {};
      for (const e of ELEMENTS) el[e] = obj.requireElementById(e);
      obj.visible = false;
      const view: PlateView = { obj, el, last: new Map() };
      this.set(view, 'plate-badge', { backgroundColor: BADGE[side] });
      return view;
    };
    this.plates = [make('plate-you', 0), make('plate-rival', 1)];
    this.points = this.world.requireSceneObject<UIKitMLAsset>('points-you');
    this.points.visible = false;
    this.pointsFigure = this.points.requireElementById('points-figure');
    this.cleanupFuncs.push(
      this.ctx.events.on('arenaReady', () => (this.placedFor = '')),
      this.ctx.events.on('reveal', (r) => this.onWin(r)),
    );
  }

  /**
   * Start the points pop over the player's own plate when they take a round.
   *
   * The figure is the one `applyRound` banks for that throw, so what springs
   * off the plate and what the result screen totals are the same number. Only
   * the local player gets one: the rival's progress is not ours to show, and
   * two chips climbing out of one table reads as confetti rather than a score.
   */
  private onWin(r: LocalReveal): void {
    if (r.winner !== 0 || !this.ctx.arena.ready) return;
    const gained = roundPoints(r.picks[0], true);
    if (gained <= 0) return;
    this.pointsFigure.setProperties({ text: `+${gained}` } as never);
    this.popAt.copy(this.plates[0].obj.position);
    this.points.quaternion.copy(this.plates[0].obj.quaternion);
    this.popT = 0;
  }

  /**
   * Spring in, climb, shrink away. The whole chip is moved and scaled as one
   * object: animating its layout instead would re-flow the panel every frame.
   */
  private animatePoints(dt: number): void {
    if (this.popT < 0) return;
    this.popT += dt;
    const k = this.popT / POP_LIFE;
    if (k >= 1 || !this.ctx.arena.ready) {
      this.popT = -1;
      this.points.visible = false;
      return;
    }
    const rise = 1 - Math.pow(1 - Math.min(1, k * 1.5), 3);
    const scale =
      k < 0.12 ? (k / 0.12) * 1.12
      : k < 0.26 ? 1.12 - ((k - 0.12) / 0.14) * 0.12
      : k > 0.8 ? (1 - k) / 0.2
      : 1;
    this.points.visible = true;
    this.points.position.set(this.popAt.x, this.popAt.y + POP_BASE + POP_RISE * rise, this.popAt.z);
    this.points.scale.setScalar(POP_SCALE * Math.max(0.001, scale));
  }

  update(delta: number): void {
    this.animatePoints(Math.min(delta, 0.1));
    const m = this.ctx.match;
    const showing =
      this.ctx.arena.ready &&
      (m.phase === 'countdown' || m.phase === 'choose' || m.phase === 'reveal' || m.phase === 'gameover');
    for (const plate of this.plates) plate.obj.visible = showing;
    if (!showing) {
      // Leaving the match takes the chip with it, mid-climb if need be.
      this.popT = -1;
      this.points.visible = false;
      return;
    }
    this.place();

    const max = Math.max(1, m.maxHp);
    const fallback = ['YOU', m.rivalIsAi ? 'AI RIVAL' : 'RIVAL'];
    for (let i = 0; i < 2; i++) {
      const plate = this.plates[i];
      const hp = Math.max(0, Math.round(m.displayHp[i]));
      const frac = hp / max;
      this.set(plate, 'plate-name', { text: (m.names[i] || fallback[i]).toUpperCase() });
      this.set(plate, 'plate-fill', { width: Math.max(0.5, BAR_W * frac) });
      this.set(plate, 'plate-fill', { backgroundColor: frac > 0.2 ? FILL[i] : '#e8453c' });
      // Badge icon: your own pick as soon as you lock it; the rival's only once revealed.
      const pick = i === 0 ? (m.myPick ?? m.lastReveal?.picks[0] ?? null) : (m.lastReveal?.picks[1] ?? null);
      for (const g of ['rock', 'paper', 'scissors'] as const) {
        this.set(plate, `plate-icon-${g}`, { display: pick === g ? 'flex' : 'none' });
      }
    }
  }

  /**
   * Park each plate over its own pad, facing the player.
   *
   * Anchored once, when the arena is placed, rather than re-aimed every frame:
   * a plate that chases your head is unreadable. The pad offset comes from the
   * arena's own local frame, not the viewer's, because that is where the
   * fighter actually stands.
   */
  private place(): void {
    const arena = this.ctx.arena;
    if (!arena.object) return;
    const key = `${arena.center.x.toFixed(3)},${arena.center.y.toFixed(3)},${arena.center.z.toFixed(3)},${arena.depth}`;
    if (key === this.placedFor) return;
    this.placedFor = key;
    this.player.head.getWorldPosition(this.head);
    const yaw = faceYaw(viewDir(this.ctx, this.head, this.v));
    this.q.setFromAxisAngle(this.yAxis, yaw).multiply(this.tilt);
    const pad = arena.depth * PAD_Z;
    for (let i = 0; i < 2; i++) {
      // Side 0 stands at local +z, side 1 at -z, the same as CombatSystem.
      this.p.set(0, LIFT, i === 0 ? pad : -pad);
      arena.object.localToWorld(this.p);
      this.plates[i].obj.position.copy(this.p);
      this.plates[i].obj.quaternion.copy(this.q);
    }
  }

  private set(plate: PlateView, id: string, props: Record<string, unknown>): void {
    const slot = `${id}|${Object.keys(props).join(',')}`;
    const key = JSON.stringify(props);
    if (plate.last.get(slot) === key) return;
    plate.last.set(slot, key);
    plate.el[id].setProperties(props as never);
  }
}

/** Green while healthy, yellow when worn down, red when nearly out. */
