import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// The particles read the portrait through this map (scripts/generate-portrait-sampling-map.mjs). It must
// hold the portrait's own sampled pixels, so a new portrait needs a new map, or the dust that travels to a
// hovered node comes from the old photo.
test('the portrait sampling map holds the current portrait, band for band, dust included', async () => {
  const photo = await sharp(path.join(root, 'myOminousGreenPortrait.webp')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const map = await sharp(path.join(root, 'artifacts/portrait-sampling-map.png')).greyscale().raw().toBuffer({ resolveWithObject: true });
  assert.equal(map.info.width, photo.info.width / 2);
  assert.equal(map.info.height, photo.info.height / 2);
  const counts = new Array(6).fill(0);
  let mismatches = 0;
  for (let y = 0; y < map.info.height; y++) {
    for (let x = 0; x < map.info.width; x++) {
      const i = (y * 2 * photo.info.width + x * 2) * 4;
      const v = 0.299 * photo.data[i] + 0.587 * photo.data[i + 1] + 0.114 * photo.data[i + 2];
      const band = photo.data[i + 3] < 180 || v < 8 ? -1 : Math.min(5, Math.floor((v / 255) * 6));
      const value = map.data[y * map.info.width + x];
      const mapped = value === 0 ? -1 : Math.min(5, Math.floor((value / 255) * 6));
      if (band !== mapped) mismatches++;
      if (mapped >= 0) counts[mapped]++;
    }
  }
  assert.equal(mismatches, 0);
  assert.equal(counts[4] + counts[5], 265, 'the dust');
});
