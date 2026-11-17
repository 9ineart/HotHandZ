import {
  AdditiveBlending,
  Color,
  createSystem,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  RingGeometry,
  Vector3,
} from '@iwsdk/core';
import type { Entity, MeshStandardMaterial, Object3D, ShaderMaterial } from '@iwsdk/core';
import {
  createPaperHand,
  createRockFist,
  createScissorsHand,
} from '../scene-assets/heroes.scene-asset.js';
import { Hero } from './components.js';
import { getGame } from './context.js';
import type { GameContext, LocalReveal } from './context.js';
import { FIRE, FlameBurst } from './flame.js';
import { PALETTE, createRippleBurstMaterial } from './fx.js';
import { COUNTDOWN_BEATS, HERO_FOR_GESTURE } from './protocol.js';
import type { HeroKind } from './protocol.js';
import { sfx } from './sfx.js';

/**
 * Animation intensity, applied once in `damp()`.
 *
 * The procedural sculptures could take cartoon swings; realistic hands cannot
 * -- the same arcs read as rubbery. Damping the animator's output in one place
 * beats re-tuning two dozen inline magnitudes, and keeps the timing intact.
 */
const SWING = 0.55; // rotations
const LEAP = 0.5; // vertical travel

const SUMMON = 0.9; // seconds for both heroes to materialise
const ACT = 1.1; // when the round's action starts
const IMPACT: Record<HeroKind, number> = { titan: 0.85, mystic: 0.7, assassin: 0.7 };
const ACTION_LEN: Record<HeroKind, number> = { titan: 1.8, mystic: 1.6, assassin: 1.6 };
const DUST = new Color('#cfc8bb');
const DISSOLVE_AT = 4.3;
/**
 * How far inside the boundary a fighter starts its walk-on, in metres.
 *
 * Enough to clear the fighter's own footprint, so nothing overhangs the
 * courtyard's rim onto the water during the hop in.
 */
const WALK_IN = 0.03;
/** Width of the impact shockwave quad, in metres at arena scale. */
const SHOCK_SIZE = 0.34;
/**
 * Chops in the pre-throw shake.
 *
 * Tied to the HUD's count rather than to the three of a playground game: the
 * fists and the number are reading the same clock, and five on screen over
 * three chops leaves the last two beats with nothing moving under them.
 */
const PUMPS = COUNTDOWN_BEATS;
/** How high a fist rides between beats, in metres at arena scale. */
const PUMP_RISE = 0.045;
/**
 * How far a fighter's own materials are pulled toward its player's colour.
 *
 * Not all the way: at 1 the hand becomes a flat silhouette and the glove,
 * cuff and podium stop reading as separate things. This keeps their relative
 * values while making whose hand it is unmistakable across the table.
 */
const TINT_MIX = 0.72;
const HERO_COLOR: Record<HeroKind, Color> = {
  titan: PALETTE.titan,
  mystic: PALETTE.mystic,
  assassin: PALETTE.assassin,
};

interface HeroRig {
  entity: Entity;
  root: Object3D;
  kind: HeroKind;
  side: 0 | 1;
  body: Object3D;
  armL: Object3D;
  armR: Object3D;
  home: Vector3;
  facing: number;
  fwd: number; // +1 or -1 along arena Z toward the enemy
  armLRest: number;
  armRRest: number;
  /** A countdown stand-in doing the three-count, not a revealed fighter. */
  prep: boolean;
  dissolveT: number; // <0 alive, else seconds into dissolve
  defeated: number; // <0 standing, else seconds into the fall
  hitT: number; // <0 none, else seconds into the hit reaction
}

interface ArenaParts {
  visual: Object3D;
  padYou: Mesh;
  padRival: Mesh;
  cores: [Object3D, Object3D];
  fills: [Mesh, Mesh];
}

interface Transient {
  mesh: Mesh;
  t: number;
  dur: number;
}

/**
 * Stages each round on the arena: both fighters walk out from their edge,
 * particles, the winner performs its signature attack (Titan leap-slam,
 * Paper palm push, Assassin dash-strike), the loser reacts and
 * the health bars drop at the moment of impact. Also drives pad / lock
 * indicators, core crystals and the victory / defeat finale.
 */
export class CombatSystem extends createSystem({
  heroes: { required: [Hero] },
}) {
  private ctx!: GameContext;
  private stage!: Group;
  private rigs: (HeroRig | null)[] = [null, null];
  private reveal: LocalReveal | null = null;
  private t = -1;
  private impactDone = false;
  private clashDone = false;
  private shake = 0;
  private victory = -1;
  private readonly barValue = [1, 1];

  private shock!: Transient;
  private slashes: Transient[] = [];
  private gems: Mesh[] = [];
  private parts: ArenaParts | null = null;
  /** Player-tinted clones of the fighters' shared materials, by uuid|side. */
  private readonly tinted = new Map<string, MeshStandardMaterial>();
  private fxFlags = 0;
  private coreShattered = [false, false];

  /** Fire around the round's loser. One burst, re-placed each round. */
  private blaze: FlameBurst | null = null;

  private readonly v = new Vector3();
  private readonly w = new Vector3();
  private readonly target = new Vector3();
  private readonly color = new Color();

  init(): void {
    this.ctx = getGame(this.world);
    this.stage = new Group();
    this.stage.name = 'CombatStage';

    const flat = new PlaneGeometry(1, 1);
    flat.rotateX(-Math.PI / 2);
    const shockMat = createRippleBurstMaterial(PALETTE.titan);
    this.shock = this.transient(new Mesh(flat, shockMat));
    const slashGeo = new RingGeometry(0.03, 0.042, 24, 1, 0, Math.PI);
    for (let i = 0; i < 3; i++) {
      const mat = new MeshBasicMaterial({
        color: PALETTE.assassin,
        blending: AdditiveBlending,
        transparent: true,
        side: DoubleSide,
        depthWrite: false,
      });
      this.slashes.push(this.transient(new Mesh(slashGeo, mat)));
    }
    for (const c of [PALETTE.you, PALETTE.rival]) {
      const gem = new Mesh(
        new OctahedronGeometry(0.011, 0),
        new MeshBasicMaterial({ color: c, transparent: true, opacity: 0.9 }),
      );
      gem.name = 'LockGem';
      gem.visible = false;
      this.gems.push(gem);
      this.stage.add(gem);
    }

    const attachStage = () => {
      const arena = this.ctx.arena.object;
      if (arena && this.stage.parent !== arena) arena.add(this.stage);
      this.cacheParts();
    };
    attachStage();
    this.cleanupFuncs.push(
      this.ctx.events.on('arenaReady', attachStage),
      this.ctx.events.on('reveal', (r) => this.startReveal(r)),
      this.ctx.events.on('state', (s) => {
        if (s.phase === 'countdown') {
          // Cleared outright rather than dissolved: the three-count hands take
          // the pads immediately, and last round's fighters are long gone.
          this.blaze?.stop();
          this.dismissHeroes(true);
          this.reveal = null;
          this.t = -1;
          if (s.round === 1) this.restoreCores();
          this.spawnPrep();
        }
        if (s.phase === 'choose') this.dismissPrep();
        if (s.phase === 'waiting') {
          this.blaze?.stop();
          this.dismissHeroes();
          this.restoreCores();
        }
      }),
      () => this.blaze?.dispose(),
    );
  }

  // -------------------------------------------------------------------- fire

  /**
   * Blow whoever just lost the round up, and leave them burning.
   *
   * Fired on impact rather than on the wind-up, because this is the strike
   * landing, not a fighter powering up: the blast and the hit are the same
   * moment. The fire is the aftermath, and catches a fifth of a second later,
   * scattered across the pad. It stands on the pad rather than being parented
   * to the loser, so it holds its ground while they reel and keeps burning
   * for a beat after they have dissolved out of it.
   *
   * Nothing happens on a draw. There is no loser to burn, and setting both
   * pads alight would say the opposite of what the round decided.
   */
  private igniteLoser(side: 0 | 1): void {
    const rig = this.rigs[side];
    const h = (rig?.root.userData.heightM as number) ?? 0.11;
    if (!this.blaze) {
      // No flame reaches past a quarter of the fighter's own height: the fire
      // is something they are standing in, not something that swallows them.
      // Twice the count to fill the pad at that size.
      this.blaze = new FlameBurst({ spread: h * 0.9, height: h * 0.25, count: 28 });
      this.stage.add(this.blaze.object);
    }
    // Arena-local, lifted off the deck just enough to beat it in the depth test.
    this.blaze.object.position.set(0, 0.002, side === 0 ? this.padZ() : -this.padZ());
    this.blaze.ignite();
    this.v.copy(this.blaze.object.position);
    this.v.y = 0.02;
    const at = this.toWorld(this.v);
    // The bang first: a fast shell thrown out in every direction, short-lived
    // and falling. The flames catch in what it leaves behind.
    this.ctx.particles.burst(at, 110, FIRE.mid, 0.62, 0.42, 0.005, 0.15, 0.35);
    this.ctx.particles.burst(at, 45, FIRE.hot, 0.5, 0.28, 0.0038, 0.1, 0.3);
    // Then the embers, which hang instead: negative gravity floats them up the
    // way sparks off a fire drift rather than arcing over like debris.
    this.ctx.particles.burst(at, 70, FIRE.ember, 0.28, 1.15, 0.004, 0.85, -0.25);
  }

  private transient(mesh: Mesh): Transient {
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = 8;
    this.stage.add(mesh);
    return { mesh, t: -1, dur: 0 };
  }

  private fire(tr: Transient, dur: number, x: number, y: number, z: number): void {
    tr.t = 0;
    tr.dur = dur;
    tr.mesh.visible = true;
    tr.mesh.position.set(x, y, z);
  }

  /** Arena-local point to world space (into this.w). */
  private toWorld(local: Vector3): Vector3 {
    return this.ctx.arena.object!.localToWorld(this.w.copy(local));
  }

  private padZ(): number {
    return this.ctx.arena.depth * 0.24;
  }

  private coreZ(): number {
    return this.ctx.arena.depth / 2 - 0.035;
  }

  // ---------------------------------------------------------------- spawning

  private spawn(side: 0 | 1, kind: HeroKind, prep = false): HeroRig {
    // titan = Rock (stone fist), mystic = Paper (open hand), assassin = Scissors (steel V).
    // The HANDZ glTF hands are parked, not deleted: swap this line for
    // `createHandzFighter(kind) ?? ...` to bring them back. See handz-fighters.ts.
    const root = kind === 'titan' ? createRockFist() : kind === 'mystic' ? createPaperHand() : createScissorsHand();
    this.tintForSide(root, side);
    const entity = this.world.createTransformEntity(root, { parent: this.ctx.arena.entity!, persistent: true });
    entity.addComponent(Hero, { kind, side, age: 0 });
    const fwd = side === 0 ? -1 : 1;
    const home = new Vector3(0, 0, -fwd * this.padZ());
    const armL = root.getObjectByName('ArmL')!;
    const armR = root.getObjectByName('ArmR')!;
    const rig: HeroRig = {
      entity,
      root,
      kind,
      side,
      body: root.getObjectByName('Body')!,
      armL,
      armR,
      home,
      facing: side === 0 ? Math.PI : 0,
      fwd,
      // Hands articulate by finger spread (rotation.z), not arm swings.
      armLRest: armL.rotation.z,
      armRRest: armR.rotation.z,
      prep,
      dissolveT: -1,
      defeated: -1,
      hitT: -1,
    };
    root.position.copy(home);
    root.rotation.set(0, rig.facing, 0);
    // Revealed fighters grow in with their walk-out; the countdown fists are
    // already in position when the beat starts.
    root.scale.setScalar(prep ? 1 : 0.0001);
    return rig;
  }

  /**
   * Pull a freshly built fighter's materials toward its player's colour, so
   * your hand is mint and the rival's amber however they threw.
   *
   * The fighter factories hand back meshes sharing module-level materials, so
   * the tint cannot be written in place -- that would recolour both sides.
   * Each (material, side) pair gets one clone, cached here and reused by every
   * later spawn: two sides times a handful of materials, built once.
   */
  private tintForSide(root: Object3D, side: 0 | 1): void {
    const target = side === 0 ? PALETTE.you : PALETTE.rival;
    root.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      const src = m.material as MeshStandardMaterial;
      if (!src?.color) return;
      const key = `${src.uuid}|${side}`;
      let variant = this.tinted.get(key);
      if (!variant) {
        variant = src.clone();
        variant.color.lerp(target, TINT_MIX);
        if (variant.emissive) variant.emissive.lerp(target, TINT_MIX);
        this.tinted.set(key, variant);
      }
      m.material = variant;
    });
  }

  /**
   * Both players' fists, up and ready for the three-count. Real rock paper
   * scissors opens with the shake, not with two fighters appearing from
   * nowhere, so the countdown gets hands on the table that pump on the beat
   * and clear the moment the throw window opens.
   */
  private spawnPrep(): void {
    for (const side of [0, 1] as const) this.rigs[side] = this.spawn(side, 'titan', true);
  }

  private startReveal(r: LocalReveal): void {
    this.dismissHeroes(true);
    this.reveal = r;
    this.t = 0;
    this.fxFlags = 0;
    this.impactDone = false;
    this.clashDone = false;
    this.victory = -1;
    for (const side of [0, 1] as const) {
      const pick = r.picks[side];
      this.rigs[side] = pick ? this.spawn(side, HERO_FOR_GESTURE[pick]) : null;
    }
    if (r.picks[0] || r.picks[1]) sfx.summon();
  }

  /** Dissolve any heroes still standing (new round / rematch / rival left). */
  private dismissHeroes(immediate = false): void {
    for (let i = 0; i < 2; i++) {
      const rig = this.rigs[i];
      if (!rig) continue;
      if (immediate) {
        rig.entity.dispose();
        this.rigs[i] = null;
      } else if (rig.dissolveT < 0) rig.dissolveT = 0;
    }
    this.victory = -1;
  }

  /** Fade out the three-count hands as the throw window opens. */
  private dismissPrep(): void {
    for (const rig of this.rigs) if (rig?.prep && rig.dissolveT < 0) rig.dissolveT = 0;
  }

  private restoreCores(): void {
    this.coreShattered = [false, false];
    if (this.parts) for (const c of this.parts.cores) c.visible = true;
  }

  private cacheParts(): void {
    const visual = this.ctx.arena.object?.getObjectByName('ArenaVisual');
    if (!visual) return;
    const get = (n: string) => visual.getObjectByName(n)!;
    this.parts = {
      visual,
      padYou: get('PadYou') as Mesh,
      padRival: get('PadRival') as Mesh,
      cores: [get('CoreYou'), get('CoreRival')],
      fills: [get('HpYou').getObjectByName('Fill') as Mesh, get('HpRival').getObjectByName('Fill') as Mesh],
    };
    for (let i = 0; i < 2; i++) this.parts.cores[i].visible = !this.coreShattered[i];
  }

  /** Run a one-shot effect once per round (bit flags reset on reveal). */
  private once(bit: number): boolean {
    if (this.fxFlags & (1 << bit)) return false;
    this.fxFlags |= 1 << bit;
    return true;
  }

  // ---------------------------------------------------------------- per frame

  update(delta: number, time: number): void {
    const dt = Math.min(delta, 0.1);
    if (!this.ctx.arena.ready || !this.parts) return;
    if (this.reveal && this.t >= 0) {
      this.t += dt;
      this.runTimeline();
    }
    for (const entity of this.queries.heroes.entities) {
      entity.setValue(Hero, 'age', (entity.getValue(Hero, 'age') ?? 0) + dt);
    }
    for (let i = 0; i < 2; i++) {
      const rig = this.rigs[i];
      if (rig) this.animate(rig, time, dt);
    }
    this.blaze?.update(dt);
    this.updateTransients(dt, time);
    this.updateArena(time, dt);
  }

  private targetZ(attacker: HeroRig): number {
    const defender = this.rigs[1 - attacker.side];
    return attacker.fwd * (defender ? this.padZ() : this.coreZ());
  }

  /** Round-level events: impacts, clash, defeat, cleanup. */
  private runTimeline(): void {
    const r = this.reveal!;
    const t = this.t;
    const attacker = r.winner >= 0 ? this.rigs[r.winner] : null;
    const isDraw = r.reason === 'draw' && this.rigs[0] && this.rigs[1];

    if (attacker && !this.impactDone && t >= ACT + IMPACT[attacker.kind]) {
      this.impactDone = true;
      this.onImpact(attacker, r);
    }
    if (isDraw && !this.clashDone && t >= ACT + 0.4) {
      this.clashDone = true;
      this.v.set(0, 0.05, 0);
      this.ctx.particles.burst(this.toWorld(this.v), 90, PALETTE.gold, 0.45, 0.7, 0.005, 0.2);
      this.ctx.particles.burst(this.toWorld(this.v), 50, PALETTE.white, 0.3, 0.5, 0.004, 0.2);
      (this.shock.mesh.material as ShaderMaterial).uniforms.uColor.value.copy(PALETTE.gold);
      this.fire(this.shock, 0.5, 0, 0.003, 0);
      this.shake = 0.15;
      sfx.clash();
    }
    if (r.gameOver && this.impactDone) {
      const loser = (1 - r.winner) as 0 | 1;
      const lrig = this.rigs[loser];
      const since = t - ACT - IMPACT[attacker!.kind];
      if (lrig && lrig.defeated < 0 && since > 0.35) lrig.defeated = 0;
      if (since > 0.7 && this.once(20)) this.shatterCore(loser);
      if (since > 1.2) this.victory = r.winner;
    }
    if (!r.gameOver && t >= DISSOLVE_AT && this.once(21)) this.dismissHeroes();
    if (t > 6) this.t = -1;
  }

  private onImpact(attacker: HeroRig, r: LocalReveal): void {
    const defenderSide = (1 - attacker.side) as 0 | 1;
    const defender = this.rigs[defenderSide];
    this.ctx.match.displayHp = [r.hp[0], r.hp[1]];
    this.v.set(0, 0.04, this.targetZ(attacker));
    const at = this.toWorld(this.v);
    this.ctx.particles.burst(at, 70, HERO_COLOR[attacker.kind], 0.4, 0.6, 0.005, 0.3);
    this.ctx.particles.burst(at, 30, PALETTE.white, 0.25, 0.4, 0.0035, 0.2);
    // The loser goes up, whether or not a fighter is standing there to burn:
    // with no defender the strike reached the core, and that pad is still the
    // side that lost the exchange.
    this.igniteLoser(defenderSide);
    if (defender) defender.hitT = 0;
    else {
      // No hero to block: the strike hits the rival's core directly.
      this.ctx.particles.burst(at, 40, defenderSide === 0 ? PALETTE.you : PALETTE.rival, 0.3, 0.6, 0.004, 0.5);
    }
    sfx.hit();
  }

  private shatterCore(side: 0 | 1): void {
    if (!this.parts) return;
    const core = this.parts.cores[side];
    core.getWorldPosition(this.w);
    this.ctx.particles.burst(this.w, 220, side === 0 ? PALETTE.you : PALETTE.rival, 0.5, 1.4, 0.006, 0.6, 0.4);
    this.ctx.particles.burst(this.w, 80, PALETTE.white, 0.35, 0.9, 0.004, 0.6, 0.4);
    core.visible = false;
    this.coreShattered[side] = true;
    this.shake = Math.max(this.shake, 0.3);
    sfx.slam();
  }

  private animate(rig: HeroRig, time: number, dt: number): void {
    const root = rig.root;
    // --- dissolve into particles
    if (rig.dissolveT >= 0) {
      rig.dissolveT += dt;
      const k = Math.min(1, rig.dissolveT / 0.5);
      const h = (root.userData.heightM as number) ?? 0.1;
      for (let n = 0; n < 10; n++) {
        this.v.set((Math.random() - 0.5) * 0.04, Math.random() * h * (1 - k), (Math.random() - 0.5) * 0.04);
        root.localToWorld(this.v);
        if (n < 2) this.ctx.particles.emit(this.v.x, this.v.y, this.v.z, 0, 0.04, 0, DUST, 0.5, 0.004, 1);
      }
      root.scale.set(1 - k * 0.3, Math.max(0.0001, 1 - k), 1 - k * 0.3);
      if (k >= 1) {
        rig.entity.dispose();
        this.rigs[rig.side] = null;
      }
      return;
    }

    const t = this.reveal ? this.t : 10;
    // --- reset to rest pose each frame
    root.position.copy(rig.home);
    root.rotation.set(0, rig.facing, 0);
    rig.body.position.set(0, 0, 0);
    rig.body.rotation.set(0, 0, 0);
    rig.armL.rotation.z = rig.armLRest;
    rig.armR.rotation.z = rig.armRRest;

    // --- the three-count: nothing else runs on a countdown hand
    if (rig.prep) {
      this.pump(rig);
      this.damp(rig);
      return;
    }

    // --- walk-out: hop in from the fighter's own edge of the ring
    if (t < SUMMON) {
      const u = Math.max(0, t) / SUMMON;
      // Just inside the boundary, never past it. The floor is the courtyard's
      // tiled deck now, so starting outside put the fighter and its dust on
      // the water and surrounding stone for the first beat of the round.
      const edgeZ = -rig.fwd * (this.ctx.arena.depth / 2 - WALK_IN);
      root.position.z = lerp(edgeZ, rig.home.z, easeOut(u));
      root.position.y = Math.abs(Math.sin(u * Math.PI * 3)) * 0.012 * (1 - u);
      root.scale.setScalar(Math.max(0.0001, Math.min(1, u * 5)));
      if (Math.random() < 0.35) {
        // dust kicked up at the feet
        this.v.set(root.position.x + (Math.random() - 0.5) * 0.03, 0.004, root.position.z);
        const p = this.toWorld(this.v);
        this.ctx.particles.emit(p.x, p.y, p.z, 0, 0.03, 0, DUST, 0.5, 0.004, 1);
      }
    } else {
      root.scale.setScalar(1);
    }

    // --- idle life
    const phase = time * 2.2 + rig.side;
    if (rig.kind === 'mystic') {
      // Paper: steady guard sway
      rig.body.rotation.y = Math.sin(phase * 0.8) * 0.12;
    } else if (rig.kind === 'assassin') {
      rig.body.position.y = Math.abs(Math.sin(phase * 1.6)) * 0.002;
    } else {
      rig.body.position.y = Math.sin(phase) * 0.0012;
    }

    // --- round action
    const r = this.reveal;
    if (r && t >= ACT) {
      const tau = t - ACT;
      if (r.winner === rig.side && tau <= ACTION_LEN[rig.kind] + 0.1) this.attack(rig, tau, time);
      else if (r.reason === 'draw' && this.rigs[1 - rig.side] && tau < 0.9) this.clash(rig, tau);
    }

    // --- hit reaction
    if (rig.hitT >= 0) {
      rig.hitT += dt;
      const k = Math.min(1, rig.hitT / 0.35);
      root.position.z -= rig.fwd * 0.022 * Math.sin(Math.PI * k);
      root.rotation.x = -rig.fwd * 0.4 * Math.sin(Math.PI * k);
      if (k >= 1 && rig.defeated < 0) rig.hitT = -1;
    }

    // --- defeat: topple backwards, then dissolve
    if (rig.defeated >= 0) {
      rig.defeated += dt;
      const k = easeOut(Math.min(1, rig.defeated / 0.5));
      root.position.z -= rig.fwd * 0.02;
      root.rotation.x = -rig.fwd * 1.45 * k;
      if (rig.defeated > 1.1 && rig.dissolveT < 0) rig.dissolveT = 0;
    }

    // --- victory: hops and golden sparks
    if (this.victory === rig.side) {
      const hop = Math.abs(Math.sin(time * 5));
      root.position.y = hop * 0.012;
      // Triumphant spin; scissors keep snipping.
      rig.body.rotation.y = time * 3;
      const snip = Math.abs(Math.sin(time * 8)) * 0.3;
      rig.armR.rotation.z = rig.armRRest - snip;
      rig.armL.rotation.z = rig.armLRest + snip;
      if (Math.random() < 0.5) {
        this.v.set(rig.home.x, 0.12, rig.home.z);
        const p = this.toWorld(this.v);
        this.ctx.particles.emit(p.x, p.y, p.z, (Math.random() - 0.5) * 0.2, 0.25, (Math.random() - 0.5) * 0.2, PALETTE.gold, 1.2, 0.005, 1, 0.35);
      }
    }

    this.damp(rig);
  }

  /**
   * Pull every arc back toward rest, once, after the animator has had its say.
   *
   * Only rotation.x is damped on the root: rotation.y carries which way the
   * fighter faces, and scaling that would turn it to face the wrong corner.
   * `home.y` is zero, so damping position.y measures from the podium.
   */
  private damp(rig: HeroRig): void {
    rig.root.position.y *= LEAP;
    rig.root.rotation.x *= SWING;
    rig.body.position.y *= LEAP;
    rig.body.rotation.x *= SWING;
    rig.body.rotation.y *= SWING;
  }

  /**
   * The pre-throw shake, driven off the server's countdown clock so both
   * hands and the HUD's count stay on the same beat. Each fist starts raised,
   * chops down onto the beat and swings back up, once per beat; the last chop
   * lands exactly as the countdown ends and the throw window opens.
   */
  private pump(rig: HeroRig): void {
    const m = this.ctx.match;
    const left = Math.max(0, Math.min(1, m.phaseRemaining / Math.max(0.001, m.phaseDuration)));
    const phase = (1 - left) * PUMPS * Math.PI * 2;
    // cos starts at 1: fist up, down on the beat, up again between beats.
    rig.root.position.y = rig.home.y + PUMP_RISE * (0.5 + 0.5 * Math.cos(phase));
    // The wrist cocks back on the way up and snaps level on the way down.
    rig.body.rotation.x = rig.fwd * 0.5 * Math.sin(phase);
  }

  private clash(rig: HeroRig, tau: number): void {
    const meet = -rig.fwd * 0.03;
    if (tau < 0.4) {
      rig.root.position.z = lerp(rig.home.z, meet, easeIn(tau / 0.4));
      rig.body.rotation.x = lerp(0, 0.45, tau / 0.4); // lean in and bump knuckles
    } else {
      const u = (tau - 0.4) / 0.5;
      rig.root.position.z = lerp(meet, rig.home.z, easeOut(u));
      rig.root.position.y = Math.sin(Math.PI * u) * 0.025;
    }
  }

  private attack(rig: HeroRig, tau: number, time: number): void {
    const root = rig.root;
    const targetZ = this.targetZ(rig);
    if (rig.kind === 'titan') {
      // Stone fist: rear back, leap, hammer down, shockwave, return.
      const strikeZ = targetZ - rig.fwd * 0.05;
      if (tau < 0.35) {
        const u = tau / 0.35;
        rig.body.position.y -= 0.007 * Math.sin(Math.PI * u);
        rig.body.rotation.x = lerp(0, -0.6, easeOut(u));
      } else if (tau < 0.75) {
        const u = (tau - 0.35) / 0.4;
        root.position.z = lerp(rig.home.z, strikeZ, easeInOut(u));
        root.position.y = 0.065 * Math.sin(Math.PI * u);
        rig.body.rotation.x = -0.6;
      } else if (tau < 1.4) {
        root.position.z = strikeZ;
        const u = Math.min(1, (tau - 0.75) / 0.1);
        rig.body.rotation.x = lerp(-0.6, 0.55, easeIn(u));
        rig.body.position.y -= 0.006 * (1 - Math.min(1, (tau - 0.85) / 0.4));
        if (tau >= 0.85 && this.once(1)) {
          (this.shock.mesh.material as ShaderMaterial).uniforms.uColor.value.copy(PALETTE.titan);
          this.fire(this.shock, 0.65, 0, 0.003, targetZ - rig.fwd * 0.01);
          this.v.set(0, 0.004, targetZ - rig.fwd * 0.01);
          const p = this.toWorld(this.v);
          this.ctx.particles.burst(p, 120, PALETTE.titan, 0.55, 0.9, 0.005, 0.8, 0.9);
          this.color.set('#8a8f99');
          this.ctx.particles.burst(p, 60, this.color, 0.35, 1.1, 0.006, 1.2, 1.4);
          this.shake = 0.4;
          sfx.slam();
        }
      } else {
        const u = Math.min(1, (tau - 1.4) / 0.4);
        root.position.z = lerp(strikeZ, rig.home.z, easeInOut(u));
        rig.body.rotation.x = lerp(0.55, 0, u);
      }
      return;
    }

    if (rig.kind === 'mystic') {
      // Paper: Palm Push. Set, slide in low, drive the open palm through.
      const strikeZ = targetZ - rig.fwd * 0.045;
      if (tau < 0.25) {
        rig.body.rotation.x = lerp(0, -0.3, easeOut(tau / 0.25));
      } else if (tau < 0.6) {
        const u = (tau - 0.25) / 0.35;
        root.position.z = lerp(rig.home.z, strikeZ, easeInOut(u));
        rig.body.rotation.x = -0.3;
      } else if (tau < 1.15) {
        root.position.z = strikeZ + rig.fwd * 0.012 * Math.min(1, (tau - 0.6) / 0.1);
        rig.body.rotation.x = lerp(-0.3, 0.5, easeOut(Math.min(1, (tau - 0.6) / 0.1)));
        if (tau >= 0.7 && this.once(1)) {
          (this.shock.mesh.material as ShaderMaterial).uniforms.uColor.value.copy(PALETTE.mystic);
          this.fire(this.shock, 0.45, 0, 0.003, targetZ);
          this.v.set(0, 0.05, targetZ);
          this.ctx.particles.burst(this.toWorld(this.v), 60, DUST, 0.5, 0.5, 0.005, 0.3);
          this.shake = 0.2;
          sfx.hit();
        }
      } else {
        const u = Math.min(1, (tau - 1.15) / 0.4);
        root.position.z = lerp(strikeZ, rig.home.z, easeInOut(u));
        rig.body.rotation.x = lerp(0.5, 0, u);
      }
      return;
    }
    // Assassin: blur-fast dash, three strikes, backflip home.
    const strikeZ = targetZ - rig.fwd * 0.035;
    if (tau < 0.15) {
      rig.body.position.y -= 0.007 * (tau / 0.15);
    } else if (tau < 0.35) {
      const u = (tau - 0.15) / 0.2;
      const z0 = root.position.z;
      root.position.z = lerp(rig.home.z, strikeZ, easeIn(u));
      root.position.x = Math.sin(Math.PI * u * 2) * 0.012;
      // speed trail: streaks left behind along the path
      for (let n = 0; n < 8; n++) {
        this.v.set(root.position.x + (Math.random() - 0.5) * 0.02, 0.01 + Math.random() * 0.07, lerp(z0, root.position.z, Math.random()));
        const p = this.toWorld(this.v);
        this.w.set(0, 0, -rig.fwd * 0.4).applyQuaternion(this.ctx.arena.object!.quaternion);
        this.ctx.particles.emit(p.x, p.y, p.z, this.w.x, 0, this.w.z, PALETTE.assassin, 0.35, 0.004, 6);
      }
      if (this.once(1)) sfx.slash();
    } else if (tau < 0.85) {
      root.position.z = strikeZ;
      for (let i = 0; i < 3; i++) {
        const at = 0.4 + i * 0.15;
        const u = (tau - at + 0.08) / 0.16;
        if (u > 0 && u < 1) {
          // Snip: the two steel fingers spread wide, then slam shut.
          const open = Math.sin(Math.PI * easeOut(u)) * 0.45;
          rig.armR.rotation.z = rig.armRRest - open;
          rig.armL.rotation.z = rig.armLRest + open;
          rig.body.rotation.x = 0.3;
        }
        if (tau >= at && this.once(2 + i)) {
          const sl = this.slashes[i];
          this.fire(sl, 0.18, 0, 0.05, strikeZ + rig.fwd * 0.028);
          sl.mesh.rotation.set(0, 0, (i - 1) * 0.9 + Math.PI / 2);
          this.v.set(0, 0.05, strikeZ + rig.fwd * 0.03);
          this.ctx.particles.burst(this.toWorld(this.v), 25, PALETTE.assassin, 0.4, 0.3, 0.004, 0.1);
          sfx.slash();
        }
      }
    } else if (tau < 1.2) {
      const u = (tau - 0.85) / 0.35;
      root.position.z = lerp(strikeZ, rig.home.z, easeOut(u));
      root.position.y = Math.sin(Math.PI * u) * 0.05;
      rig.body.rotation.x = Math.PI * 2 * easeInOut(u) * (rig.side === 0 ? 1 : -1);
    }
  }

  private updateTransients(dt: number, time: number): void {
    const shock = this.shock;
    if (shock.t >= 0) {
      shock.t += dt;
      const k = shock.t / shock.dur;
      const mat = shock.mesh.material as ShaderMaterial;
      // The ripple shader expands the rings itself, so the quad holds a fixed
      // size: scaling it as well would compound the two and slide the ring
      // off its own geometry.
      shock.mesh.scale.setScalar(SHOCK_SIZE);
      mat.uniforms.uAge.value = Math.min(1, k);
      mat.uniforms.uOpacity.value = 1 - k;
      if (k >= 1) {
        shock.t = -1;
        shock.mesh.visible = false;
      }
    }
    for (const sl of this.slashes) {
      if (sl.t < 0) continue;
      sl.t += dt;
      const k = sl.t / sl.dur;
      (sl.mesh.material as MeshBasicMaterial).opacity = 1 - k;
      sl.mesh.scale.setScalar(0.8 + k * 0.6);
      if (k >= 1) {
        sl.t = -1;
        sl.mesh.visible = false;
      }
    }
    // Camera-free "screen shake": jolt the arena visuals and the stage.
    if (this.shake > 0 && this.parts) {
      this.shake = Math.max(0, this.shake - dt);
      const a = this.shake * 0.012;
      this.parts.visual.position.set((Math.random() - 0.5) * a, (Math.random() - 0.5) * a * 0.4, (Math.random() - 0.5) * a);
      this.stage.position.copy(this.parts.visual.position);
    } else if (this.parts) {
      this.parts.visual.position.set(0, 0, 0);
      this.stage.position.set(0, 0, 0);
    }
  }

  /** Pads, lock gems, cores and health bars. */
  private updateArena(time: number, dt: number): void {
    const p = this.parts!;
    const m = this.ctx.match;
    const choosing = m.phase === 'choose';
    const padYou = p.padYou.material as ShaderMaterial;
    const padRival = p.padRival.material as ShaderMaterial;
    padYou.uniforms.uTime.value = time;
    padRival.uniforms.uTime.value = time;
    // The ring under each spawn is that player's colour and stays that way:
    // it says whose square this is, so it must not drift to the colour of the
    // fighter being chosen. The hold feedback rides on uProgress instead.
    padYou.uniforms.uColor.value.copy(PALETTE.you);
    padRival.uniforms.uColor.value.copy(PALETTE.rival);
    padYou.uniforms.uProgress.value = choosing && !m.myPick ? m.candidateProgress : 1;
    padRival.uniforms.uProgress.value = 1;

    // Locked-but-hidden selections: a spinning gem over each locked pad.
    for (let side = 0; side < 2; side++) {
      const gem = this.gems[side];
      gem.visible = (choosing || m.phase === 'countdown') && m.locked[side];
      if (!gem.visible) continue;
      const z = (side === 0 ? 1 : -1) * this.padZ();
      gem.position.set(0, 0.045 + Math.sin(time * 3 + side) * 0.005, z);
      gem.rotation.y = time * 2.5;
    }

    for (let side = 0; side < 2; side++) {
      const frac = Math.max(0, m.displayHp[side] / Math.max(1, m.maxHp));
      this.barValue[side] += (frac - this.barValue[side]) * Math.min(1, dt * 6);
      const fill = p.fills[side];
      fill.scale.x = Math.max(0.0001, this.barValue[side]);
      (fill.material as MeshBasicMaterial).color.copy(
        frac < 0.3 ? PALETTE.danger : side === 0 ? PALETTE.you : PALETTE.rival,
      );
      const core = p.cores[side];
      core.rotation.y = time * (0.8 + side * 0.3);
      const s = 0.55 + 0.45 * this.barValue[side];
      core.scale.set(s, s * 1.6, s);
    }
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.min(1, Math.max(0, t));
}
function smooth(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}
function easeIn(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * t;
}
function easeOut(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return 1 - (1 - t) ** 3;
}
function easeInOut(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}
function elasticOut(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  if (t === 0 || t === 1) return t;
  return 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
}
