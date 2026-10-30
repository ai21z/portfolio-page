// Builds the Work globe's land mask as a signed distance field from its own earth map, so the coast
// lines up with the map's UVs exactly. The map's land is a grainy texture, so its luminance is blurred
// to drop the grain, sampled at twice the map's size, cut where the shader used to cut it, and cleared of
// specks. The exact distance to the coast is then measured on both sides (the map wraps east to west)
// and stored at the map's size, 128 at the coast, land above, sea below, RANGE texels to either end,
// as a lossless WebP with a PNG for browsers without it, one grey channel each.
// A distance field filters smoothly, so the coast stays clean at any size the globe is drawn at.
// Usage: node scripts/build-globe-land-sdf.mjs
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { statSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'artifacts/work-page/ominus-earth.png');
const OUT = join(ROOT, 'artifacts/work-page/ominus-earth-land');
const UP = 2;                 // the mask is cut at twice the map's size
const CUT = 0.105;            // midway through the shader's old land band (0.08 to 0.13)
const BLUR_SIGMA = 1.1;       // map px, enough to drop the land's grain
const MIN_ISLAND = 24;        // px at twice the size, smaller land is grain
const MIN_LAKE = 24;          // px at twice the size, smaller water is grain
export const RANGE = 16;      // map texels from the coast to either end of the stored values

const { data, info } = await sharp(SOURCE).removeAlpha().blur(BLUR_SIGMA).raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height, C = info.channels;
const luma = new Float32Array(W * H);
for (let i = 0; i < W * H; i++) luma[i] = (0.299 * data[i * C] + 0.587 * data[i * C + 1] + 0.114 * data[i * C + 2]) / 255;

// Bilinear upsample, wrapping in x, then the cut.
const w = W * UP, h = H * UP;
const land = new Uint8Array(w * h);
for (let y = 0; y < h; y++) {
  const fy = Math.min(H - 1, Math.max(0, (y + 0.5) / UP - 0.5));
  const y0 = Math.floor(fy), y1 = Math.min(H - 1, y0 + 1), ty = fy - y0;
  for (let x = 0; x < w; x++) {
    const fx = (x + 0.5) / UP - 0.5;
    const x0 = ((Math.floor(fx) % W) + W) % W, x1 = (x0 + 1) % W, tx = fx - Math.floor(fx);
    const a = luma[y0 * W + x0] * (1 - tx) + luma[y0 * W + x1] * tx;
    const b = luma[y1 * W + x0] * (1 - tx) + luma[y1 * W + x1] * tx;
    land[y * w + x] = a * (1 - ty) + b * ty >= CUT ? 1 : 0;
  }
}

// Specks: land or water regions too small to be real are flipped to their surroundings.
function clearSpecks(value, minSize) {
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || land[start] !== value) continue;
    let top = 0, size = 0;
    const region = [];
    stack[top++] = start;
    seen[start] = 1;
    while (top) {
      const p = stack[--top];
      region.push(p);
      size++;
      const x = p % w, y = (p - x) / w;
      for (const q of [y * w + (x + 1) % w, y * w + (x - 1 + w) % w, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
        if (q >= 0 && !seen[q] && land[q] === value) { seen[q] = 1; stack[top++] = q; }
      }
    }
    if (size < minSize) for (const p of region) land[p] = 1 - value;
  }
}
clearSpecks(1, MIN_ISLAND);
clearSpecks(0, MIN_LAKE);

// Exact Euclidean distance transform (Felzenszwalb and Huttenlocher), x wrapping by padding.
const INF = 1e20;
function edt1d(f, n, d, v, z) {
  let k = 0;
  v[0] = 0; z[0] = -INF; z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s;
    do { s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); } while (s <= z[k] && --k >= 0);
    k++; v[k] = q; z[k] = s; z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) ** 2 + f[v[k]]; }
}
function distanceTo(target) {
  const pad = RANGE * UP * 2, pw = w + pad * 2;
  const grid = new Float64Array(pw * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < pw; x++) grid[y * pw + x] = land[y * w + (((x - pad) % w) + w) % w] === target ? 0 : INF;
  const n = Math.max(pw, h), f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let x = 0; x < pw; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * pw + x];
    edt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) grid[y * pw + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < pw; x++) f[x] = grid[y * pw + x];
    edt1d(f, pw, d, v, z);
    for (let x = 0; x < pw; x++) grid[y * pw + x] = d[x];
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = Math.sqrt(grid[y * pw + x + pad]);
  return out;
}
const toLand = distanceTo(1), toSea = distanceTo(0);

// Signed distance in map texels, positive on land, averaged down to the map's size and stored.
const pixels = Buffer.alloc(W * H);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    let sum = 0;
    for (let j = 0; j < UP; j++) for (let i = 0; i < UP; i++) {
      const p = (y * UP + j) * w + x * UP + i;
      sum += land[p] ? toSea[p] - 0.5 : 0.5 - toLand[p];
    }
    const texels = sum / (UP * UP) / UP;
    pixels[y * W + x] = Math.max(0, Math.min(255, Math.round(128 + texels * 127 / RANGE)));
  }
}
const grey = () => sharp(pixels, { raw: { width: W, height: H, channels: 1 } }).toColourspace('b-w');
await grey().png({ compressionLevel: 9 }).toFile(`${OUT}.png`);
await grey().webp({ lossless: true, effort: 6 }).toFile(`${OUT}.webp`);
const kb = (ext) => (statSync(`${OUT}.${ext}`).size / 1024).toFixed(0);
console.log(`${OUT}: ${W}x${H}, webp ${kb('webp')} KB, png ${kb('png')} KB, land ${(land.reduce((s, v) => s + v, 0) / land.length * 100).toFixed(1)}%`);
