import {
  BoxGeometry,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  PlaneGeometry,
} from '@iwsdk/core';
import {
  PALETTE,
  createArenaFloorMaterial,
  createHoloRingMaterial,
} from '../game/fx.js';
import { ARENA_D, ARENA_W } from '../game/arena-shape.js';
import { cyl, group, mesh, std } from './kit.js';

/**
 * Holographic tabletop arena. Origin = centre of the table surface, +Y up,
 * +Z points toward the local player ("you" side), -Z toward the rival.
 *
 * Named parts used at runtime:
 *   Floor (ShaderMaterial uReveal/uTime), PadYou, PadRival (ring materials),
 *   CoreYou, CoreRival (crystals), HpYou/HpRival > Fill (scale.x = hp fraction).
 */
export function buildArena(width = ARENA_W, depth = ARENA_D): Group {
  const root = group('Arena');
  root.userData.width = width;
  root.userData.depth = depth;

  const shade = new Mesh(
    new PlaneGeometry(width, depth),
    new MeshBasicMaterial({ color: '#02060c', transparent: true, opacity: 0.35, depthWrite: false }),
  );
  shade.name = 'Shade';
  shade.rotation.x = -Math.PI / 2;
  shade.position.y = 0.0006;
  shade.renderOrder = 1;

  const floorMat = createArenaFloorMaterial(new Color('#2fb8ff'), PALETTE.you);
  floorMat.uniforms.uSize.value.set(width, depth, 0);
  const floor = new Mesh(new PlaneGeometry(width, depth), floorMat);
  floor.name = 'Floor';
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.0012;
  floor.renderOrder = 2;
  root.add(shade, floor);

  const pylonMat = std('#1a2230', { metal: 0.8, rough: 0.3 });
  const youHex = `#${PALETTE.you.getHexString()}`;
  const pylonGlow = std(youHex, { emissive: youHex, glow: 2 });
  const ix = width / 2 - 0.022;
  const iz = depth / 2 - 0.022;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const p = group('Pylon', sx * ix, 0, sz * iz,
      mesh('PylonBody', cyl(0.007, 0.01, 0.026, 6), pylonMat, 0, 0.013, 0),
      mesh('PylonCap', cyl(0.004, 0.007, 0.006, 6), pylonGlow, 0, 0.029, 0),
    );
    root.add(p);
  }

  const padZ = depth * 0.24;
  for (const [name, z, color] of [
    ['PadYou', padZ, PALETTE.you],
    ['PadRival', -padZ, PALETTE.rival],
  ] as const) {
    // Painted, not added: the courtyard deck is pale stone, and an additive
    // ring over it clips straight to white, taking the player's colour with
    // it. These rings have to say whose square this is, so they paint.
    const mat = createHoloRingMaterial(color, false);
    mat.uniforms.uInner.value = 0.82;
    mat.uniforms.uGlow.value = 0.18;
    const pad = new Mesh(new PlaneGeometry(0.1, 0.1), mat);
    pad.name = name;
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(0, 0.002, z);
    pad.renderOrder = 3;
    root.add(pad);
  }

  const coreZ = depth / 2 - 0.035;
  const hpGeo = new BoxGeometry(0.12, 0.007, 0.004);
  const fillGeo = new BoxGeometry(0.116, 0.0045, 0.005);
  fillGeo.translate(0.058, 0, 0); // scale from the left end
  for (const [side, z, color] of [
    ['You', coreZ, PALETTE.you],
    ['Rival', -coreZ, PALETTE.rival],
  ] as const) {
    const crystalMat = std(`#${color.getHexString()}`, {
      emissive: `#${color.getHexString()}`,
      glow: 1.8,
      metal: 0.2,
      rough: 0.1,
    });
    const crystal = mesh(`Core${side}`, new OctahedronGeometry(0.012, 0), crystalMat, 0, 0.032, z);
    crystal.scale.set(1, 1.6, 1);
    const pedestal = mesh(`Pedestal${side}`, cyl(0.012, 0.016, 0.01, 6), pylonMat, 0, 0.005, z);
    const hp = group(`Hp${side}`, 0, 0.07, z);
    const frame = mesh('Frame', hpGeo, new MeshBasicMaterial({ color: '#0b1220', transparent: true, opacity: 0.8 }));
    const fill = mesh('Fill', fillGeo, new MeshBasicMaterial({ color }), -0.058, 0, 0.001);
    hp.add(frame, fill);
    hp.rotation.x = -0.35; // tilt toward the viewer
    root.add(pedestal, crystal, hp);
  }
  return root;
}

export function createArenaPreview(): Group {
  return buildArena(0.6, 0.4);
}
