/**
 * Tiny synthesized sound effects (WebAudio), so the game ships with no audio
 * files. All sounds are short envelopes on oscillators / filtered noise.
 */
import { loadAudio, type AudioSettings } from './audio-settings.js';

let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;

/** Bus = which volume slider a sound answers to. See audio-settings.ts. */
type Bus = 'effects' | 'ui';
let master: GainNode | null = null;
const buses: Partial<Record<Bus, GainNode>> = {};
let mix: AudioSettings = loadAudio();

function ac(): AudioContext | null {
  if (typeof window === 'undefined' || !('AudioContext' in window)) return null;
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/**
 * The node a sound should connect to instead of `destination`.
 *
 * Built on first use, because an AudioContext cannot exist before the player
 * has interacted with the page. Falls back to the destination if anything
 * about the graph fails, so a broken mixer can never silence the game.
 */
function out(bus: Bus): AudioNode {
  const a = ac()!;
  if (!master) {
    master = a.createGain();
    master.connect(a.destination);
  }
  let node = buses[bus];
  if (!node) {
    node = a.createGain();
    node.connect(master);
    buses[bus] = node;
  }
  applyMix();
  return node;
}

function applyMix(): void {
  if (master) master.gain.value = mix.muted ? 0 : mix.master;
  if (buses.effects) buses.effects.gain.value = mix.effects;
  if (buses.ui) buses.ui.gain.value = mix.ui;
}

/** Called by the sound panel whenever the player moves a control. */
export function setAudioMix(next: AudioSettings): void {
  mix = next;
  applyMix();
}

export function getAudioMix(): AudioSettings {
  return mix;
}

function tone(freq: number, dur: number, type: OscillatorType, gain: number, slideTo?: number, bus: Bus = 'effects') {
  const a = ac();
  if (!a) return;
  const t = a.currentTime;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out(bus));
  o.start(t);
  o.stop(t + dur + 0.02);
}

function hiss(dur: number, gain: number, freq: number, bus: Bus = 'effects') {
  const a = ac();
  if (!a) return;
  if (!noise) {
    noise = a.createBuffer(1, a.sampleRate, a.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = a.currentTime;
  const src = a.createBufferSource();
  src.buffer = noise;
  const f = a.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  const g = a.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(out(bus));
  src.start(t);
  src.stop(t + dur);
}

export const sfx = {
  // Interface sounds carry information, so they ride their own bus and stay
  // audible when the combat mix is turned down.
  tick: () => tone(660, 0.12, 'sine', 0.15, undefined, 'ui'),
  go: () => tone(990, 0.35, 'triangle', 0.2, 1480, 'ui'),
  lock: () => tone(520, 0.15, 'square', 0.06, 780, 'ui'),
  /** Quiet "I can see your hand" chirp when a gesture is first recognised. */
  sense: () => tone(880, 0.07, 'sine', 0.045, undefined, 'ui'),
  /** Any button, on release. */
  tap: () => tone(740, 0.06, 'triangle', 0.08, undefined, 'ui'),
  /**
   * Any button, as a pointer or ray crosses onto it. Deliberately far quieter
   * and shorter than `tap`: in XR a ray sweeps over several buttons on the way
   * to the one you want, and a hover that announces itself becomes a rattle.
   */
  hover: () => tone(1180, 0.035, 'sine', 0.022, undefined, 'ui'),
  // One voice per fighter, so you know what the classifier read without
  // looking away from your hand. Deliberately softer than the combat sounds:
  // choosing is not the same event as landing a hit.
  rock: () => {
    tone(128, 0.2, 'sine', 0.3, 64);
    hiss(0.09, 0.1, 700);
  },
  paper: () => {
    hiss(0.24, 0.07, 2200);
    setTimeout(() => hiss(0.16, 0.05, 3200), 60);
  },
  scissors: () => {
    hiss(0.05, 0.16, 6200);
    setTimeout(() => hiss(0.05, 0.14, 7000), 75);
  },
  calibrated: () => {
    tone(440, 0.5, 'sine', 0.12, 880, 'ui');
    setTimeout(() => tone(660, 0.6, 'sine', 0.1, 1320, 'ui'), 120);
  },
  summon: () => {
    tone(220, 0.7, 'sawtooth', 0.05, 880);
    hiss(0.6, 0.08, 3000);
  },
  slam: () => {
    tone(90, 0.6, 'sine', 0.35, 40);
    hiss(0.45, 0.25, 400);
  },
  magic: () => tone(780, 0.4, 'sine', 0.1, 1560),
  slash: () => hiss(0.12, 0.2, 5000),
  hit: () => tone(180, 0.2, 'square', 0.08, 90),
  clash: () => {
    tone(1200, 0.3, 'triangle', 0.12, 600);
    hiss(0.3, 0.15, 2500);
  },
  win: () => [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.35, 'triangle', 0.12), i * 120)),
  lose: () => [392, 330, 262].forEach((f, i) => setTimeout(() => tone(f, 0.4, 'sine', 0.1), i * 160)),
};
