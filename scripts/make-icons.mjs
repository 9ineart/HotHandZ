/**
 * Generate the PWA icon set into public/icons/.
 *
 *   node scripts/make-icons.mjs
 *
 * The mark is the game's own flame, drawn as nested teardrops in the fire
 * palette from src/game/flame.ts, on the navy the panels use. Flat shapes and
 * three colours on purpose: a launcher icon is read at a glance across a
 * headset library, where gradients and fine detail turn to mush.
 *
 * Placeholder artwork, deliberately. Swapping in a real logo means replacing
 * the two SVGs below and re-running; nothing downstream knows the difference.
 */
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(process.cwd(), 'public', 'icons');
mkdirSync(OUT, { recursive: true });

const NAVY = '#202b3b';
const COOL = '#cf1c06';
const MID = '#ff8a12';
const HOT = '#fff2b8';

/** `scale` shrinks the flame for the maskable variant's safe zone. */
const flame = (scale) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" fill="${NAVY}"/>
  <g transform="translate(256,268) scale(${scale})">
    <path d="M0,-150 C70,-70 108,-26 108,30 C108,98 60,142 0,142 C-60,142 -108,98 -108,30 C-108,-26 -70,-70 0,-150 Z" fill="${COOL}"/>
    <path d="M0,-92 C44,-36 68,-6 68,36 C68,84 38,114 0,114 C-38,114 -68,84 -68,36 C-68,-6 -44,-36 0,-92 Z" fill="${MID}"/>
    <path d="M0,-36 C20,0 32,20 32,44 C32,70 18,86 0,86 C-18,86 -32,70 -32,44 C-32,20 -20,0 0,-36 Z" fill="${HOT}"/>
  </g>
</svg>`;

// A maskable icon is cropped to whatever shape the launcher likes, so the mark
// has to sit inside the inner ~80% and the background has to reach every edge.
const targets = [
  { file: 'icon-192.png', size: 192, svg: flame(1) },
  { file: 'icon-512.png', size: 512, svg: flame(1) },
  { file: 'icon-512-maskable.png', size: 512, svg: flame(0.72) },
  { file: 'favicon-32.png', size: 32, svg: flame(1.1) },
];

for (const { file, size, svg } of targets) {
  await sharp(Buffer.from(svg))
    .resize(size, size)
    // Flattened onto the navy: a maskable icon must be fully opaque, and an
    // alpha channel on the others buys nothing here.
    .flatten({ background: NAVY })
    .png()
    .toFile(join(OUT, file));
  console.log(`  ${file}  ${size}x${size}`);
}
console.log('icons written to public/icons/');
