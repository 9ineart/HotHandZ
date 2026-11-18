/**
 * Composite a Quest capture over a photo of the real room.
 *
 * The headset's recorder writes only the layers the app renders; passthrough
 * comes from the cameras and is excluded, so everywhere the player actually
 * saw their room the capture is black. This puts the room back, which is what
 * Meta's own mixed-reality capture tool does -- the result shows what was
 * really in front of the player, not something invented.
 *
 *   node scripts/mr-composite.mjs <capture> <roomPhoto> <output> [threshold]
 *
 * The interesting part is deciding which black is passthrough. A plain
 * "replace every dark pixel" key also eats the game's own dark pixels -- the
 * navy HUD header, the black marker cones on the arena -- punching holes
 * through the middle of the artwork.
 *
 * So instead of keying by colour alone, this floods inward from the edges of
 * the frame and only clears black that is *connected to the border*. The
 * passthrough void always touches the edge; a cone standing in the middle of
 * the arena never does. Dark game pixels survive because they are enclosed by
 * lit ones.
 */
import sharp from 'sharp';

const [, , capturePath, roomPath, outPath, thresholdArg] = process.argv;
if (!capturePath || !roomPath || !outPath) {
  console.error('usage: node scripts/mr-composite.mjs <capture> <roomPhoto> <output> [threshold]');
  process.exit(1);
}
// Luminance at or below this counts as "could be passthrough". Low on purpose:
// the navy panel header sits around 40 and must not be touched.
const THRESHOLD = Number(thresholdArg ?? 18);

const cap = sharp(capturePath).ensureAlpha();
const { width, height } = await cap.metadata();
const px = await cap.raw().toBuffer();

// The room photo is covered to the capture's frame: cropped to fill rather
// than squashed, so the furniture keeps its proportions.
const room = await sharp(roomPath)
  // Phones record orientation in EXIF rather than rotating the pixels, so
  // without this a photo taken in portrait arrives on its side.
  .rotate()
  .resize(width, height, { fit: 'cover', position: 'centre' })
  .removeAlpha()
  .raw()
  .toBuffer();

const dark = (i) => {
  // Rec. 601 luma, which tracks perceived brightness better than a mean.
  const l = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
  return l <= THRESHOLD;
};

// Flood from every border pixel. Iterative stack, not recursion: a 1920x1080
// void is two million pixels and would blow the call stack.
const seen = new Uint8Array(width * height);
const stack = [];
for (let x = 0; x < width; x++) {
  stack.push(x, x + (height - 1) * width);
}
for (let y = 0; y < height; y++) {
  stack.push(y * width, width - 1 + y * width);
}

let cleared = 0;
while (stack.length) {
  const p = stack.pop();
  if (seen[p]) continue;
  const i = p * 4;
  if (!dark(i)) continue;
  seen[p] = 1;
  cleared++;
  const x = p % width;
  const y = (p - x) / width;
  if (x > 0) stack.push(p - 1);
  if (x < width - 1) stack.push(p + 1);
  if (y > 0) stack.push(p - width);
  if (y < height - 1) stack.push(p + width);
}

// Replace the flooded region with the room, leaving everything else untouched.
const out = Buffer.alloc(width * height * 3);
for (let p = 0; p < width * height; p++) {
  const s = p * 4;
  const d = p * 3;
  if (seen[p]) {
    out[d] = room[d];
    out[d + 1] = room[d + 1];
    out[d + 2] = room[d + 2];
  } else {
    out[d] = px[s];
    out[d + 1] = px[s + 1];
    out[d + 2] = px[s + 2];
  }
}

await sharp(out, { raw: { width, height, channels: 3 } })
  .png()
  .toFile(outPath);

const pct = ((cleared / (width * height)) * 100).toFixed(1);
console.log(`${outPath}  ${width}x${height}  replaced ${pct}% of the frame (threshold ${THRESHOLD})`);
if (cleared === 0) console.log('WARNING: nothing was replaced -- raise the threshold.');
if (pct > 92) console.log('WARNING: almost everything was replaced -- lower the threshold.');
