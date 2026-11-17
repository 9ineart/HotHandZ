import { AssetType, defineAssets } from '@iwsdk/core';
import { createArenaPreview } from './scene-assets/arena.scene-asset.js';
import {
  createPaperHand,
  createRockFist,
  createScissorsHand,
} from './scene-assets/heroes.scene-asset.js';

const publicAssetUrl = (filePath: string): string =>
  `${import.meta.env.BASE_URL}${filePath.replace(/^\/+/u, '')}`;

const uikitml = (fileName: string, name: string) => ({
  url: publicAssetUrl(`ui/${fileName}`),
  type: AssetType.UIKitML,
  name,
});

/**
 * The hand fighters and the arena are spawned at runtime by the game systems,
 * but they are also registered here so they can be inspected in the editor.
 */
export default defineAssets({
  'hca-arena': createArenaPreview(),
  'hca-rock-fist': createRockFist(),
  'hca-paper-hand': createPaperHand(),
  'hca-scissors-hand': createScissorsHand(),
  'hca-lobby': uikitml('lobby.uikitml', 'Lobby Panel'),
  'hca-hud': uikitml('hud.uikitml', 'Match HUD'),
  'hca-card': uikitml('card.uikitml', 'Fighter Card'),
  'hca-plate': uikitml('plate.uikitml', 'Fighter Plate'),
  'hca-points': uikitml('points.uikitml', 'Round Points'),
  // The hand menu and the three panels it opens.
  'hca-kiosk': uikitml('kiosk.uikitml', 'Hand Menu'),
  'hca-achievements': uikitml('achievements.uikitml', 'Achievements'),
  'hca-leaderboard': uikitml('leaderboard.uikitml', 'Leaderboard'),
  'hca-sound': uikitml('sound.uikitml', 'Sound Settings'),
  // HANDZ hands, baked out of the pack's Blender rig at the gesture frames
  // (5 rock, 10 paper, 18 scissors). Rigged: deform bones only, so fingers can
  // still be articulated at runtime.
  //
  // PARKED. The fighters use the procedural sculptures again; these stay
  // registered so re-enabling is one line in combat-system.ts. Background
  // priority so an unused asset never delays startup.
  'hca-hand-rock': { url: publicAssetUrl('models/hand-rock.glb'), type: AssetType.GLTF, name: 'Hand Rock', priority: 'background' },
  'hca-hand-paper': { url: publicAssetUrl('models/hand-paper.glb'), type: AssetType.GLTF, name: 'Hand Paper', priority: 'background' },
  'hca-hand-scissors': { url: publicAssetUrl('models/hand-scissors.glb'), type: AssetType.GLTF, name: 'Hand Scissors', priority: 'background' },
  // The temple-courtyard diorama, baked out of the project's Blender set:
  // textures downscaled to 512, duplicate datablocks merged, meshes joined per
  // material, cropped, and recentred so the origin is the courtyard's centre
  // at floor level with +Z toward the local player. StageSystem scales it to
  // the calibrated arena.
  'hca-courtyard': {
    url: publicAssetUrl('models/courtyard.glb'),
    type: AssetType.GLTF,
    name: 'Temple Courtyard',
    priority: 'background',
  },
  // Imported glTF. The space in the file name must stay percent-encoded.
  // Superseded by hca-courtyard; kept registered so the old island is one
  // line away if the courtyard is ever backed out.
  'hca-stage-1': {
    url: publicAssetUrl('models/Stage%201.glb'),
    type: AssetType.GLTF,
    name: 'Stage 1',
    // 1.9 MB: load after the critical assets rather than blocking startup.
    priority: 'background',
  },
});
