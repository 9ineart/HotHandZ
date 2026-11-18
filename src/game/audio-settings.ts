/**
 * The player's audio mix, saved on this device.
 *
 * Two buses rather than one slider, because the two kinds of sound compete:
 * interface sounds (the count-in, the lock, the "I can see your hand" chirp)
 * carry information and want to stay audible, while combat sounds are there
 * for impact and are the first thing anyone turns down. Muting is kept
 * separate from volume so turning the sound off and back on returns the mix
 * the player had set.
 *
 * Pure data and storage, no engine or WebAudio imports, so the settings panel
 * and the synthesiser both read the same answers.
 */

const KEY = 'hca.audio.v1';

export interface AudioSettings {
  muted: boolean;
  /** 0..1, applied on top of the two bus levels. */
  master: number;
  /** 0..1: fighters, impacts, the crowd of the match. */
  effects: number;
  /** 0..1: count-in, locks, menu feedback. */
  ui: number;
  /** 0..1: the background tracks. Low by default -- it plays under everything. */
  music: number;
}

export function defaultAudio(): AudioSettings {
  return { muted: false, master: 0.8, effects: 1, ui: 1, music: 0.4 };
}

const clamp01 = (v: unknown): number => Math.max(0, Math.min(1, typeof v === 'number' && isFinite(v) ? v : 0));

export function loadAudio(): AudioSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as Partial<AudioSettings>;
      return {
        muted: Boolean(s.muted),
        master: clamp01(s.master ?? 0.8),
        effects: clamp01(s.effects ?? 1),
        ui: clamp01(s.ui ?? 1),
        music: clamp01(s.music ?? 0.4),
      };
    }
  } catch {
    /* unreadable or blocked storage: the default mix */
  }
  return defaultAudio();
}

export function saveAudio(s: AudioSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* the mix simply is not kept between sessions */
  }
}

/** The steps the panel's -/+ buttons move in, and the labels it shows. */
export const VOLUME_STEP = 0.1;
export function volumeLabel(v: number): string {
  return `${Math.round(v * 100)}%`;
}
