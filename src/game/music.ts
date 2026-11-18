/**
 * Background music: three tracks, shuffled, playing under the game.
 *
 * Streamed through a single `<audio>` element rather than decoded into
 * AudioBuffers. The three tracks are about three minutes each, and decoded
 * 44.1 kHz stereo costs roughly 30 MB of memory per minute -- a quarter of a
 * gigabyte to hold them all, on a headset that would far rather spend it on
 * the scene. An element streams from the network cache and holds almost
 * nothing.
 *
 * The element feeds the shared WebAudio graph (see sfx.ts), so the music
 * answers to the same master level and the same mute switch as everything
 * else, and the player gets its own level on top.
 *
 * One element, not one per track: a MediaElementAudioSourceNode can only ever
 * be created once for a given element, so the element is built once and its
 * `src` is swapped between tracks.
 */
import { audioBus, audioContext } from './sfx.js';

/**
 * The tracks, as served. Order here is only the order they are declared --
 * playback order is shuffled.
 */
const TRACKS = [
  '/audio/music/stranded.ogg',
  '/audio/music/rally.ogg',
  '/audio/music/whats-going-on.ogg',
] as const;

/** Seconds to fade a track up when it starts, and down when it is stopped. */
const FADE = 2;

let el: HTMLAudioElement | null = null;
let gain: GainNode | null = null;
let wired = false;

/** The remaining tracks of the current shuffle, as indices into TRACKS. */
let bag: number[] = [];
let current = -1;
let wanted = false;

/**
 * Next track in a shuffled bag.
 *
 * A bag rather than a random pick each time: random repeats, and with only
 * three tracks a repeat is both likely and very noticeable. Every track is
 * played once before any is played again. The one seam a bag leaves is the
 * join between bags, where the last of one can meet the first of the next, so
 * a refilled bag never starts with the track that just played.
 */
function nextTrack(): number {
  if (bag.length === 0) {
    bag = TRACKS.map((_, i) => i);
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    if (bag.length > 1 && bag[0] === current) bag.push(bag.shift()!);
  }
  return bag.shift()!;
}

/**
 * Build the element and splice it into the music bus. Returns false where
 * WebAudio is unavailable, which leaves the game silent rather than broken.
 */
function ensure(): boolean {
  if (wired) return el != null;
  wired = true;
  const ctx = audioContext();
  const bus = audioBus('music');
  if (!ctx || !bus) return false;
  try {
    el = new Audio();
    el.preload = 'none';
    // Looping is handled here, not by the element: `loop` would repeat one
    // track for ever instead of moving on to the next.
    el.loop = false;
    el.addEventListener('ended', () => {
      if (wanted) play(nextTrack());
    });
    // A track that fails to load must not end the music. Skip to the next one.
    el.addEventListener('error', () => {
      if (wanted) play(nextTrack());
    });
    gain = ctx.createGain();
    gain.gain.value = 0;
    ctx.createMediaElementSource(el).connect(gain).connect(bus);
    return true;
  } catch {
    el = null;
    gain = null;
    return false;
  }
}

function play(index: number): void {
  const ctx = audioContext();
  if (!el || !gain || !ctx) return;
  current = index;
  el.src = TRACKS[index];
  const t = ctx.currentTime;
  gain.gain.cancelScheduledValues(t);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.linearRampToValueAtTime(1, t + FADE);
  // Rejected play() is normal -- no user gesture yet, or the element was
  // re-sourced mid-load. `start` is called again at the next opportunity.
  void el.play().catch(() => {});
}

export const music = {
  /** Begin, or resume after a pause. Safe to call repeatedly. */
  start(): void {
    wanted = true;
    if (!ensure() || !el) return;
    const ctx = audioContext();
    if (ctx?.state === 'suspended') void ctx.resume();
    if (el.paused && el.src) void el.play().catch(() => {});
    else if (!el.src) play(nextTrack());
  },

  /**
   * Fade out and hold. The track is kept, so `start` resumes where it left
   * off -- used when the headset is taken off or the tab loses focus, where
   * restarting the track would be more jarring than the silence was.
   */
  pause(): void {
    wanted = false;
    const ctx = audioContext();
    if (!el || !gain || !ctx) return;
    const t = ctx.currentTime;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(gain.gain.value, t);
    gain.gain.linearRampToValueAtTime(0.0001, t + 0.4);
    const held = el;
    window.setTimeout(() => {
      if (!wanted) held.pause();
    }, 450);
  },

  /** Stop and forget the position: the next `start` picks a fresh track. */
  stop(): void {
    this.pause();
    window.setTimeout(() => {
      if (!wanted && el) el.removeAttribute('src');
    }, 500);
  },

  /** Skip to the next track in the bag. */
  skip(): void {
    if (wanted && ensure()) play(nextTrack());
  },
};
