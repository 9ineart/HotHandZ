import { createSystem, Euler, Matrix4, Quaternion, UIKit, UIKitMLAsset, Vector3, VisibilityState } from '@iwsdk/core';
import { ACHIEVEMENTS, earnedCount, isEarned, progressOf } from './achievements.js';
import { DECK_CENTER, DECK_WIDTH, WATER_FAR_Z } from './arena-shape.js';
import { edgeRadius, faceYaw, viewDir } from './arena-view.js';
import { getAudioMix, setAudioMix, sfx } from './sfx.js';
import { saveAudio, VOLUME_STEP, volumeLabel } from './audio-settings.js';
import type { AudioSettings } from './audio-settings.js';
import { getGame } from './context.js';
import type { GameContext } from './context.js';
import { J } from './joints.js';
import { PLAYER_COLOR } from './players.js';
import type { LeaderboardMsg } from './protocol.js';
import { rankOf } from './profile.js';

type El = UIKit.Component;
type Which = 'achievements' | 'leaderboard' | 'sound';

const WHICH: Which[] = ['achievements', 'leaderboard', 'sound'];
/** Pixel widths of the two progress tracks, from the UIKitML. */
const ACH_TRACK = 250;
const SND_TRACK = 170;
/** How high above the arena floor an opened panel floats, in metres. */
const PANEL_LIFT = 0.42;
/** Height of the kiosk slabs above the deck, in metres. */
const KIOSK_LIFT = 0.025;
/** Out of the palm toward the player, in metres: the menu floats off the skin. */
const MENU_RISE = 0.07;
/** Along the hand toward the fingers, so the row sits over the palm, not the wrist. */
const MENU_FORWARD = 0.05;
/**
 * Uniform scale of the slab row on the hand, against the larger one it wears
 * standing in the courtyard. A menu held at arm's length wants to be about as
 * wide as the hand under it: smaller is unreadable, larger swallows the room.
 */
const MENU_SCALE = 0.07;
const DESK_SCALE = 0.05;
/**
 * How squarely the palm must face the player's eyes before the menu appears,
 * as a dot product. Loose enough to hold the hand naturally, tight enough that
 * a hand thrown in a round never summons it.
 */
const MENU_FACING = 0.55;
/** How far in front of the player an opened panel settles, in metres. */
const PANEL_REACH = 0.7;
/** How far below eye level it settles, in metres. */
const PANEL_DROP = 0.18;
/**
 * How far to the player's right the kiosk stands, as a fraction of the arena
 * width. The water channel runs the full width of the set, so half a width
 * lands on its right-hand end rather than off the stone.
 */
const KIOSK_SIDE = 0.5;
/**
 * How far an open panel is pulled back toward the player from the arena's
 * mid-line, as a fraction of the arena depth. Straight out to the side leaves
 * the frame on the glasses' narrow view; this keeps it off the right shoulder.
 */
const PANEL_FORWARD = 0.25;
const MINT = PLAYER_COLOR[0];
const NAVY = '#202b3b';
const GREY = '#c2d3da';
const KEY_NAME = 'hca.name';

interface Panel {
  obj: UIKitMLAsset;
  /** Elements resolved on first write, kept so later frames skip the lookup. */
  el: Record<string, El>;
  last: Map<string, string>;
}

/**
 * The courtyard kiosk and the three panels it opens.
 *
 * In XR the three slabs ride the left palm: turn your hand over and they are
 * there, turn it back and they are gone. Pressing one parks its panel in front
 * of you and leaves it there, so the hand is free again. Only one is ever open,
 * and a round starting closes whichever it was: this is between-round
 * furniture, not something to read mid-throw.
 *
 * On the flat desktop view there is no hand to hang a menu on, so the kiosk
 * falls back to standing on the courtyard's own measured water edge, to the
 * right of the arena.
 */
export class KioskSystem extends createSystem({}) {
  private ctx!: GameContext;
  private kiosk!: UIKitMLAsset;
  private panels!: Record<Which, Panel>;
  private open: Which | null = null;
  /** Set once an opened panel has been parked in the world and left there. */
  private anchored = false;
  private placedFor = '';
  private lastPress = 0;
  private lastHover = 0;
  private hovered = '';
  /** Set when the profile moves, so the achievements panel refills. */
  private achDirty = true;
  private board: LeaderboardMsg | null = null;
  private boardAsked = 0;

  private readonly v = new Vector3();
  private readonly right = new Vector3();
  private readonly aim = new Vector3();
  private readonly head = new Vector3();
  private readonly normal = new Vector3();
  private readonly fingers = new Vector3();
  private readonly reach = new Vector3();
  private readonly spot = new Vector3();
  private readonly look = new Matrix4();
  private readonly q = new Quaternion();
  private readonly tilt = new Quaternion().setFromEuler(new Euler(-0.2, 0, 0));
  private readonly kioskTilt = new Quaternion().setFromEuler(new Euler(-0.6, 0, 0));
  private readonly yAxis = new Vector3(0, 1, 0);

  init(): void {
    this.ctx = getGame(this.world);
    this.kiosk = this.world.requireSceneObject<UIKitMLAsset>('kiosk-panel');
    this.panels = {
      achievements: this.panel('achievements-panel'),
      leaderboard: this.panel('leaderboard-panel'),
      sound: this.panel('sound-panel'),
    };
    this.kiosk.visible = false;

    for (const w of WHICH) {
      this.press(this.kiosk, `kiosk-${w}`, () => this.toggle(w));
    }
    this.press(this.panels.achievements.obj, 'ach-close', () => this.close());
    this.press(this.panels.leaderboard.obj, 'lb-close', () => this.close());
    this.press(this.panels.sound.obj, 'snd-close', () => this.close());
    this.press(this.panels.sound.obj, 'snd-mute', () => this.mix((s) => ({ ...s, muted: !s.muted })));
    for (const key of ['master', 'effects', 'ui'] as const) {
      this.press(this.panels.sound.obj, `snd-${key}-down`, () => this.step(key, -VOLUME_STEP));
      this.press(this.panels.sound.obj, `snd-${key}-up`, () => this.step(key, VOLUME_STEP));
    }

    this.cleanupFuncs.push(
      this.ctx.events.on('arenaReady', () => {
        this.placedFor = '';
        this.anchored = false;
      }),
      this.ctx.events.on('reveal', () => (this.achDirty = true)),
      this.ctx.events.on('state', (msg) => {
        if (msg.phase === 'countdown') this.close();
      }),
      this.ctx.net.on((msg) => {
        if (msg.type !== 'leaderboard') return;
        this.board = msg;
        this.drawLeaderboard();
      }),
    );
    this.drawSound();
  }

  private panel(id: string): Panel {
    const obj = this.world.requireSceneObject<UIKitMLAsset>(id);
    obj.visible = false;
    return { obj, el: {}, last: new Map() };
  }

  // ------------------------------------------------------------------ input

  /**
   * Press-and-release on one element, debounced across poke and ray.
   *
   * Hover and press both answer in sound, here and in the lobby, so a button is
   * audibly a button wherever it is: on the hand menu, inside a panel, or on a
   * row of volume steppers.
   */
  private press(root: UIKitMLAsset, id: string, fn: () => void): void {
    const e = root.requireElementById(id);
    e.name = id;
    let downId: number | null = null;
    const down = (ev: { pointerId: number }) => {
      downId = ev.pointerId;
    };
    const up = (ev: { pointerId: number }) => {
      if (downId == null || ev.pointerId !== downId) return;
      downId = null;
      const now = performance.now();
      if (now - this.lastPress < 250) return;
      this.lastPress = now;
      sfx.tap();
      fn();
    };
    const over = () => {
      const now = performance.now();
      if (now - this.lastHover < 90) return;
      if (id === this.hovered && now - this.lastHover < 600) return;
      this.hovered = id;
      this.lastHover = now;
      sfx.hover();
    };
    e.addEventListener('pointerdown', down as never);
    e.addEventListener('pointerup', up as never);
    e.addEventListener('pointerover', over as never);
    this.cleanupFuncs.push(() => {
      e.removeEventListener('pointerdown', down as never);
      e.removeEventListener('pointerup', up as never);
      e.removeEventListener('pointerover', over as never);
    });
  }

  private toggle(w: Which): void {
    this.open = this.open === w ? null : w;
    this.placedFor = '';
    this.anchored = false;
    if (this.open === 'achievements') this.achDirty = true;
    if (this.open === 'leaderboard') this.askBoard();
    if (this.open === 'sound') this.drawSound();
  }

  private close(): void {
    this.open = null;
  }

  // ------------------------------------------------------------------ sound

  private step(key: 'master' | 'effects' | 'ui', by: number): void {
    this.mix((s) => ({ ...s, [key]: Math.max(0, Math.min(1, Math.round((s[key] + by) * 10) / 10)) }));
    // The blip plays on the bus being set, so a level can be heard while it is
    // being chosen rather than discovered in the next match. The press itself
    // is already answered by `press`, on the interface bus.
    if (key === 'effects') sfx.hit();
  }

  private mix(fn: (s: AudioSettings) => AudioSettings): void {
    const next = fn(getAudioMix());
    setAudioMix(next);
    saveAudio(next);
    this.drawSound();
  }

  private drawSound(): void {
    const p = this.panels.sound;
    const s = getAudioMix();
    this.set(p, 'snd-mute-text', { text: s.muted ? 'OFF' : 'ON' });
    this.set(p, 'snd-mute-switch', { backgroundColor: s.muted ? GREY : MINT });
    for (const key of ['master', 'effects', 'ui'] as const) {
      this.set(p, `snd-${key}-value`, { text: volumeLabel(s[key]) });
      this.set(p, `snd-${key}-fill`, {
        width: Math.max(1, Math.round(SND_TRACK * s[key])),
        backgroundColor: s.muted ? GREY : MINT,
      });
    }
  }

  // ----------------------------------------------------------- achievements

  private drawAchievements(): void {
    const p = this.panels.achievements;
    const profile = this.ctx.progress.profile;
    this.set(p, 'ach-rank', {
      text: `${rankOf(profile.stars)}, ${profile.stars} star${profile.stars === 1 ? '' : 's'}`,
    });
    this.set(p, 'ach-tally', { text: `${earnedCount(profile)} / ${ACHIEVEMENTS.length} unlocked` });
    ACHIEVEMENTS.forEach((a, i) => {
      const got = isEarned(profile, a);
      const at = progressOf(profile, a);
      this.set(p, `ach-${i}-title`, { text: a.title });
      this.set(p, `ach-${i}-detail`, { text: a.detail });
      this.set(p, `ach-${i}-fill`, {
        width: Math.max(1, Math.round((ACH_TRACK * at) / a.goal)),
        backgroundColor: got ? MINT : GREY,
      });
      this.set(p, `ach-${i}-stars`, {
        text: got ? `+${a.stars} stars` : `${at} / ${a.goal}`,
        color: got ? '#9c530b' : '#5d6c7e',
      });
    });
  }

  // ------------------------------------------------------------ leaderboard

  /** The name this device plays under, which is the board's identity. */
  private myName(): string {
    const fromMatch = this.ctx.match.names[0];
    if (fromMatch) return fromMatch;
    try {
      return localStorage.getItem(KEY_NAME) ?? '';
    } catch {
      return '';
    }
  }

  private askBoard(): void {
    this.boardAsked = this.ctx.time;
    this.ctx.net.send({ type: 'leaderboard', name: this.myName() });
    this.drawLeaderboard();
  }

  private drawLeaderboard(): void {
    const p = this.panels.leaderboard;
    const b = this.board;
    if (!b) {
      this.set(p, 'lb-status', {
        text: this.ctx.net.connected ? 'Asking the server...' : 'No connection to the room server',
        display: 'flex',
      });
      this.set(p, 'lb-cols', { display: 'none' });
      for (let i = 0; i < 10; i++) this.set(p, `lb-${i}`, { display: 'none' });
      return;
    }
    this.set(p, 'lb-status', { display: b.top.length ? 'none' : 'flex', text: 'Nobody has played yet' });
    this.set(p, 'lb-cols', { display: b.top.length ? 'flex' : 'none' });
    for (let i = 0; i < 10; i++) {
      const row = b.top[i];
      this.set(p, `lb-${i}`, { display: row ? 'flex' : 'none' });
      if (!row) continue;
      this.set(p, `lb-${i}-pos`, { text: `${i + 1}` });
      this.set(p, `lb-${i}-name`, { text: row.name });
      this.set(p, `lb-${i}-stars`, { text: `${row.stars}` });
      this.set(p, `lb-${i}-wins`, { text: `${row.wins}` });
      // Your own row, wherever it lands in the ten, reads in your colour.
      const mine = row.name.toLowerCase() === this.myName().toLowerCase();
      this.set(p, `lb-${i}-name`, { color: mine ? '#0e7a65' : NAVY });
    }
    this.set(p, 'lb-you-pos', { text: b.you ? `${ordinal(b.you)} of ${b.total}` : 'Unranked' });
    this.set(p, 'lb-you-note', {
      text: b.you
        ? `${b.yourRow?.stars ?? 0} stars, ${b.yourRow?.wins ?? 0} wins, best streak ${b.yourRow?.streak ?? 0}`
        : 'Win a match to join the board',
    });
  }

  // ------------------------------------------------------------- per frame

  update(): void {
    const arena = this.ctx.arena;
    const phase = this.ctx.match.phase;
    // A panel is a page to read, so the round takes it back. The menu itself
    // stays: it is on your own hand, behind a deliberate turn of the wrist, and
    // locking it away until the match ends is the fixture problem again.
    const mid = phase === 'countdown' || phase === 'choose' || phase === 'reveal';
    // In XR the menu hangs off the left hand and needs nothing else, so it is
    // there from the moment hands are tracked -- through calibration included,
    // before any battlefield exists to stand beside. The flat desktop stand-in
    // is placed off the arena's own centre and width, so that one does have to
    // wait for the arena to be down.
    const usable = this.immersive() || arena.ready;
    if (mid || !usable) this.open = null;
    for (const w of WHICH) this.panels[w].obj.visible = this.open === w;
    if (!usable) {
      this.kiosk.visible = false;
      return;
    }
    if (this.open === 'achievements' && this.achDirty) {
      this.achDirty = false;
      this.drawAchievements();
    }
    // One retry if the board never answered: the socket may have been
    // reconnecting when the panel opened.
    if (this.open === 'leaderboard' && !this.board && this.ctx.time - this.boardAsked > 3) this.askBoard();

    this.player.head.getWorldPosition(this.head);
    // The menu rides the left hand, which is where the game already lives. The
    // desktop view has no hands at all, so there it keeps its old place beside
    // the arena rather than becoming unreachable.
    if (this.immersive()) {
      this.kiosk.visible = this.placeOnHand();
      if (this.open && !this.anchored) {
        this.anchored = true;
        this.park(this.panels[this.open].obj);
      }
    } else {
      this.kiosk.visible = true;
      this.place();
    }
  }

  /**
   * The menu on the left palm: there when you turn your hand over to look at
   * it, gone the rest of the time.
   *
   * This is the hand's own menu rather than a fixture in the room. Nothing
   * stands in the courtyard waiting to be walked into or reached across, and
   * the buttons arrive already within poking distance of the other hand --
   * which, in a game played with bare hands, is the one tool always to hand.
   *
   * Returns false when the hand is not tracked or not turned toward you, which
   * is also how the menu hides itself.
   */
  private placeOnHand(): boolean {
    const h = this.ctx.hands.left;
    if (!h.tracked) return false;
    // The palm is the face opposite the wrist's +Y, which is the back of the hand.
    this.normal.copy(h.backNormal).negate();
    this.aim.subVectors(this.head, h.palm).normalize();
    if (this.normal.dot(this.aim) < MENU_FACING) return false;

    const knuckle = J['middle-finger-phalanx-proximal'];
    this.fingers
      .set(h.x(knuckle) - h.x(J.wrist), h.y(knuckle) - h.y(J.wrist), h.z(knuckle) - h.z(J.wrist))
      .normalize();
    this.spot
      .copy(h.palm)
      .addScaledVector(this.normal, MENU_RISE)
      .addScaledVector(this.fingers, MENU_FORWARD);
    this.kiosk.position.copy(this.spot);
    this.kiosk.scale.setScalar(MENU_SCALE);
    // Square to the eyes, not flat on the hand: a row of buttons raked away at
    // whatever angle the wrist happens to hold is hard to read and harder to hit.
    this.kiosk.quaternion.copy(this.faceEyes(this.spot));
    return true;
  }

  /**
   * Park an opened panel in front of the player, in the direction the hand was
   * held, and leave it there.
   *
   * A panel that follows the hand cannot be read while the hand is doing
   * anything else -- including pressing the next button on the menu. Parking it
   * lets the arm come down.
   */
  private park(panel: UIKitMLAsset): void {
    this.reach.subVectors(this.spot, this.head);
    this.reach.y = 0;
    if (this.reach.lengthSq() < 1e-6) this.reach.set(0, 0, -1);
    this.reach.normalize();
    panel.position.set(
      this.head.x + this.reach.x * PANEL_REACH,
      this.head.y - PANEL_DROP,
      this.head.z + this.reach.z * PANEL_REACH,
    );
    panel.quaternion.copy(this.faceEyes(panel.position));
  }

  /** Turn a panel's +Z face squarely at the player's eyes, tilt included. */
  private faceEyes(from: Vector3): Quaternion {
    this.look.lookAt(this.head, from, this.yAxis);
    return this.q.setFromRotationMatrix(this.look);
  }

  /**
   * The desktop stand-in for the hand menu: the kiosk on the stone at the
   * right-hand end of the water channel, and the open panel beside the arena's
   * right edge, both turned toward the camera.
   *
   * Outside XR there are no hands to hang a menu on, and these three panels
   * are the part of the app most worth being able to open while testing on a
   * flat screen. They keep off the centre line, where the HUD, the lobby card
   * and the fighter cards live.
   *
   * Re-placed only when the arena or the viewpoint changes, like the cards: a
   * strip of buttons that drifts with every movement is harder to press.
   */
  private place(): void {
    const arena = this.ctx.arena;
    if (!arena.object) return;
    const dir = viewDir(this.ctx, this.head, this.v);
    const key = `${this.immersive()},${arena.center.x.toFixed(2)},${arena.center.z.toFixed(2)},${arena.width},${dir.x.toFixed(1)},${dir.z.toFixed(1)},${this.open ?? ''}`;
    if (key === this.placedFor) return;
    this.placedFor = key;

    // The player's right, in the horizontal plane: the arena's own axes are
    // fixed at calibration, so the side has to be taken from where the player
    // is standing or it becomes their left half the way round the table.
    this.right.set(dir.z, 0, -dir.x);

    // The courtyard's water edge, in arena metres. StageSystem scales the set
    // by width / DECK_WIDTH and shifts it by DECK_CENTER, so the same two
    // numbers convert any measured model z into the arena's own space.
    const scale = arena.width / DECK_WIDTH;
    const bank = (WATER_FAR_Z + DECK_CENTER) * scale;
    const side = arena.width * KIOSK_SIDE;
    const kx = arena.center.x + dir.x * bank + this.right.x * side;
    const kz = arena.center.z + dir.z * bank + this.right.z * side;
    this.kiosk.position.set(kx, arena.center.y + KIOSK_LIFT, kz);
    this.kiosk.scale.setScalar(DESK_SCALE);
    this.kiosk.quaternion.copy(this.turnToPlayer(kx, kz, this.kioskTilt));

    if (!this.open) return;
    // Out past the arena's right edge, on the kiosk's own side of the table.
    // The desktop camera's horizontal view is tighter than a headset's, so the
    // same clearance that reads as "beside the arena" in XR walks off the right
    // of the frame there; it is pulled in to stay on screen.
    const r = edgeRadius(this.ctx, this.right, this.immersive() ? 0.17 : 0.08);
    const fwd = arena.depth * PANEL_FORWARD;
    const px = arena.center.x + this.right.x * r + dir.x * fwd;
    const pz = arena.center.z + this.right.z * r + dir.z * fwd;
    const panel = this.panels[this.open].obj;
    // The desktop camera is framed on the table and looks down at it, so the
    // immersive height leaves the frame there. Same compromise UiSystem makes.
    const lift = this.immersive() ? PANEL_LIFT : PANEL_LIFT * 0.8;
    panel.position.set(px, arena.center.y + lift, pz);
    panel.quaternion.copy(this.turnToPlayer(px, pz, this.tilt));
  }

  /**
   * Yaw that turns a panel standing at `x,z` toward the player, with its tilt
   * applied after.
   *
   * Off to one side, the arena's facing yaw is no longer the player's: a panel
   * at the right edge wearing the same rotation as the HUD is turned past the
   * player's shoulder. This aims each one from its own position instead.
   */
  private turnToPlayer(x: number, z: number, tilt: Quaternion): Quaternion {
    this.aim.set(this.head.x - x, 0, this.head.z - z);
    if (this.aim.lengthSq() < 1e-6) this.aim.copy(this.v);
    this.aim.normalize();
    return this.q.setFromAxisAngle(this.yAxis, faceYaw(this.aim)).multiply(tilt);
  }

  private immersive(): boolean {
    return this.world.visibilityState.peek() !== VisibilityState.NonImmersive;
  }

  /** Write element properties, skipping writes that would change nothing. */
  private set(p: Panel, id: string, props: Record<string, unknown>): void {
    const slot = `${id}|${Object.keys(props).join(',')}`;
    const key = JSON.stringify(props);
    if (p.last.get(slot) === key) return;
    p.last.set(slot, key);
    const el = (p.el[id] ??= p.obj.requireElementById(id));
    el.setProperties(props as never);
  }
}

function ordinal(n: number): string {
  const rem = n % 100;
  if (rem >= 11 && rem <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}
