import { createSystem, Euler, Quaternion, UIKit, UIKitMLAsset, Vector3 } from '@iwsdk/core';
import { edgeRadius, faceYaw, viewDir } from './arena-view.js';
import { getGame } from './context.js';
import type { GameContext } from './context.js';
import { PLAYER_COLOR, PLAYER_INK, PLAYER_ON_COLOR } from './players.js';
import { FIGHTER } from './protocol.js';
import type { Gesture } from './protocol.js';

type El = UIKit.Component;

const SCALE = 0.075;
const FLIP = 0.3; // seconds for a face-down / face-up flip
const SHOW_LOCK = 0.8; // seconds the locked card stays face up before flipping down
const NAVY = '#202b3b';
/** Emblem colour once a fighter is revealed; face down it takes the player's. */
const GEM_SHOWN = '#ffd12c';
const ELEMENTS = ['card-root', 'card-gem', 'card-owner', 'card-band', 'card-role', 'icon-rock', 'icon-paper', 'icon-scissors', 'icon-back', 'card-name', 'card-track', 'card-fill', 'card-status'];
/** Who each card belongs to. Set once; it never changes during a session. */
const OWNER = ['YOU', 'RIVAL'] as const;
const NEAR_YOU = 0.06; // metres toward the player, so the HUD across the table clears your card
const PAD_Z = 0.24; // fraction of arena depth out to a fighter pad; mirrors CombatSystem.padZ()

/** What one card should show right now. */
interface Face {
  visible: boolean;
  /** Fighter shown face up, or null for the card back. */
  gesture: Gesture | null;
  name: string;
  status: string;
  fill: number;
}

interface CardView {
  obj: UIKitMLAsset;
  el: Record<string, El>;
  last: Map<string, string>;
  /** Side currently drawn ('' = nothing yet). */
  shown: string;
  flipT: number; // <0 idle, else seconds into a flip
  pop: number;
}

/**
 * The two fighter cards beside the arena.
 *
 * Yours appears as soon as a pose is read, swaps when the pose changes, fills
 * while you hold, stamps LOCKED and flips face down. The rival's stays face
 * down until the reveal, when both flip together. A fighter never appears on
 * the arena before this sequence has finished.
 */
export class CardSystem extends createSystem({}) {
  private ctx!: GameContext;
  private cards!: [CardView, CardView];
  private lockedAt = -1;
  private placedFor = '';

  private readonly v = new Vector3();
  private readonly head = new Vector3();
  private readonly right = new Vector3();
  private readonly q = new Quaternion();
  private readonly tilt = new Quaternion().setFromEuler(new Euler(-0.3, 0, 0));
  private readonly yAxis = new Vector3(0, 1, 0);
  private readonly face: [Face, Face] = [
    { visible: false, gesture: null, name: '', status: '', fill: 0 },
    { visible: false, gesture: null, name: '', status: '', fill: 0 },
  ];

  init(): void {
    this.ctx = getGame(this.world);
    const make = (id: string): CardView => {
      const obj = this.world.requireSceneObject<UIKitMLAsset>(id);
      const el: Record<string, El> = {};
      for (const e of ELEMENTS) el[e] = obj.requireElementById(e);
      obj.visible = false;
      return { obj, el, last: new Map(), shown: '', flipT: -1, pop: 1 };
    };
    this.cards = [make('card-you'), make('card-rival')];
    // Whose card this is, said three ways: the name in that player's ink, the
    // band behind the role in the player's colour, and (in draw) the border
    // and hold bar. Same two colours as the HUD bars and the spawn rings.
    for (let i = 0; i < 2; i++) {
      this.set(this.cards[i], 'card-owner', { text: OWNER[i], color: PLAYER_INK[i] });
      this.set(this.cards[i], 'card-band', { backgroundColor: PLAYER_COLOR[i] });
      this.set(this.cards[i], 'card-role', { color: PLAYER_ON_COLOR });
    }
    this.cleanupFuncs.push(
      this.ctx.events.on('pickLocked', () => (this.lockedAt = this.ctx.time)),
      this.ctx.events.on('arenaReady', () => (this.placedFor = '')),
    );
  }

  update(delta: number): void {
    const dt = Math.min(delta, 0.1);
    this.decide();
    this.place();
    for (let i = 0; i < 2; i++) this.draw(this.cards[i], this.face[i], dt, i);
  }

  /** Work out what each card should show from the match state. */
  private decide(): void {
    const m = this.ctx.match;
    const [me, rival] = this.face;
    const live = this.ctx.arena.ready && (m.phase === 'countdown' || m.phase === 'choose' || m.phase === 'reveal');
    me.visible = rival.visible = live;
    if (!live) return;
    me.gesture = rival.gesture = null;
    me.fill = rival.fill = 0;

    if (m.phase === 'countdown') {
      me.name = rival.name = 'GET READY';
      me.status = 'Raise one hand';
      rival.status = '';
      this.lockedAt = -1;
    } else if (m.phase === 'choose') {
      if (m.myPick) {
        if (this.lockedAt >= 0 && this.ctx.time - this.lockedAt < SHOW_LOCK) {
          me.gesture = m.myPick;
          me.name = 'LOCKED';
          me.status = FIGHTER[m.myPick].bark;
          me.fill = 1;
        } else {
          me.name = 'LOCKED';
          me.status = 'Waiting for the reveal';
        }
      } else if (m.candidate) {
        me.gesture = m.candidate;
        me.name = FIGHTER[m.candidate].name;
        me.status = 'HOLD TO LOCK';
        me.fill = m.candidateProgress;
      } else {
        me.name = 'THROW!';
        me.status = 'Fist, open hand or V';
      }
      rival.name = m.locked[1] ? 'LOCKED' : 'CHOOSING';
      rival.status = m.locked[1] ? 'Waiting for the reveal' : '';
    } else {
      const r = m.lastReveal;
      const picks = r?.picks ?? [null, null];
      for (let i = 0; i < 2; i++) {
        const f = this.face[i];
        const g = picks[i];
        f.gesture = g;
        f.name = g ? FIGHTER[g].name : 'NO SHOW';
        f.status = !r || r.winner < 0 ? 'DRAW' : r.winner === i ? 'WINS' : 'LOSES';
        f.fill = g ? 1 : 0;
      }
    }
  }

  /** Flank the arena to the player's left and right, facing them. */
  private place(): void {
    const arena = this.ctx.arena;
    if (!arena.ready || !arena.object) return;
    // Anchored once, when the arena is placed, rather than re-aimed every
    // frame: yours lands on your left and stays there while you look around.
    // Taken from the same head pose as the HUD, so YOU and RIVAL agree, and
    // held for the whole session so the cards never jump between rounds.
    const key = `${arena.center.x.toFixed(3)},${arena.center.y.toFixed(3)},${arena.center.z.toFixed(3)},${arena.width},${arena.depth}`;
    if (key === this.placedFor) return;
    this.placedFor = key;
    this.player.head.getWorldPosition(this.head);
    const dir = viewDir(this.ctx, this.head, this.v);
    const yaw = faceYaw(dir);
    this.q.setFromAxisAngle(this.yAxis, yaw).multiply(this.tilt);
    // The player's right, looking at the arena: perpendicular to the view dir.
    this.right.set(dir.z, 0, -dir.x);
    const r = edgeRadius(this.ctx, this.right, 0.1);
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? -1 : 1; // yours left, rival's right
      // Yours sits just in front of the arena so the HUD across the table
      // clears it; the rival's is pushed back level with the rival's pad, so
      // each card reads as belonging to the fighter beside it. `dir` points
      // from the arena toward the player, hence the negative for the far side.
      const near = i === 0 ? NEAR_YOU : -arena.depth * PAD_Z;
      this.cards[i].obj.position.set(
        arena.center.x + this.right.x * r * s + dir.x * near,
        arena.center.y + 0.12,
        arena.center.z + this.right.z * r * s + dir.z * near,
      );
      this.cards[i].obj.quaternion.copy(this.q);
    }
  }

  /** `who` is the player index (0 you, 1 rival); `side` below is the card face. */
  private draw(card: CardView, face: Face, dt: number, who: number): void {
    card.obj.visible = face.visible;
    if (!face.visible) {
      card.shown = '';
      card.flipT = -1;
      return;
    }
    const side = face.gesture ? 'front' : 'back';
    if (card.shown === '') {
      card.shown = side;
      card.pop = 0;
    } else if (side !== card.shown && card.flipT < 0) {
      card.flipT = 0;
    }

    // Flip: squash to an edge, swap the face, open again.
    let sx = 1;
    if (card.flipT >= 0) {
      card.flipT += dt;
      const k = Math.min(1, card.flipT / FLIP);
      if (k >= 0.5) card.shown = side;
      sx = Math.max(0.02, Math.abs(Math.cos(Math.PI * k)));
      if (k >= 1) card.flipT = -1;
    }
    card.pop = Math.min(1, card.pop + dt * 5);
    const s = SCALE * (0.6 + 0.4 * card.pop);
    card.obj.scale.set(s * sx, s, s);

    // Mid-flip the old side keeps its content until the swap.
    if (card.flipT >= 0 && card.shown !== side) return;
    const g = face.gesture;
    this.set(card, 'icon-rock', { display: g === 'rock' ? 'flex' : 'none' });
    this.set(card, 'icon-paper', { display: g === 'paper' ? 'flex' : 'none' });
    this.set(card, 'icon-scissors', { display: g === 'scissors' ? 'flex' : 'none' });
    this.set(card, 'icon-back', { display: g ? 'none' : 'flex' });
    this.set(card, 'card-root', { borderColor: g ? PLAYER_COLOR[who] : NAVY });
    this.set(card, 'card-gem', { backgroundColor: g ? GEM_SHOWN : PLAYER_COLOR[who] });
    this.set(card, 'card-role', { text: g ? FIGHTER[g].role : 'CHAMPION' });
    this.set(card, 'card-name', { text: face.name });
    this.set(card, 'card-status', { text: face.status });
    this.set(card, 'card-track', { display: g ? 'flex' : 'none' });
    this.set(card, 'card-fill', { width: Math.max(1, Math.round(156 * face.fill)) });
    this.set(card, 'card-fill', { backgroundColor: face.fill >= 1 ? PLAYER_INK[who] : NAVY });
    this.set(card, 'card-status', { color: face.fill >= 1 ? PLAYER_COLOR[who] : '#ffffff' });
  }

  private set(card: CardView, id: string, props: Record<string, unknown>): void {
    const slot = `${id}|${Object.keys(props).join(',')}`;
    const key = JSON.stringify(props);
    if (card.last.get(slot) === key) return;
    card.last.set(slot, key);
    card.el[id].setProperties(props as never);
  }
}
