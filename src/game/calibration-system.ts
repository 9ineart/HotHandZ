import {
  BoxGeometry,
  Color,
  createSystem,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
  VisibilityState,
} from '@iwsdk/core';
import type { ShaderMaterial } from '@iwsdk/core';
import { buildArena } from '../scene-assets/arena.scene-asset.js';
import {
  ARENA_ASPECT,
  ARENA_D,
  ARENA_W,
  ARENA_W_MAX,
  ARENA_W_MIN,
  fitArena,
} from './arena-shape.js';
import { ArenaRoot } from './components.js';
import { getGame } from './context.js';
import type { GameContext } from './context.js';
import {
  PALETTE,
  createArenaFloorMaterial,
  createHoloRingMaterial,
} from './fx.js';
import { isPalmFlatDown } from './gestures.js';
import { J } from './hands.js';
import type { HandData } from './hands.js';

/** Seconds both palms must rest on the table. */
export const HOLD_SECONDS = 4;
const FORM_SECONDS = 1.6;
const DESKTOP_CENTER = new Vector3(0, 0.72, -0.55);
const SURFACE_JOINTS = [
  J.wrist,
  J['index-finger-phalanx-proximal'],
  J['middle-finger-phalanx-proximal'],
  J['ring-finger-phalanx-proximal'],
  J['pinky-finger-phalanx-proximal'],
  J['middle-finger-tip'],
];

type CalState = 'idle' | 'seeking' | 'holding' | 'forming' | 'done';

interface XRPlaneLike {
  orientation?: string;
  planeSpace: XRSpace;
  polygon: DOMPointReadOnly[];
}

/**
 * Battlefield calibration.
 *
 * Both palms flat on a table for HOLD_SECONDS: a progress ring fills under
 * each hand, the rings expand, drift together and merge into the arena
 * boundary, which then grows to fit the table (using WebXR plane detection
 * when the headset provides it). The rings dissolve into particles and the
 * arena is pinned to the real world with a WebXR anchor.
 *
 * Outside an immersive session (desktop / emulator without hands) the arena
 * is placed on a virtual table so the rest of the game can be tested.
 */
export class CalibrationSystem extends createSystem({}) {
  private ctx!: GameContext;
  state: CalState = 'idle';
  progress = 0;
  private formT = 0;
  private formFromDesktop = false;

  private calRoot!: Group;
  private ringL!: Mesh;
  private ringR!: Mesh;
  private ringMatL!: ShaderMaterial;
  private ringMatR!: ShaderMaterial;
  private preview!: Mesh;
  private previewMat!: ShaderMaterial;
  private desktopTable!: Mesh;
  private arenaRoot!: Group;
  private visual: Group | null = null;

  private tableY = 0;
  private tableYValid = false;
  /** Set after a calibration completes; cleared once both hands leave the table. */
  private needLift = false;
  private readonly mid = new Vector3();
  private readonly head = new Vector3();
  private readonly lockCenter = new Vector3();
  private lockYaw = 0;
  private fitW = ARENA_W;
  private fitD = ARENA_D;

  private anchor: XRAnchor | null = null;
  private anchorRequested = false;
  private readonly rig = new Matrix4();
  private readonly rigInv = new Matrix4();
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly v = new Vector3();
  private readonly v2 = new Vector3();
  private readonly s = new Vector3();
  private readonly yAxis = new Vector3(0, 1, 0);
  private readonly white = new Color('#ffffff');

  init(): void {
    this.ctx = getGame(this.world);

    this.calRoot = new Group();
    this.calRoot.name = 'Calibration';
    const ringGeo = new PlaneGeometry(1, 1);
    ringGeo.rotateX(-Math.PI / 2);
    this.ringMatL = createHoloRingMaterial(PALETTE.you);
    this.ringMatR = createHoloRingMaterial(PALETTE.you);
    this.ringL = new Mesh(ringGeo, this.ringMatL);
    this.ringR = new Mesh(ringGeo, this.ringMatR);
    this.ringL.name = 'PalmRingLeft';
    this.ringR.name = 'PalmRingRight';
    this.previewMat = createArenaFloorMaterial(new Color('#2fb8ff'), PALETTE.you);
    this.preview = new Mesh(ringGeo, this.previewMat);
    this.preview.name = 'BoundaryPreview';
    for (const o of [this.ringL, this.ringR, this.preview]) {
      o.visible = false;
      o.renderOrder = 5;
      o.frustumCulled = false;
    }
    this.calRoot.add(this.ringL, this.ringR, this.preview);
    this.world.createTransformEntity(this.calRoot, { persistent: true });

    // Stand-in table for the 2D browser / emulator view only.
    this.desktopTable = new Mesh(
      // Deep enough that the now deeper-than-wide arena does not overhang it.
      new BoxGeometry(1.1, 0.04, 0.85),
      new MeshStandardMaterial({ color: '#6b4e37', roughness: 0.8 }),
    );
    this.desktopTable.name = 'DesktopTable';
    this.desktopTable.position.set(DESKTOP_CENTER.x, DESKTOP_CENTER.y - 0.02, DESKTOP_CENTER.z);
    this.desktopTable.visible = false;
    this.world.createTransformEntity(this.desktopTable, { persistent: true });

    this.arenaRoot = new Group();
    this.arenaRoot.name = 'ArenaRoot';
    this.arenaRoot.visible = false;
    const arenaEntity = this.world.createTransformEntity(this.arenaRoot, { persistent: true });
    arenaEntity.addComponent(ArenaRoot, { width: ARENA_W, depth: ARENA_D, anchored: false });
    this.ctx.arena.entity = arenaEntity;
    this.ctx.arena.object = this.arenaRoot;

    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'KeyC' && this.canCalibrate()) this.placeDesktop();
    };
    window.addEventListener('keydown', onKey);
    this.cleanupFuncs.push(
      () => window.removeEventListener('keydown', onKey),
      this.world.visibilityState.subscribe((vis) => {
        const immersive = vis !== VisibilityState.NonImmersive;
        this.desktopTable.visible = !immersive && this.ctx.arena.ready;
        if (immersive && this.formFromDesktop) {
          // Entering AR: the virtual table no longer exists. Ask for a real one.
          this.arenaRoot.visible = false;
          this.ctx.arena.ready = false;
          this.state = 'seeking';
          this.progress = 0;
          this.formFromDesktop = false;
        }
      }),
    );
  }

  /** Recalibration is allowed whenever a round is not in progress. */
  private canCalibrate(): boolean {
    const p = this.ctx.match.phase;
    return p === 'offline' || p === 'waiting' || p === 'calibrating' || p === 'gameover';
  }

  update(delta: number, time: number): void {
    const dt = Math.min(delta, 0.1);
    this.ringMatL.uniforms.uTime.value = time;
    this.ringMatR.uniforms.uTime.value = time;
    this.previewMat.uniforms.uTime.value = time;
    const floor = this.visual?.getObjectByName('Floor') as Mesh | undefined;
    if (floor) (floor.material as ShaderMaterial).uniforms.uTime.value = time;

    this.ctx.calib.state = this.state;
    this.ctx.calib.progress = this.progress;
    const immersive = this.world.visibilityState.peek() !== VisibilityState.NonImmersive;
    if (!immersive) {
      if (this.state === 'idle') this.placeDesktop();
      if (this.state === 'forming') this.updateForming(dt);
      return;
    }
    if (this.state === 'idle') this.state = 'seeking';
    if (this.state === 'forming') {
      this.updateForming(dt);
      return;
    }
    this.updateAnchor();

    const { left, right } = this.ctx.hands;
    const flatL = isPalmFlatDown(left);
    const flatR = isPalmFlatDown(right);
    this.player.head.getWorldPosition(this.head);

    if (this.needLift && !flatL && !flatR) this.needLift = false;
    let ok = false;
    if (flatL && flatR && !this.needLift && this.canCalibrate()) {
      const yL = this.surfaceY(left);
      const yR = this.surfaceY(right);
      const sep = Math.hypot(left.palm.x - right.palm.x, left.palm.z - right.palm.z);
      ok =
        Math.abs(yL - yR) < 0.05 &&
        sep > 0.08 &&
        sep < 0.95 &&
        left.speed < 0.15 &&
        right.speed < 0.15 &&
        this.head.y - (yL + yR) / 2 > 0.2;
      if (ok) {
        const y = (yL + yR) / 2;
        this.tableY = this.tableYValid ? this.tableY + (y - this.tableY) * Math.min(1, dt * 6) : y;
        this.tableYValid = true;
      }
    }

    if (ok) {
      if (this.state === 'done' || this.state === 'seeking') this.state = 'holding';
      this.progress = Math.min(1, this.progress + dt / HOLD_SECONDS);
    } else if (this.state === 'holding') {
      this.progress = Math.max(0, this.progress - dt * 0.8);
      if (this.progress === 0) this.state = this.ctx.arena.ready ? 'done' : 'seeking';
    }
    this.mid.set((left.palm.x + right.palm.x) / 2, this.tableY, (left.palm.z + right.palm.z) / 2);
    this.updateRings(left, flatL, right, flatR, time, dt);

    if (this.state === 'holding' && this.progress >= 1) this.beginForming(false);
  }

  /** Height of the table surface under a flat hand. */
  private surfaceY(h: HandData): number {
    let y = 0;
    for (const j of SURFACE_JOINTS) y += h.y(j) - h.radius[j];
    return y / SURFACE_JOINTS.length;
  }

  private updateRings(
    left: HandData,
    flatL: boolean,
    right: HandData,
    flatR: boolean,
    time: number,
    dt: number,
  ): void {
    const p = this.progress;
    const holding = this.state === 'holding';
    const merge = holding ? smooth((p - 0.65) / 0.35) : 0;
    const diameter = 0.11 + 0.2 * smooth((p - 0.35) / 0.65);
    const fill = Math.min(1, p / 0.6);
    const pairs: [Mesh, ShaderMaterial, HandData, boolean][] = [
      [this.ringL, this.ringMatL, left, flatL],
      [this.ringR, this.ringMatR, right, flatR],
    ];
    for (const [ring, mat, hand, flat] of pairs) {
      const show = hand.tracked && (holding || (this.state !== 'done' && hand.backNormal.y > 0.5));
      ring.visible = show;
      if (!show) continue;
      const y = this.tableYValid ? this.tableY : this.surfaceY(hand);
      ring.position.set(hand.palm.x, y + 0.003, hand.palm.z);
      ring.position.lerp(this.mid, merge * 0.65);
      ring.position.y = y + 0.003;
      ring.scale.setScalar(diameter);
      mat.uniforms.uProgress.value = holding ? fill : 0;
      mat.uniforms.uOpacity.value = flat || holding ? 1 - merge * 0.4 : 0.35;
      // Motes rising from the filled arc.
      if (holding && Math.random() < 0.6) {
        const a = Math.random() * Math.PI * 2 * fill;
        const r = diameter * 0.5;
        this.ctx.particles.emit(
          ring.position.x + Math.sin(a) * r,
          ring.position.y,
          ring.position.z + Math.cos(a) * r,
          0,
          0.05 + Math.random() * 0.05,
          0,
          PALETTE.you,
          0.9,
          0.004,
          0.5,
        );
      }
    }
    // Merged boundary grows out of the two rings.
    this.preview.visible = holding && merge > 0;
    if (this.preview.visible) {
      this.computeYaw(this.mid);
      this.preview.position.copy(this.mid).setY(this.tableY + 0.002);
      this.preview.rotation.set(0, this.lockYaw, 0);
      const w = Math.max(0.3, Math.hypot(left.palm.x - right.palm.x, left.palm.z - right.palm.z) * 1.2);
      const d = w * ARENA_ASPECT;
      this.preview.scale.set(w * merge, 1, d * merge);
      this.previewMat.uniforms.uSize.value.set(w * merge, d * merge, 0);
      this.previewMat.uniforms.uReveal.value = merge;
      this.previewMat.uniforms.uOpacity.value = 0.9;
    }
    void time;
    void dt;
  }

  /** Arena +Z faces the player. */
  private computeYaw(center: Vector3): void {
    const dx = this.head.x - center.x;
    const dz = this.head.z - center.z;
    if (dx * dx + dz * dz > 1e-6) this.lockYaw = Math.atan2(dx, dz);
  }

  private placeDesktop(): void {
    this.lockCenter.copy(DESKTOP_CENTER);
    this.lockYaw = 0;
    this.fitW = ARENA_W;
    this.fitD = ARENA_D;
    this.desktopTable.visible = true;
    this.startForming(true);
  }

  private beginForming(fromDesktop: boolean): void {
    this.lockCenter.copy(this.mid).setY(this.tableY);
    this.computeYaw(this.lockCenter);
    const sep = Math.hypot(
      this.ctx.hands.left.palm.x - this.ctx.hands.right.palm.x,
      this.ctx.hands.left.palm.z - this.ctx.hands.right.palm.z,
    );
    // Palms rest side by side, so their spread measures the arena's WIDTH.
    // Depth follows from the aspect, then fitToPlanes shrinks both if the
    // table is too shallow to take it.
    this.fitW = clamp(sep * 1.6, ARENA_W_MIN, ARENA_W_MAX);
    this.fitD = this.fitW * ARENA_ASPECT;
    this.fitToPlanes();
    // Dissolve the calibration rings: a ripple carries the expansion, with a
    // thinner spray of motes over it for texture. The ripple is the same
    // shared effect as the gesture confirmation and the combat shockwave.
    for (const ring of [this.ringL, this.ringR]) {
      if (!ring.visible) continue;
      const r = ring.scale.x * 0.5;
      this.ctx.ripples.emit(ring.position, this.yAxis, r * 2.2, PALETTE.you, 0.75);
      for (let i = 0; i < 48; i++) {
        const a = (i / 48) * Math.PI * 2;
        const ox = Math.sin(a);
        const oz = Math.cos(a);
        this.ctx.particles.emit(
          ring.position.x + ox * r,
          ring.position.y + 0.002,
          ring.position.z + oz * r,
          ox * 0.12,
          0.08 + Math.random() * 0.18,
          oz * 0.12,
          i % 3 === 0 ? this.white : PALETTE.you,
          0.8 + Math.random() * 0.7,
          0.005,
          1.6,
        );
      }
    }
    this.startForming(fromDesktop);
  }

  private startForming(fromDesktop: boolean): void {
    this.formFromDesktop = fromDesktop;
    this.state = 'forming';
    this.formT = 0;
    this.progress = 0;
    this.ringL.visible = false;
    this.ringR.visible = false;

    // (Re)build the arena visuals at the fitted size.
    if (this.visual) {
      this.arenaRoot.remove(this.visual);
      this.visual.traverse((o) => {
        const mesh = o as Mesh;
        if (mesh.isMesh) {
          mesh.geometry.dispose();
          (mesh.material as ShaderMaterial).dispose();
        }
      });
    }
    this.visual = buildArena(this.fitW, this.fitD);
    this.visual.name = 'ArenaVisual';
    for (const child of this.visual.children) {
      child.userData.baseScale = child.scale.clone();
      if (child.name !== 'Floor' && child.name !== 'Shade') child.scale.setScalar(0.0001);
    }
    this.arenaRoot.add(this.visual);
    this.arenaRoot.visible = true;
    this.setArenaPose(this.lockCenter, this.lockYaw);
    this.ctx.arena.width = this.fitW;
    this.ctx.arena.depth = this.fitD;
    const e = this.ctx.arena.entity!;
    e.setValue(ArenaRoot, 'width', this.fitW);
    e.setValue(ArenaRoot, 'depth', this.fitD);
    this.setFloorReveal(0);
    if (!fromDesktop) this.requestAnchor();
  }

  private updateForming(dt: number): void {
    this.formT += dt;
    const t = Math.min(1, this.formT / FORM_SECONDS);
    // Boundary preview expands to the final table-fitted size, then hands off.
    const grow = smooth(t / 0.55);
    this.preview.visible = !this.formFromDesktop && t < 0.6;
    if (this.preview.visible) {
      this.preview.position.copy(this.lockCenter).setY(this.lockCenter.y + 0.002);
      this.preview.rotation.set(0, this.lockYaw, 0);
      const w = this.fitW * (0.5 + 0.5 * grow);
      const d = this.fitD * (0.5 + 0.5 * grow);
      this.preview.scale.set(w, 1, d);
      this.previewMat.uniforms.uSize.value.set(w, d, 0);
      this.previewMat.uniforms.uOpacity.value = 1 - smooth((t - 0.4) / 0.2);
    }
    this.setFloorReveal(smooth(t / 0.7));
    if (this.visual) {
      let i = 0;
      for (const child of this.visual.children) {
        if (child.name === 'Floor' || child.name === 'Shade') continue;
        const k = smooth((t - 0.35 - i * 0.03) / 0.35);
        const base = child.userData.baseScale as Vector3;
        child.scale.set(base.x, base.y * Math.max(0.0001, k), base.z).multiplyScalar(k > 0 ? 1 : 0.0001);
        i++;
      }
    }
    // Sparks race around the boundary as it locks in.
    if (t > 0.45 && t < 0.9) {
      for (let n = 0; n < 6; n++) {
        const u = Math.random();
        const hw = this.fitW / 2;
        const hd = this.fitD / 2;
        let lx: number;
        let lz: number;
        const per = u * 4;
        if (per < 1) [lx, lz] = [-hw + per * 2 * hw, -hd];
        else if (per < 2) [lx, lz] = [hw, -hd + (per - 1) * 2 * hd];
        else if (per < 3) [lx, lz] = [hw - (per - 2) * 2 * hw, hd];
        else [lx, lz] = [-hw, hd - (per - 3) * 2 * hd];
        this.v.set(lx, 0.003, lz).applyAxisAngle(this.yAxis, this.lockYaw).add(this.lockCenter);
        this.ctx.particles.emit(this.v.x, this.v.y, this.v.z, 0, 0.12 + Math.random() * 0.1, 0, PALETTE.you, 0.7, 0.0045, 1.2);
      }
    }
    if (t >= 1) {
      this.state = 'done';
      this.progress = 0;
      // Hands are usually still on the table: don't recalibrate until they lift.
      this.needLift = true;
      this.preview.visible = false;
      this.desktopTable.visible = this.formFromDesktop;
      this.ctx.arena.ready = true;
      this.ctx.events.emit('arenaReady', undefined);
    }
  }

  private setFloorReveal(r: number): void {
    const floor = this.visual?.getObjectByName('Floor') as Mesh | undefined;
    if (floor) (floor.material as ShaderMaterial).uniforms.uReveal.value = r;
  }

  private setArenaPose(center: Vector3, yaw: number): void {
    this.arenaRoot.position.copy(center);
    this.arenaRoot.quaternion.setFromAxisAngle(this.yAxis, yaw);
    this.ctx.arena.center.copy(center);
    this.ctx.arena.yaw = yaw;
  }

  /**
   * Fit the arena inside a detected horizontal plane at table height, keeping
   * the palms' midpoint as centre. Without plane data the size from the palm
   * spread is kept.
   */
  private fitToPlanes(): void {
    const frame = this.world.xrFrame as (XRFrame & { detectedPlanes?: Set<XRPlaneLike> }) | null;
    const ref = this.world.xrReferenceSpace;
    if (!frame?.detectedPlanes || !ref) return;
    this.world.player.updateWorldMatrix(true, false);
    this.rig.copy(this.world.player.matrixWorld);
    let best: { hw: number; hd: number } | null = null;
    for (const plane of frame.detectedPlanes) {
      if (plane.orientation && plane.orientation !== 'horizontal') continue;
      const pose = frame.getPose(plane.planeSpace, ref);
      if (!pose) continue;
      this.m.fromArray(pose.transform.matrix).premultiply(this.rig);
      this.v.setFromMatrixPosition(this.m);
      if (Math.abs(this.v.y - this.lockCenter.y) > 0.06) continue;
      // Polygon in arena-local axes: min distance from centre to each side.
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      const c = Math.cos(-this.lockYaw);
      const s = Math.sin(-this.lockYaw);
      for (const pt of plane.polygon) {
        this.v2.set(pt.x, pt.y, pt.z).applyMatrix4(this.m).sub(this.lockCenter);
        const lx = this.v2.x * c + this.v2.z * s;
        const lz = -this.v2.x * s + this.v2.z * c;
        minX = Math.min(minX, lx); maxX = Math.max(maxX, lx);
        minZ = Math.min(minZ, lz); maxZ = Math.max(maxZ, lz);
      }
      if (minX > 0 || maxX < 0 || minZ > 0 || maxZ < 0) continue; // centre not on this plane
      const hw = Math.min(-minX, maxX) - 0.04;
      const hd = Math.min(-minZ, maxZ) - 0.04;
      if (!best || hw * hd > best.hw * best.hd) best = { hw, hd };
    }
    if (best) {
      // Keep the courtyard's aspect: take the largest arena of that shape the
      // plane allows, rather than squashing it to the table.
      const fit = fitArena(Math.min(best.hw * 2, this.fitW), best.hd * 2);
      this.fitW = fit.w;
      this.fitD = fit.d;
    }
  }

  private requestAnchor(): void {
    const frame = this.world.xrFrame;
    const ref = this.world.xrReferenceSpace;
    this.anchor?.delete();
    this.anchor = null;
    this.ctx.arena.entity?.setValue(ArenaRoot, 'anchored', false);
    if (!frame?.createAnchor || !ref || this.anchorRequested) return;
    this.world.player.updateWorldMatrix(true, false);
    this.rigInv.copy(this.world.player.matrixWorld).invert();
    this.q.setFromAxisAngle(this.yAxis, this.lockYaw);
    this.m.compose(this.lockCenter, this.q, this.s.set(1, 1, 1)).premultiply(this.rigInv);
    this.m.decompose(this.v, this.q, this.s);
    this.anchorRequested = true;
    frame
      .createAnchor(
        new XRRigidTransform(
          { x: this.v.x, y: this.v.y, z: this.v.z },
          { x: this.q.x, y: this.q.y, z: this.q.z, w: this.q.w },
        ),
        ref,
      )
      ?.then((a) => {
        this.anchor = a;
        this.ctx.arena.entity?.setValue(ArenaRoot, 'anchored', true);
      })
      .catch(() => undefined)
      .finally(() => (this.anchorRequested = false));
  }

  /** Follow the anchor so the arena stays glued to the table. */
  private updateAnchor(): void {
    const frame = this.world.xrFrame;
    const ref = this.world.xrReferenceSpace;
    if (!this.anchor || !frame || !ref || this.state === 'forming') return;
    const pose = frame.getPose(this.anchor.anchorSpace, ref);
    if (!pose) return;
    this.world.player.updateWorldMatrix(true, false);
    this.m.fromArray(pose.transform.matrix).premultiply(this.world.player.matrixWorld);
    this.m.decompose(this.v, this.q, this.s);
    this.arenaRoot.position.copy(this.v);
    this.arenaRoot.quaternion.copy(this.q);
    this.ctx.arena.center.copy(this.v);
  }
}

function smooth(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

function clamp(x: number, a: number, b: number): number {
  return Math.min(b, Math.max(a, x));
}
