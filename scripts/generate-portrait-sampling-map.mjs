// The portrait particles' sampling map. The particles read the 1024 px portrait at every second pixel
// and keep only each pixel's brightness band (js/portrait-particles.js), so this map holds exactly those
// pixels, 512x512, each as the middle of its band, and black where the photo is transparent or too dark.
// It replaces a 419 KB fetch after load and gives the same specks, the dust that travels to a hovered node
// included. Run it whenever the portrait changes: node scripts/generate-portrait-sampling-map.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Keep these in step with js/portrait-particles.js.
const SOURCE = 'myOminousGreenPortrait.webp';
const SPACING = 2;
const BANDS = 6;
const ALPHA_THRESHOLD = 180;
const BRIGHTNESS_THRESHOLD = 8;

const { data, info } = await sharp(path.join(repoRoot, SOURCE)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const width = Math.ceil(info.width / SPACING);
const height = Math.ceil(info.height / SPACING);
const map = Buffer.alloc(width * height);
const counts = new Array(BANDS).fill(0);
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const i = ((y * SPACING) * info.width + x * SPACING) * 4;
    if (data[i + 3] < ALPHA_THRESHOLD) continue;
    const brightness = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    if (brightness < BRIGHTNESS_THRESHOLD) continue;
    const band = Math.min(BANDS - 1, Math.floor((brightness / 255) * BANDS));
    counts[band]++;
    // The middle of the band, so the particles' own banding lands on the same band.
    map[y * width + x] = Math.round(((band + 0.5) * 255) / BANDS);
  }
}

const dest = path.join(repoRoot, 'artifacts/portrait-sampling-map.png');
const meta = await sharp(map, { raw: { width, height, channels: 1 } })
  .png({ palette: true, colours: BANDS + 1, compressionLevel: 9, effort: 10 })
  .toFile(dest);
console.log(`artifacts/portrait-sampling-map.png: ${width}x${height}, ${meta.size} bytes, points per band ${counts.join(' ')}`);
