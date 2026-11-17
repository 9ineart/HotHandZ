import { Color, createSystem, Vector3 } from '@iwsdk/core';
import { getGame } from './context.js';
import type { GameContext } from './context.js';
import { classifyGesture } from './gestures.js';
import type { HandData } from './hands.js';
import { FIGHTER } from './protocol.js';
import type { Gesture } from './protocol.js';
import { sfx } from './sfx.js';

/**
 * Seconds a reading must survive before it is announced. The classifier runs
 * every frame and wavers while a hand is still moving -- a fist passes through
 * a half-open shape on its way to paper -- so announcing raw changes would
 * machine-gun the player with sounds and flashes.
 */
const DWELL = 0.12;
/** Ripple radius in metres: a quiet shimmer when the gesture is sensed... */
const SENSE_R = 0.035;
/** ...and a bigger one when the pick actually locks in. */
const CONFIRM_R = 0.085;

/**
 * Gesture confirmation at the hand.
 *
 * Two moments, with two weights. When the classifier settles on a gesture you
 * get a quiet chirp and a shimmer around your palm -- "I can see you, keep
 * holding" -- and the choice is still yours to change. When it locks you get
 * that fighter's own voice and a ring pulse in that fighter's colour.
 *
 * The pulse is drawn entirely from the shared particle pool, so this adds no
 * draw call and nothing to dispose.
 */
export class GestureFxSystem extends createSystem({}) {
  private ctx!: GameContext;
  /** The reading currently being timed, and whether it has been announced. */
  private seen: Gesture | null = null;
  private dwell = 0;
  private announced = false;

  private readonly at = new Vector3();
  private readonly head = new Vector3();
  private readonly axis = new Vector3();
  private readonly tint: Record<Gesture, Color> = {
    rock: new Color(FIGHTER.rock.color),
    paper: new Color(FIGHTER.paper.color),
    scissors: new Color(FIGHTER.scissors.color),
  };

  init(): void {
    this.ctx = getGame(this.world);
    this.cleanupFuncs.push(this.ctx.events.on('pickLocked', (g) => this.confirm(g)));
  }

  update(delta: number): void {
    const dt = Math.min(delta, 0.1);
    const m = this.ctx.match;
    // Only while the choice is open and still yours to make.
    const g = m.phase === 'choose' && !m.myPick ? m.candidate : null;
    if (g !== this.seen) {
      this.seen = g;
      this.dwell = 0;
      this.announced = false;
      return;
    }
    if (!g || this.announced) return;
    this.dwell += dt;
    if (this.dwell < DWELL) return;
    this.announced = true;
    sfx.sense();
    if (this.handOf(g)) this.pulse(this.tint[g], SENSE_R, 0.22);
  }

  /** The pick is in: that fighter's voice, and a pulse in its colour. */
  private confirm(g: Gesture): void {
    sfx[g]();
    if (!this.handOf(g)) return;
    this.pulse(this.tint[g], CONFIRM_R, 0.42);
    this.ctx.particles.burst(this.at, 18, this.tint[g], 0.14, 0.35, 0.005, 0.25);
  }

  /**
   * World position of the hand that threw this gesture, into `this.at`.
   *
   * Prefers the hand actually making the shape, then any tracked hand. Returns
   * false on desktop, where there is no hand to decorate -- the sound still
   * plays and the fighter card still shows the pick.
   */
  private handOf(g: Gesture): boolean {
    const { left, right } = this.ctx.hands;
    const hands: HandData[] = [right, left];
    for (const h of hands) {
      if (h.tracked && classifyGesture(h) === g) {
        this.at.copy(h.palm);
        return true;
      }
    }
    for (const h of hands) {
      if (h.tracked) {
        this.at.copy(h.palm);
        return true;
      }
    }
    return false;
  }

  /**
   * A ripple expanding around `this.at`, in the plane facing the player, so
   * it reads as a flat flash however the hand is turned.
   *
   * This used to be a ring of particles. It is the shared RipplePool now, so
   * the confirmation at your hand, the calibration rings and the combat
   * shockwave are all the same effect at different sizes.
   */
  private pulse(color: Color, radius: number, life: number): void {
    this.player.head.getWorldPosition(this.head);
    this.axis.subVectors(this.at, this.head);
    if (this.axis.lengthSq() < 1e-8) this.axis.set(0, 0, -1);
    // Negated: the quad's normal has to point back at the viewer.
    this.axis.normalize().negate();
    this.ctx.ripples.emit(this.at, this.axis, radius, color, life);
  }
}
