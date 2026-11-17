import {
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  Group,
  LatheGeometry,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector2,
} from '@iwsdk/core';
import type { BufferGeometry, Material, Object3D } from '@iwsdk/core';

/** Small deterministic construction helpers shared by the hero and arena models. */

export function std(
  color: string,
  opts: { metal?: number; rough?: number; emissive?: string; glow?: number } = {},
): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color: new Color(color),
    metalness: opts.metal ?? 0.35,
    roughness: opts.rough ?? 0.55,
    emissive: new Color(opts.emissive ?? '#000000'),
    emissiveIntensity: opts.glow ?? 0,
  });
}

export function mesh(
  name: string,
  geo: BufferGeometry,
  mat: Material,
  x = 0,
  y = 0,
  z = 0,
): Mesh {
  const m = new Mesh(geo, mat);
  m.name = name;
  m.position.set(x, y, z);
  m.castShadow = false;
  m.receiveShadow = false;
  return m;
}

export function group(name: string, x = 0, y = 0, z = 0, ...children: Object3D[]): Group {
  const g = new Group();
  g.name = name;
  g.position.set(x, y, z);
  for (const c of children) g.add(c);
  return g;
}

/** Lathe from [radius, height] pairs (meters). */
export function lathe(profile: [number, number][], segments = 20): LatheGeometry {
  return new LatheGeometry(
    profile.map(([r, h]) => new Vector2(r, h)),
    segments,
  );
}

/** Capsule spanning `length` along +Y from its base (origin at the bottom cap). */
export function limb(radius: number, length: number, seg = 8): CapsuleGeometry {
  const g = new CapsuleGeometry(radius, Math.max(0.0001, length - radius * 2), 4, seg);
  g.translate(0, length / 2, 0);
  return g;
}

export function sphere(r: number, w = 14, h = 10): SphereGeometry {
  return new SphereGeometry(r, w, h);
}

export function cyl(rTop: number, rBot: number, h: number, seg = 14): CylinderGeometry {
  return new CylinderGeometry(rTop, rBot, h, seg);
}

export function torus(r: number, tube: number, seg = 40): TorusGeometry {
  return new TorusGeometry(r, tube, 8, seg);
}
