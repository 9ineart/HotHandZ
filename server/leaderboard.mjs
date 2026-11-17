import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The shared leaderboard behind the courtyard's Leaderboard panel.
 *
 * "Worldwide" means everyone connected to this deployment: one JSON file beside
 * the room server, written on a debounce so a busy evening is not a write per
 * match. There is no account system, so a player's **name is the identity** --
 * two people picking the same name share a row. That is a known limit of
 * playing without sign-in, not an oversight; swapping the key for an account id
 * later changes only `submit`.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const FILE = process.env.HCA_LEADERBOARD_FILE || join(HERE, 'data', 'leaderboard.json');
/** How many rows the panel asks for. */
export const TOP_N = 10;
/** Rows kept on disk. Beyond this the tail is dropped on save. */
const KEEP = 500;
const SAVE_DEBOUNCE_MS = 3000;

/** @type {Map<string, {name: string, stars: number, wins: number, streak: number, at: number}>} */
const board = new Map();
let saveTimer = null;
let loaded = false;

function load() {
  if (loaded) return;
  loaded = true;
  try {
    const rows = JSON.parse(readFileSync(FILE, 'utf8'));
    if (Array.isArray(rows)) for (const r of rows) if (r && typeof r.name === 'string') board.set(key(r.name), r);
  } catch {
    /* no board yet, or it is unreadable: start empty rather than refuse to serve */
  }
}

function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      mkdirSync(dirname(FILE), { recursive: true });
      writeFileSync(FILE, JSON.stringify(ranked().slice(0, KEEP)));
    } catch {
      /* the board stays in memory; a restart loses it */
    }
  }, SAVE_DEBOUNCE_MS);
  // Never hold the process open for a pending write.
  saveTimer.unref?.();
}

const key = (name) => name.trim().toLowerCase().slice(0, 24);

/** Best first: stars, then total wins, then the longest streak. */
function ranked() {
  return [...board.values()].sort((a, b) => b.stars - a.stars || b.wins - a.wins || b.streak - a.streak);
}

const clampInt = (v, max) => Math.max(0, Math.min(max, Math.floor(Number(v) || 0)));

/**
 * Record one player's standing. Monotonic on purpose: a client reporting a
 * worse figure than the board already holds cannot pull its own row down, so a
 * cleared browser or a second device does not erase a run.
 */
export function submit(msg) {
  load();
  const name = String(msg.name || '').trim().slice(0, 24);
  if (!name) return;
  const k = key(name);
  const prev = board.get(k);
  const row = {
    name,
    stars: Math.max(prev?.stars ?? 0, clampInt(msg.stars, 100000)),
    wins: Math.max(prev?.wins ?? 0, clampInt(msg.wins, 100000)),
    streak: Math.max(prev?.streak ?? 0, clampInt(msg.streak, 10000)),
    at: Date.now(),
  };
  board.set(k, row);
  save();
}

/**
 * The top rows plus where this player stands, as a 1-based position. `you` is
 * 0 when the name has never been submitted.
 */
export function snapshot(name) {
  load();
  const rows = ranked();
  const k = key(String(name || ''));
  const at = rows.findIndex((r) => key(r.name) === k);
  return {
    type: 'leaderboard',
    top: rows.slice(0, TOP_N).map(({ name: n, stars, wins, streak }) => ({ name: n, stars, wins, streak })),
    you: at < 0 ? 0 : at + 1,
    yourRow: at < 0 ? null : { ...rows[at], at: undefined },
    total: rows.length,
  };
}
