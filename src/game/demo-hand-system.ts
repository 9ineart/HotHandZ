import { Color, createSystem, Quaternion, Vector3 } from '@iwsdk/core';
import type { Group, Mesh, MeshStandardMaterial, Object3D } from '@iwsdk/core';
import {
  createPaperHand,
  createRockFist,
  createScissorsHand,
} from '../scene-assets/heroes.scene-asset.js';
import { getGame } from './context.js';
import type { GameContext } from './context.js';
import { PLAYER_COLOR } from './players.js';
import type { Gesture } from './protocol.js';

const SCALE = 3.2;

/**
 * The large demonstration hand that floats beside the lobby during onboarding:
 * it waves on "Raise your hand" and "Looking for a challenger", and shows the
 * exact pose to copy during the gesture tutorial.
 */
export class DemoHandSystem extends createSystem({}) {
  private ctx!: GameContext;
  private lobby!: Object3D;
  private hands = {} as Record<Gesture, Group>;
  private shown: Gesture | null = null;
  private pop = 0;

  private readonly right = new Vector3();
  private readonly up = new Vector3();
  private readonly q = new Quaternion();
  private readonly axisY = new Vector3(0, 1, 0);
  private readonly axisZ = new Vector3(0, 0, 1);

  init(): void {
    this.ctx = getGame(this.world);
    this.lobby = this.world.requireSceneObject<Object3D>('lobby-panel');
    const make: Record<Gesture, () => Group> = {
      rock: createRockFist,
      paper: createPaperHand,
      scissors: createScissorsHand,
    };
    for (const g of ['rock', 'paper', 'scissors'] as const) {
      const hand = make[g]();
      hand.name = `DemoHand-${g}`;
      const plinth = hand.getObjectByName('Plinth');
      if (plinth) plinth.visible = false;
      const ring = hand.getObjectByName('RuneRing');
      if (ring) ring.visible = false;
      // Own glowing material copies so the demo pops against passthrough
      // without changing the fighters on the arena.
      hand.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        const mat = (mesh.material as MeshStandardMaterial).clone();
        // Your colour, matching the fighter that will stand on your pad.
        mat.color.lerp(new Color(PLAYER_COLOR[0]), 0.72);
        mat.emissive = new Color(PLAYER_COLOR[0]);
        mat.emissiveIntensity = 0.22;
        mesh.material = mat;
      });
      hand.visible = false;
      this.world.createTransformEntity(hand, { persistent: true });
      this.hands[g] = hand;
    }
  }

  update(delta: number, time: number): void {
    const { pose, wave } = this.ctx.demo;
    const want = this.lobby.visible ? pose : null;
    if (want !== this.shown) {
      if (this.shown) this.hands[this.shown].visible = false;
      this.shown = want;
      this.pop = 0;
    }
    if (!want) return;
    const hand = this.hands[want];
    hand.visible = true;
    this.pop = Math.min(1, this.pop + delta * 3);
    const k = 1 - Math.pow(1 - this.pop, 3);

    // Stand beside the panel's right edge, centred on its height.
    this.right.set(1, 0, 0).applyQuaternion(this.lobby.quaternion);
    this.up.set(0, 1, 0).applyQuaternion(this.lobby.quaternion);
    hand.position.copy(this.lobby.position).addScaledVector(this.right, 0.36).addScaledVector(this.up, -0.16);
    hand.quaternion.copy(this.lobby.quaternion);
    if (wave) this.q.setFromAxisAngle(this.axisZ, Math.sin(time * 4) * 0.28);
    else this.q.setFromAxisAngle(this.axisY, Math.sin(time * 1.1) * 0.45);
    hand.quaternion.multiply(this.q);
    hand.scale.setScalar(Math.max(0.0001, SCALE * k));

    // The steel V snips gently while it is on show.
    if (want === 'scissors') {
      const armR = hand.getObjectByName('ArmR');
      const armL = hand.getObjectByName('ArmL');
      const s = Math.abs(Math.sin(time * 2.5)) * 0.18;
      if (armR) armR.rotation.z = -0.24 - s;
      if (armL) armL.rotation.z = 0.14 + s;
    }
  }
}
