import type { Plugin } from 'vite';
export const WS_PATH: string;
export const RULES: Record<string, unknown>;
export function resolveRound(a: string | null, b: string | null): {
  picks: (string | null)[];
  winner: number;
  damage: number[];
  reason: string;
};
export function attachRooms(server: unknown, path?: string): unknown;
export function handClashRooms(): Plugin;
