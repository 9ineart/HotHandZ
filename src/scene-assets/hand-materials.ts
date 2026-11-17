import {
  Color,
  DataTexture,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
} from '@iwsdk/core';
import { makeRandom } from './lib/hardsurface.js';

/**
 * Deterministic procedural surface textures for the hand sculptures. Pure
 * typed-array generation (no canvas / DOM), so the manifest stays safe to
 * evaluate in both the runtime and editor realms.
 */

const N = 128;

/** Tileable value noise on an N x N lattice of `cells` cells per side. */
function valueNoise(seed: number, cells: number): (x: number, y: number) => number {
  const rand = makeRandom(seed);
  const lattice = new Float32Array(cells * cells);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rand();
  const at = (i: number, j: number) => lattice[((j % cells) + cells) % cells * cells + (((i % cells) + cells) % cells)];
  const fade = (t: number) => t * t * (3 - 2 * t);
  return (x, y) => {
    const fx = (x / N) * cells;
    const fy = (y / N) * cells;
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const u = fade(fx - i);
    const v = fade(fy - j);
    const a = at(i, j) + (at(i + 1, j) - at(i, j)) * u;
    const b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * u;
    return a + (b - a) * v;
  };
}

function texture(fill: (x: number, y: number) => [number, number, number], srgb: boolean, repeat = 1): DataTexture {
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const [r, g, b] = fill(x, y);
      const o = (y * N + x) * 4;
      data[o] = Math.max(0, Math.min(255, r * 255));
      data[o + 1] = Math.max(0, Math.min(255, g * 255));
      data[o + 2] = Math.max(0, Math.min(255, b * 255));
      data[o + 3] = 255;
    }
  const tex = new DataTexture(data, N, N);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  if (srgb) tex.colorSpace = SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// ---------- Rock: mottled granite with dark cracks ----------
function rockHeight(): (x: number, y: number) => number {
  const big = valueNoise(11, 8);
  const mid = valueNoise(12, 16);
  const fine = valueNoise(13, 64);
  const crack = valueNoise(14, 6);
  return (x, y) => {
    const h = big(x, y) * 0.55 + mid(x, y) * 0.3 + fine(x, y) * 0.15;
    // Thin dark veins where a low-frequency field crosses 0.5.
    const c = Math.abs(crack(x, y) - 0.5);
    return c < 0.025 ? h * 0.35 : h;
  };
}

export function rockMaterial(): MeshStandardMaterial {
  const h = rockHeight();
  const speck = valueNoise(15, 64);
  const map = texture((x, y) => {
    const v = h(x, y);
    const s = speck(x, y) > 0.78 ? 0.12 : 0;
    return [0.36 + v * 0.3 + s, 0.33 + v * 0.27 + s, 0.3 + v * 0.22 + s];
  }, true, 2);
  const bump = texture((x, y) => {
    const v = h(x, y);
    return [v, v, v];
  }, false, 2);
  return new MeshStandardMaterial({
    name: 'Stone',
    map,
    bumpMap: bump,
    bumpScale: 1.2,
    roughness: 0.95,
    metalness: 0.02,
  });
}

// ---------- Paper: warm off-white with fibres and fold creases ----------
export function paperMaterial(): MeshStandardMaterial {
  const fibre = valueNoise(21, 48);
  const blot = valueNoise(22, 6);
  const fibreFine = valueNoise(23, 96);
  const fold = (x: number, y: number) => {
    const d1 = Math.abs(((x + y) % 64) - 32) / 32; // diagonal creases
    const d2 = Math.abs((x % 42) - 21) / 21; // vertical creases
    return Math.min(d1, d2);
  };
  const map = texture((x, y) => {
    const f = fibre(x, y) * 0.04 + fibreFine(x, y) * 0.05 + blot(x, y) * 0.04;
    const crease = fold(x, y) < 0.05 ? -0.12 : fold(x, y) < 0.1 ? 0.04 : 0;
    const v = 0.86 + f + crease;
    return [v + 0.03, v + 0.01, v - 0.05];
  }, true, 1);
  const bump = texture((x, y) => {
    const v = 0.5 + fibreFine(x, y) * 0.2 + (fold(x, y) < 0.05 ? -0.4 : 0);
    return [v, v, v];
  }, false, 1);
  return new MeshStandardMaterial({
    name: 'Paper',
    map,
    bumpMap: bump,
    bumpScale: 0.6,
    roughness: 0.92,
    metalness: 0,
  });
}

// ---------- Scissors: brushed steel ----------
export function metalMaterial(): MeshStandardMaterial {
  const rand = makeRandom(31);
  // Streaks run along texture V (along each finger's length).
  const streak = new Float32Array(N);
  for (let i = 0; i < N; i++) streak[i] = rand();
  const wobble = valueNoise(32, 8);
  const map = texture((x, y) => {
    const s = streak[x] * 0.12 + wobble(x, y) * 0.06;
    const v = 0.72 + s;
    return [v * 0.97, v, v * 1.04];
  }, true, 1);
  const rough = texture((x) => {
    const r = 0.28 + streak[x] * 0.25;
    return [r, r, r];
  }, false, 1);
  return new MeshStandardMaterial({
    name: 'BrushedSteel',
    color: new Color('#ffffff'),
    map,
    roughnessMap: rough,
    roughness: 1,
    metalness: 1,
  });
}
