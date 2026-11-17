import { AssetManager, createSystem, Group } from '@iwsdk/core';
import type { Mesh, Object3D } from '@iwsdk/core';
import { DECK_CENTER, DECK_WIDTH } from './arena-shape.js';
import { getGame } from './context.js';
import type { GameContext } from './context.js';

/**
 * The temple-courtyard diorama, spawned as a child of the calibrated arena.
 *
 * It replaces the Stage 1 rock island. That model was far wider than it was
 * deep, so once the arena took the courtyard's proportions no single scale
 * could fit it without stretching.
 *
 * The glTF's origin is the courtyard object's centre at floor level, with +Z
 * already pointing at the local player. The playable deck is not centred in
 * that object, though -- the water channel takes its southern third -- so the
 * set is shifted toward the player to bring the deck's middle onto the arena
 * origin. See arena-shape.ts for where the figures come from.
 *
 * The courtyard is the floor now, so the holographic floor and its shade
 * plane are switched off once it is in place. The boundary, pads, cores and
 * pylons stay: they mark the play area on top of the tile.
 */
export class StageSystem extends createSystem({}) {
  private ctx!: GameContext;
  private set: Object3D | null = null;
  private sizedFor = '';

  init(): void {
    this.ctx = getGame(this.world);
    // Recalibrating rebuilds the arena visual and changes the footprint, so
    // refit the set and hide the freshly built floor again.
    this.cleanupFuncs.push(this.ctx.events.on('arenaReady', () => (this.sizedFor = '')));
  }

  update(): void {
    const arena = this.ctx.arena;
    if (!arena.ready || !arena.entity || !arena.object) return;

    if (!this.set) {
      // Null until the background load finishes; retried next frame.
      const gltf = AssetManager.getGLTF('hca-courtyard');
      if (!gltf) return;
      // The entity goes on a wrapper, and the model is scaled as its child.
      // A transform entity's own Object3D is driven by its Transform
      // component every frame, so a scale written straight onto it is
      // overwritten and the 3.6 m set renders at full size around the player.
      const root = new Group();
      root.name = 'Courtyard';
      root.add(gltf.scene);
      this.world.createTransformEntity(root, { parent: arena.entity, persistent: true });
      this.set = gltf.scene;
    }

    // The environment is the table, not a match prop: it stays up from
    // calibration onward rather than appearing when a round starts.
    this.set.visible = true;

    const key = arena.width.toFixed(3);
    if (key === this.sizedFor) return;
    this.sizedFor = key;

    // Uniform: the arena takes the deck's own proportions, so width alone
    // fixes the fit and the tiles stay square.
    const scale = arena.width / DECK_WIDTH;
    this.set.scale.setScalar(scale);
    // Model-space offset, applied in the parent's units: position is not
    // affected by the object's own scale.
    this.set.position.set(0, 0, DECK_CENTER * scale);

    this.hideHoloSurfaces();
  }

  /**
   * Drop every stand-in surface, so the courtyard's tile is what you see.
   *
   * The holographic floor and its shade plane covered the deck. The desktop
   * stand-in table is worse than that: its top sits at exactly the arena's
   * own height, so it is coplanar with the deck and wins the depth test,
   * which hid all of the courtyard's flat ground while leaving the raised
   * buildings and the overhanging causeway visible.
   *
   * Both only exist because there was no real floor before. There is now.
   */
  private hideHoloSurfaces(): void {
    const arena = this.ctx.arena.object;
    const visual = arena?.getObjectByName('ArenaVisual');
    for (const name of ['Floor', 'Shade']) {
      const part = visual?.getObjectByName(name) as Mesh | undefined;
      if (part) part.visible = false;
    }
    // The table is a sibling of the arena root, not one of its children.
    const table = arena?.parent?.getObjectByName('DesktopTable');
    if (table) table.visible = false;
  }
}
