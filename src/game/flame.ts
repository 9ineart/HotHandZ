import {
  AdditiveBlending,
  BufferAttribute,
  Color,
  Group,
  IcosahedronGeometry,
  Mesh,
  NormalBlending,
  ShaderMaterial,
  Vector3,
} from '@iwsdk/core';
import type { BufferGeometry } from '@iwsdk/core';

/**
 * A stylised ("anime") flame, after Yoa 3D's procedural flame shader.
 *
 * The method, and why each piece is there:
 *
 *  1. **Shape.** An icosphere pulled into a teardrop by dragging its vertices
 *     toward a point above it, with a falloff so the tip moves a long way and
 *     the base does not move at all. Baked once, on the CPU — it is the same
 *     shape every frame.
 *  2. **Displacement.** Noise sampled at the vertex, pushing each vertex along
 *     its own normal. A Blender displace node, in eight lines of GLSL.
 *  3. **Animation.** The noise is sampled in a domain that slides downward over
 *     time, so the bumps travel bottom-to-top through a mesh that never moves.
 *     This is UV scrolling, the one idea the whole effect rests on: take a
 *     texture, animate where it lands on the mesh, and use it to drive a
 *     parameter. Attack trails and shockwaves are the same trick aimed
 *     elsewhere.
 *  4. **Colour.** A matcap: the view-space normal is read as a 2D coordinate,
 *     and that coordinate is run through a banded ramp. The bands are what make
 *     it read as drawn rather than rendered — a smooth gradient here would look
 *     like a lit blob. Nothing about the colour depends on scene lighting, which
 *     is the point: it is the same flame under any light.
 *
 * Two deliberate departures from the video. It builds on Three's WebGPU
 * renderer with TSL; IWSDK runs the WebGL renderer, so this is hand-written
 * GLSL. And its glow is a post-processing bloom pass with a custom luminance
 * mask, which this project has no post stack for and a Quest would rather not
 * pay for — `glow: true` fakes it with one additive shell a little larger than
 * the flame, which costs a single extra draw call.
 */

/**
 * The fire palette, read off the reference capture.
 *
 * Four stops, hottest first: a near-white yellow core, a strong orange body,
 * a deep crimson rim, and the ember colour the particle burst uses so the
 * sparks thrown off the blast belong to the same fire.
 */
export const FIRE = {
  hot: new Color('#fff2b8'),
  mid: new Color('#ff8a12'),
  cool: new Color('#cf1c06'),
  ember: new Color('#ffb01e'),
};

/** Noise octaves summed per vertex, and the matcap ramp. Shared by both meshes. */
const SHADER_NOISE = /* glsl */ `
  float hash31(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.11, 0.17, 0.13));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float vnoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash31(i), hash31(i + vec3(1.0, 0.0, 0.0)), f.x),
          mix(hash31(i + vec3(0.0, 1.0, 0.0)), hash31(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
      mix(mix(hash31(i + vec3(0.0, 0.0, 1.0)), hash31(i + vec3(1.0, 0.0, 1.0)), f.x),
          mix(hash31(i + vec3(0.0, 1.0, 1.0)), hash31(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
      f.z);
  }
  float fbm(vec3 p) {
    return vnoise(p) * 0.6 + vnoise(p * 2.17) * 0.3 + vnoise(p * 4.31) * 0.1;
  }`;

const VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uDistort;
  uniform float uFlicker;
  uniform float uFreq;
  uniform float uSpeed;
  varying vec3 vN;
  varying float vH;
${SHADER_NOISE}
  void main() {
    // The geometry is a unit flame: base at y = 0, tip at y = 1.
    float h = clamp(position.y, 0.0, 1.0);
    vec3 q = position * uFreq;
    // The scroll. Subtracting time slides the noise field downward, which sends
    // the bumps it produces upward through the mesh.
    q.y -= uTime * uSpeed;
    float n = fbm(q) * 2.0 - 1.0;
    // The base is welded to whatever the flame sits on, and the tip whips: a
    // flame that wobbles at the bottom reads as a balloon on a string.
    float mask = smoothstep(0.0, 0.38, h) * (0.45 + 0.9 * h);
    vec3 p = position + normal * (n * uDistort * uFlicker * mask);
    vN = normalize(normalMatrix * normal);
    // Taken after displacement, so the tip fade follows the licking tongues
    // rather than cutting a flat line through them.
    vH = p.y;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }`;

const FRAGMENT = /* glsl */ `
  uniform vec3 uHot;
  uniform vec3 uMid;
  uniform vec3 uCool;
  uniform float uOpacity;
  uniform float uBand;
  uniform float uOvalY;
  uniform float uLiftY;
  uniform float uTipFade;
  uniform float uBase;
  varying vec3 vN;
  varying float vH;
  void main() {
    // Matcap: the view-space normal IS the lookup coordinate. Facing the
    // camera is the centre of the ramp, the silhouette is its outer edge.
    vec2 m = vec2(vN.x, (vN.y - uLiftY) / uOvalY);
    float r = length(m);
    // Hard-ish steps, not a gradient. uBand is the width of each transition:
    // near zero gives flat cel bands, wider softens toward a painted look.
    vec3 col = uCool;
    col = mix(col, uMid, 1.0 - smoothstep(0.85 - uBand, 0.85 + uBand, r));
    col = mix(col, uHot, 1.0 - smoothstep(0.55 - uBand, 0.55 + uBand, r));
    // Hottest where it is fed, coolest where it is spending itself. Without
    // this the matcap alone gives every tongue the same brightness top to
    // bottom, which is the one thing real fire never does.
    col = mix(col, uHot, (1.0 - smoothstep(0.0, 0.55, vH)) * uBase);
    // Solid through the body, dissolving at the tip and softened where it
    // meets the ground, so neither end shows the mesh it is wrapped around.
    float a = uOpacity * smoothstep(1.0, uTipFade, vH) * smoothstep(0.0, 0.05, vH);
    if (a < 0.01) discard;
    gl_FragColor = vec4(col, a);
    // Three converts a hex to linear working space on the way in, and a raw
    // ShaderMaterial gets no automatic encode on the way out. Without this the
    // linear numbers go straight into an sRGB buffer and every orange in the
    // ramp lands hot and chalky.
    #include <colorspace_fragment>
  }`;

/** How far above centre the apex sits, in sphere radii, before normalisation. */
const APEX = 1.9;
/** How hard the tip is dragged toward that apex. 1 would collapse it onto it. */
const PULL = 0.78;
/**
 * Radians per second the whole flame turns on its own axis.
 *
 * The cheapest fix for the one flaw a looping effect always has. The flame
 * looks different from every angle, so turning it at a rate that shares no
 * period with the noise scroll means the viewer never sees the same frame
 * twice, without a single extra instruction in the shader.
 */
const SPIN = 0.85;

/**
 * The unit flame: a teardrop with its base on y = 0 and its tip at y = 1,
 * roughly 0.5 wide, so a caller scales it to the size it wants in metres.
 *
 * The pull-toward-a-point trick is how you would sculpt this with a grab brush
 * in Blender, and it keeps the vertex density highest near the base where the
 * silhouette actually matters.
 */
function buildFlameGeometry(detail: number): BufferGeometry {
  const geo = new IcosahedronGeometry(0.5, detail);
  const pos = geo.attributes.position as BufferAttribute;
  const apex = new Vector3(0, 0.5 * APEX, 0);
  const v = new Vector3();
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    // 0 at the very bottom, 1 at the very top of the source sphere.
    const h = (v.y / 0.5 + 1) * 0.5;
    v.lerp(apex, Math.pow(h, 2.2) * PULL);
    pos.setXYZ(i, v.x, v.y, v.z);
    if (v.y < minY) minY = v.y;
    if (v.y > maxY) maxY = v.y;
  }
  const k = 1 / Math.max(1e-6, maxY - minY);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    pos.setXYZ(i, v.x * k, (v.y - minY) * k, v.z * k);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * One geometry per subdivision level, for the whole app.
 *
 * A ring of fire is a dozen flames, and building a dozen identical icospheres
 * would be a dozen copies of the same buffer. The flames differ by transform,
 * phase and material, never by mesh.
 */
const GEOMETRY = new Map<number, BufferGeometry>();
function flameGeometry(detail: number): BufferGeometry {
  let geo = GEOMETRY.get(detail);
  if (!geo) {
    geo = buildFlameGeometry(detail);
    GEOMETRY.set(detail, geo);
  }
  return geo;
}

function createFlameMaterial(additive: boolean): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uDistort: { value: 0.16 },
      uFlicker: { value: 1 },
      uFreq: { value: 3.1 },
      uSpeed: { value: 1.35 },
      uHot: { value: FIRE.hot.clone() },
      uMid: { value: FIRE.mid.clone() },
      uCool: { value: FIRE.cool.clone() },
      uOpacity: { value: 1 },
      // Crisp bands on the body; the glow shell has nothing to band.
      uBand: { value: additive ? 0.25 : 0.045 },
      uOvalY: { value: 1.35 },
      // Barely offset. Pushed up to 0.18 the hot spot slid off centre and each
      // tongue grew a red stripe down one side like a folded ribbon.
      uLiftY: { value: 0.06 },
      uTipFade: { value: 0.82 },
      uBase: { value: 0.7 },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    // The body is painted, not added: additive blending would wash the ramp
    // out to white and take the cel banding — the entire effect — with it.
    // Only the fake-bloom shell is added to what is behind it.
    blending: additive ? AdditiveBlending : NormalBlending,
  });
}

export interface FlameOptions {
  /** Height in metres. */
  height?: number;
  /** Width in metres. Defaults to half the height. */
  width?: number;
  /** Icosphere subdivisions. 3 is 1280 triangles and plenty at table scale. */
  detail?: number;
  /** Add the additive outer shell that stands in for a bloom pass. */
  glow?: boolean;
  /**
   * Seconds to start the clock at.
   *
   * Flames standing together need different offsets, or they flicker and
   * writhe in perfect unison and the group reads as one object pulsing.
   */
  phase?: number;
}

/**
 * One flame. Parent `object` to whatever should carry it and call `update`
 * every frame; nothing else is needed.
 */
export class Flame {
  readonly object: Group;
  private readonly mats: ShaderMaterial[] = [];
  private readonly geo: BufferGeometry;
  private t = 0;
  private opacity = 1;
  /** Peak swing of the distortion amplitude, as a fraction of itself. */
  private flicker = 0.55;

  constructor(opts: FlameOptions = {}) {
    const height = opts.height ?? 0.2;
    const width = opts.width ?? height * 0.5;
    this.t = opts.phase ?? 0;
    this.geo = flameGeometry(opts.detail ?? 3);
    this.object = new Group();
    this.object.name = 'Flame';

    const core = new Mesh(this.geo, createFlameMaterial(false));
    core.renderOrder = 7;
    core.frustumCulled = false;
    this.object.add(core);
    this.mats.push(core.material as ShaderMaterial);

    if (opts.glow !== false) {
      const glow = new Mesh(this.geo, createFlameMaterial(true));
      glow.renderOrder = 6;
      glow.frustumCulled = false;
      // Sits proud of the body and stays faint: a halo, not a second flame.
      glow.scale.set(1.16, 1.08, 1.16);
      glow.position.y = -0.02;
      (glow.material as ShaderMaterial).uniforms.uOpacity.value = 0.34;
      this.object.add(glow);
      this.mats.push(glow.material as ShaderMaterial);
    }
    this.object.scale.set(width, height, width);
    this.object.rotation.y = this.t * 2.7;
  }

  /** How much the flame flickers, 0 (steady) to about 1 (guttering). */
  setFlicker(amount: number): void {
    this.flicker = Math.max(0, amount);
  }

  /** Re-proportion an existing flame, for callers that scatter a crowd of them. */
  setSize(width: number, height: number): void {
    this.object.scale.set(width, height, width);
  }

  setOpacity(value: number): void {
    this.opacity = value;
    this.mats[0].uniforms.uOpacity.value = value;
    if (this.mats[1]) this.mats[1].uniforms.uOpacity.value = value * 0.34;
  }

  getOpacity(): number {
    return this.opacity;
  }

  update(dt: number): void {
    this.t += dt;
    // Three incommensurate waves: a cheap stand-in for a flicker curve, with no
    // period short enough to hear as a rhythm.
    const f =
      1 +
      this.flicker *
        (Math.sin(this.t * 11.3) * 0.5 + Math.sin(this.t * 17.7 + 1.3) * 0.3 + Math.sin(this.t * 29.1 + 2.6) * 0.2);
    for (const m of this.mats) {
      m.uniforms.uTime.value = this.t;
      m.uniforms.uFlicker.value = f;
    }
    this.object.rotation.y += dt * SPIN;
  }

  /** Materials only: the geometry is shared app-wide and outlives any flame. */
  dispose(): void {
    for (const m of this.mats) m.dispose();
  }
}

/**
 * Seconds the particle blast has the moment to itself before anything catches.
 *
 * The explosion is the event; the fire is its aftermath. Lighting them
 * together made the flames part of the bang, and the bang then had nothing to
 * leave behind.
 */
const CATCH_LEAD = 0.2;
/** Seconds between the first flame catching and the last one. */
const CATCH_SPREAD = 0.34;
/** Seconds one flame burns, before its own jitter is applied. */
const FLAME_LIFE = 1.45;
/** Fraction of its life a flame spends springing up to full size. */
const SPRING = 0.11;

export interface FlameBurstOptions {
  /** How far from the centre flames can land, in metres. */
  spread?: number;
  /** Height of the tallest flame, in metres. The rest scale down from it. */
  height?: number;
  /** How many flames are in the pool. */
  count?: number;
}

/** One flame's scatter: where it landed, when it catches, how long it lasts. */
interface Tongue {
  flame: Flame;
  /** Seconds after ignition that this one catches. */
  start: number;
  life: number;
  /** Its settled height in metres, which the spring overshoots on the way up. */
  h: number;
}

/**
 * Fire breaking out around a point, after the blast that started it.
 *
 * Scattered, not arranged. Every flame picks its own spot, size and moment at
 * ignition, so no two bursts are alike and none of them reads as a pattern —
 * an evenly spaced ring is the one arrangement that announces it was placed
 * by a machine. They land across a disc rather than on its edge, which puts
 * fire in front of and behind the loser as well as beside them.
 *
 * Each tongue springs up, burns, and gutters out on its own clock, so the fire
 * dies back raggedly instead of the whole group fading as one object.
 */
export class FlameBurst {
  readonly object: Group;
  private readonly tongues: Tongue[] = [];
  private readonly spread: number;
  private readonly height: number;
  /** Seconds into the burst; negative when nothing is burning. */
  private t = -1;

  constructor(opts: FlameBurstOptions = {}) {
    this.spread = opts.spread ?? 0.08;
    this.height = opts.height ?? 0.09;
    const count = opts.count ?? 14;
    this.object = new Group();
    this.object.name = 'FlameBurst';
    this.object.visible = false;
    for (let i = 0; i < count; i++) {
      const flame = new Flame({
        height: this.height,
        width: this.height * 0.52,
        // Small and brief: detail 3 would be 1280 triangles a dozen times over
        // for something on screen under two seconds.
        detail: 2,
        // Every third tongue carries the halo. A dozen additive shells stacked
        // around one point is a lot of overdraw for very little extra glow.
        glow: i % 3 === 0,
        phase: i * 0.37,
      });
      flame.setFlicker(0.8);
      this.object.add(flame.object);
      this.tongues.push({ flame, start: 0, life: FLAME_LIFE, h: this.height });
    }
  }

  get burning(): boolean {
    return this.t >= 0;
  }

  /** Scatter the flames afresh and start the clock. */
  ignite(): void {
    this.t = 0;
    this.object.visible = true;
    for (const tongue of this.tongues) {
      // sqrt keeps the scatter even across the disc instead of crowding the
      // middle, which is what sampling the radius directly would do.
      const r = this.spread * Math.sqrt(Math.random());
      const a = Math.random() * Math.PI * 2;
      // Caps at 1, so `height` is the tallest a flame can get rather than an
      // average some of them overshoot.
      const size = 0.34 + Math.random() * 0.66;
      tongue.h = this.height * size;
      tongue.flame.object.position.set(Math.sin(a) * r, 0, Math.cos(a) * r);
      tongue.flame.setSize(tongue.h * (0.46 + Math.random() * 0.2), tongue.h);
      tongue.flame.setOpacity(0);
      tongue.start = CATCH_LEAD + Math.random() * CATCH_SPREAD;
      tongue.life = FLAME_LIFE * (0.7 + Math.random() * 0.6);
    }
  }

  stop(): void {
    this.t = -1;
    this.object.visible = false;
  }

  update(dt: number): void {
    if (this.t < 0) return;
    this.t += dt;
    let alight = false;
    for (const tongue of this.tongues) {
      const local = this.t - tongue.start;
      if (local < 0) {
        alight = true;
        continue;
      }
      const k = local / tongue.life;
      if (k >= 1) {
        tongue.flame.setOpacity(0);
        continue;
      }
      alight = true;
      // Spring up past full height, settle, burn, gutter out.
      const grow =
        k < SPRING ? (k / SPRING) * 1.18
        : k < SPRING * 2.4 ? 1.18 - ((k - SPRING) / (SPRING * 1.4)) * 0.18
        : 1;
      tongue.flame.object.scale.y = tongue.h * grow;
      tongue.flame.setOpacity(k > 0.62 ? (1 - k) / 0.38 : 1);
      tongue.flame.update(dt);
    }
    if (!alight) this.stop();
  }

  dispose(): void {
    for (const tongue of this.tongues) tongue.flame.dispose();
  }
}
