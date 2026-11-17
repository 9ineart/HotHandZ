import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  NormalBlending,
  Object3D,
  PlaneGeometry,
  Points,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from '@iwsdk/core';
import { PLAYER_COLOR } from './players.js';

/**
 * A fixed-size additive particle pool in world space. emit() only writes into
 * preallocated typed arrays, so effects can fire every frame without garbage.
 */
export class ParticlePool {
  readonly points: Points;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly col: Float32Array;
  private readonly size: Float32Array;
  private readonly baseSize: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly drag: Float32Array;
  private readonly gravity: Float32Array;
  private readonly geo: BufferGeometry;
  private cursor = 0;

  constructor(readonly capacity = 2400) {
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 4);
    this.size = new Float32Array(capacity);
    this.baseSize = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.gravity = new Float32Array(capacity);
    this.geo = new BufferGeometry();
    this.geo.setAttribute('position', new BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new BufferAttribute(this.col, 4));
    this.geo.setAttribute('size', new BufferAttribute(this.size, 1));
    const mat = new ShaderMaterial({
      uniforms: { uScale: { value: 1100 } },
      vertexShader: /* glsl */ `
        attribute float size;
        attribute vec4 color;
        varying vec4 vColor;
        uniform float uScale;
        void main() {
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * uScale / max(0.05, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec4 vColor;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float r = length(d) * 2.0;
          float a = smoothstep(1.0, 0.0, r);
          a *= a;
          if (vColor.a * a < 0.01) discard;
          gl_FragColor = vec4(vColor.rgb * (0.6 + 0.8 * (1.0 - r)), vColor.a * a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.points = new Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    this.points.name = 'FxParticles';
  }

  emit(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    color: Color,
    life: number,
    size: number,
    drag = 1.5,
    gravity = 0,
  ): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.col[i * 4] = color.r;
    this.col[i * 4 + 1] = color.g;
    this.col[i * 4 + 2] = color.b;
    this.col[i * 4 + 3] = 1;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.baseSize[i] = size;
    this.size[i] = size;
    this.drag[i] = drag;
    this.gravity[i] = gravity;
  }

  /** Burst of particles from a point in random directions. */
  burst(
    at: Vector3,
    count: number,
    color: Color,
    speed: number,
    life: number,
    size: number,
    upBias = 0,
    gravity = 0,
  ): void {
    for (let n = 0; n < count; n++) {
      const u = Math.random() * 2 - 1;
      const t = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const sp = speed * (0.35 + Math.random() * 0.65);
      this.emit(
        at.x,
        at.y,
        at.z,
        s * Math.cos(t) * sp,
        (u + upBias) * sp,
        s * Math.sin(t) * sp,
        color,
        life * (0.6 + Math.random() * 0.6),
        size * (0.6 + Math.random() * 0.8),
        2,
        gravity,
      );
    }
  }

  update(dt: number): void {
    const n = this.capacity;
    for (let i = 0; i < n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.col[i * 4 + 3] = 0;
        this.size[i] = 0;
        continue;
      }
      const k = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= k;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k - this.gravity[i] * dt;
      this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const t = this.life[i] / this.maxLife[i];
      this.col[i * 4 + 3] = t < 0.3 ? t / 0.3 : 1;
      this.size[i] = this.baseSize[i] * (0.4 + 0.6 * t);
    }
    (this.geo.attributes.position as BufferAttribute).needsUpdate = true;
    (this.geo.attributes.color as BufferAttribute).needsUpdate = true;
    (this.geo.attributes.size as BufferAttribute).needsUpdate = true;
  }
}

/**
 * Holographic disc used for calibration progress rings, spawn pads and
 * shockwaves: a ring whose arc fills with `progress`, with a soft inner glow.
 */
export function createHoloRingMaterial(color: Color, additive = true): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uColor: { value: color.clone() },
      uProgress: { value: 1 },
      uOpacity: { value: 1 },
      uTime: { value: 0 },
      uInner: { value: 0.78 },
      uGlow: { value: 0.35 },
      // Over-bright only helps when the ring is being added to what is behind
      // it. Painted over pale stone it would just clip the hue away to white.
      uLift: { value: additive ? 1 : 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv * 2.0 - 1.0;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      #define PI 3.14159265
      uniform vec3 uColor;
      uniform float uProgress;
      uniform float uOpacity;
      uniform float uTime;
      uniform float uInner;
      uniform float uGlow;
      uniform float uLift;
      varying vec2 vUv;
      void main() {
        float r = length(vUv);
        if (r > 1.0) discard;
        float ang = atan(vUv.x, vUv.y) / (2.0 * PI) + 0.5;
        float band = smoothstep(uInner - 0.04, uInner, r) * (1.0 - smoothstep(0.96, 1.0, r));
        float filled = step(ang, uProgress);
        float track = band * (0.18 + 0.82 * filled);
        float ticks = step(0.92, fract(ang * 36.0 + uTime * 0.2)) * band * 0.4;
        float inner = (1.0 - smoothstep(0.0, uInner, r)) * uGlow * uProgress;
        float pulse = 0.85 + 0.15 * sin(uTime * 6.0 - r * 10.0);
        float a = (track + ticks + inner * pulse) * uOpacity;
        gl_FragColor = vec4(uColor * (1.0 + filled * band * uLift), a);
        // Three converts a hex to linear working space on the way in. A raw
        // ShaderMaterial gets no automatic encode on the way out, so without
        // this the linear numbers are written straight to an sRGB buffer and
        // #ffb56e lands on screen as a hot #ff7222. The ring has to be the
        // colour the player was promised.
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: additive ? AdditiveBlending : NormalBlending,
  });
}

/**
 * One-shot version of the deck ripple: soft rings racing outward once.
 *
 * `uAge` runs 0 to 1 over the effect's life and drives the expansion, so the
 * mesh itself stays a fixed size. Anything that used to grow a ring by
 * scaling a quad should hold its scale still and drive this instead, or the
 * two expansions compound and the ring slides off its own geometry.
 */
export function createRippleBurstMaterial(color: Color): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uColor: { value: color.clone() },
      uAge: { value: 0 },
      uOpacity: { value: 1 },
      uFronts: { value: 3 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv * 2.0 - 1.0;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uAge;
      uniform float uOpacity;
      uniform float uFronts;
      varying vec2 vUv;
      void main() {
        float r = length(vUv);
        if (r > 1.0) discard;
        float a = 0.0;
        for (int i = 0; i < 3; i++) {
          if (float(i) >= uFronts) break;
          float phase = uAge - float(i) * 0.16;
          if (phase <= 0.0 || phase >= 1.0) continue;
          a += smoothstep(0.14, 0.0, abs(r - phase)) * (1.0 - phase) * (1.0 - phase);
        }
        a *= uOpacity * (1.0 - smoothstep(0.88, 1.0, r));
        gl_FragColor = vec4(uColor, a);
      }`,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: AdditiveBlending,
  });
}

/**
 * A small pool of one-shot ripples, placeable anywhere in world space.
 *
 * Every expanding circle in the game draws from this so they share one look:
 * the gesture confirmation at your hand, the calibration rings merging, the
 * combat shockwave. Each slot owns its material copy, because colour and age
 * differ per ripple, but they all share one geometry.
 */
export class RipplePool {
  readonly group: Group;
  private readonly slots: { mesh: Mesh; mat: ShaderMaterial; t: number; dur: number }[] = [];
  private cursor = 0;
  private readonly q = new Quaternion();
  private readonly from = new Vector3(0, 0, 1);

  constructor(count = 8) {
    this.group = new Group();
    this.group.name = 'Ripples';
    const geo = new PlaneGeometry(1, 1);
    for (let i = 0; i < count; i++) {
      const mat = createRippleBurstMaterial(new Color('#ffffff'));
      const mesh = new Mesh(geo, mat);
      mesh.visible = false;
      mesh.renderOrder = 6;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.slots.push({ mesh, mat, t: -1, dur: 1 });
    }
  }

  /**
   * Fire a ripple centred on `at`, lying in the plane whose normal is
   * `normal`. `radius` is the distance the outermost ring reaches.
   */
  emit(at: Vector3, normal: Vector3, radius: number, color: Color, life = 0.6, fronts = 3): void {
    const slot = this.slots[this.cursor];
    this.cursor = (this.cursor + 1) % this.slots.length;
    slot.t = 0;
    slot.dur = Math.max(1e-3, life);
    slot.mesh.visible = true;
    slot.mesh.position.copy(at);
    this.q.setFromUnitVectors(this.from, normal.clone().normalize());
    slot.mesh.quaternion.copy(this.q);
    slot.mesh.scale.setScalar(Math.max(1e-4, radius * 2));
    slot.mat.uniforms.uColor.value.copy(color);
    slot.mat.uniforms.uAge.value = 0;
    slot.mat.uniforms.uOpacity.value = 1;
    slot.mat.uniforms.uFronts.value = fronts;
  }

  update(dt: number): void {
    for (const slot of this.slots) {
      if (slot.t < 0) continue;
      slot.t += dt;
      const k = slot.t / slot.dur;
      if (k >= 1) {
        slot.t = -1;
        slot.mesh.visible = false;
        continue;
      }
      slot.mat.uniforms.uAge.value = k;
      // Hold full strength early, then fade, so the leading ring stays crisp.
      slot.mat.uniforms.uOpacity.value = 1 - Math.max(0, (k - 0.55) / 0.45);
    }
  }
}


/** Rounded-rectangle holographic boundary + grid floor for the arena. */
export function createArenaFloorMaterial(color: Color, accent: Color): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uColor: { value: color.clone() },
      uAccent: { value: accent.clone() },
      uSize: { value: new Vector3(0.6, 0.4, 0) },
      uReveal: { value: 1 },
      uOpacity: { value: 1 },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vPos;
      uniform vec3 uSize;
      void main() {
        vPos = (uv - 0.5) * uSize.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform vec3 uAccent;
      uniform vec3 uSize;
      uniform float uReveal;
      uniform float uOpacity;
      uniform float uTime;
      varying vec2 vPos;
      float sdRoundBox(vec2 p, vec2 b, float r) {
        vec2 q = abs(p) - b + r;
        return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
      }
      void main() {
        vec2 halfSize = uSize.xy * 0.5;
        float d = sdRoundBox(vPos, halfSize - 0.004, 0.04);
        if (d > 0.002) discard;
        // radial reveal from the centre
        float rr = length(vPos / halfSize);
        float reveal = smoothstep(uReveal * 1.5, uReveal * 1.5 - 0.15, rr);
        // grid
        vec2 g = abs(fract(vPos / 0.04) - 0.5);
        float grid = 1.0 - smoothstep(0.0, 0.05, min(g.x, g.y));
        float edgeFade = smoothstep(0.0, -0.06, d);
        // border glow
        float border = exp(-abs(d) * 420.0) + exp(-abs(d + 0.012) * 900.0) * 0.6;
        // centre line + scan wave
        float mid = exp(-abs(vPos.y) * 700.0) * 0.5;
        float scan = exp(-abs(fract(vPos.y * 2.0 - uTime * 0.25) - 0.5) * 40.0) * 0.12;
        vec3 col = uColor * (grid * 0.22 * edgeFade + scan + 0.05) + uAccent * (border + mid);
        float a = (grid * 0.18 * edgeFade + border + mid + scan + 0.06) * reveal * uOpacity;
        gl_FragColor = vec4(col, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
}

/** Simple additive fresnel shell for shields and the summon beam. */
export function createFresnelMaterial(color: Color): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uColor: { value: color.clone() },
      uOpacity: { value: 1 },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vV;
      varying vec3 vP;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        vP = position;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uTime;
      varying vec3 vN;
      varying vec3 vV;
      varying vec3 vP;
      void main() {
        float f = pow(1.0 - abs(dot(vN, vV)), 2.2);
        float hex = 0.5 + 0.5 * sin(vP.y * 260.0 - uTime * 8.0);
        float a = (f * 0.9 + 0.08 + hex * 0.06) * uOpacity;
        gl_FragColor = vec4(uColor * (0.7 + f), a);
      }`,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: AdditiveBlending,
  });
}

/** Set the opacity uniform (or material.opacity) on every mesh under root. */
export function setTreeOpacity(root: Object3D, opacity: number): void {
  root.traverse((o) => {
    const mat = (o as { material?: unknown }).material as
      | { uniforms?: Record<string, { value: unknown }>; opacity?: number; transparent?: boolean }
      | undefined;
    if (!mat) return;
    if (mat.uniforms?.uOpacity) mat.uniforms.uOpacity.value = opacity;
    else if (typeof mat.opacity === 'number') {
      mat.transparent = true;
      mat.opacity = opacity;
    }
  });
}

export const PALETTE = {
  you: new Color(PLAYER_COLOR[0]),
  rival: new Color(PLAYER_COLOR[1]),
  titan: new Color('#ff5a36'),
  mystic: new Color('#4da3ff'),
  assassin: new Color('#3ddc84'),
  white: new Color('#ffffff'),
  gold: new Color('#ffd166'),
  danger: new Color('#ff3b3b'),
};
