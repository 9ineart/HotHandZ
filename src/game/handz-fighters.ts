import { AssetManager, Box3, Group } from '@iwsdk/core';
import type { Material, Mesh, Object3D } from '@iwsdk/core';
import type { HeroKind } from './protocol.js';

/**
 * Fighters built from the HANDZ glTF hands instead of the procedural
 * sculptures, baked out of the pack's rig at the gesture frames.
 *
 * Returns null until the glTF has loaded; CombatSystem falls back to the
 * procedural hand for that round rather than spawning nothing.
 */

const ASSET: Record<HeroKind, string> = {
  titan: 'hca-hand-rock',
  mystic: 'hca-hand-paper',
  assassin: 'hca-hand-scissors',
};

const ROOT_NAME: Record<HeroKind, string> = {
  titan: 'RockFighter',
  mystic: 'PaperFighter',
  assassin: 'ScissorsFighter',
};

/**
 * Target heights in metres.
 *
 * Not the procedural fighters' heights: those covered a plinth, a long forearm
 * and the hand, so the hand itself was well under half the figure. These
 * models are hand plus a short wrist stub, so matching the old numbers made
 * the hands tower over the stage. About 0.62x of them puts the hand back at
 * the size it used to read.
 */
const HEIGHT: Record<HeroKind, number> = { titan: 0.05, mystic: 0.072, assassin: 0.068 };

export function createHandzFighter(kind: HeroKind): Group | null {
  const gltf = AssetManager.getGLTF(ASSET[kind]);
  if (!gltf) return null;
  const model = gltf.scene;

  // getGLTF hands back a fresh Object3D tree but shares geometries and
  // materials by reference. The dissolve writes opacity per fighter, so
  // without its own material copy, retiring one hand would fade the other.
  model.traverse((o: Object3D) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map((m: Material) => m.clone())
      : (mesh.material as Material).clone();
    mesh.castShadow = false;
  });

  // Scale to the fighter's height and stand it on the floor, so the podium
  // contact point stays the origin the combat animator expects.
  const box = new Box3().setFromObject(model);
  const height = Math.max(1e-4, box.max.y - box.min.y);
  const scale = HEIGHT[kind] / height;
  model.scale.setScalar(scale);
  model.position.y = -box.min.y * scale;

  const root = new Group();
  root.name = ROOT_NAME[kind];
  const body = new Group();
  body.name = 'Body';
  body.add(model);
  root.add(body);

  // Rig contract: the animator rotates Body, and ArmL/ArmR for the Scissors
  // snip. These are empty pivots for now -- the skeleton is in the asset, but
  // driving finger bones from the existing rotation.z offsets needs its own
  // pass, so the snip does not articulate yet.
  for (const n of ['ArmL', 'ArmR']) {
    const pivot = new Group();
    pivot.name = n;
    body.add(pivot);
  }

  root.userData.heightM = HEIGHT[kind];
  return root;
}
