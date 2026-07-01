import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// quality is 0-100 (sharp), mirroring the old 0-1 toDataURL values.
const assets = [
  { src: 'myOminousGreenPortrait.png', dest: 'myOminousGreenPortrait.webp', quality: 88 },
  { src: 'artifacts/bg_base.png', dest: 'artifacts/bg_base.webp', quality: 86 },
  { src: 'artifacts/sigil/AZ-01.png', dest: 'artifacts/sigil/AZ-01.webp', quality: 90 },
  { src: 'artifacts/sigil/no-bg-seal-sigil.png', dest: 'artifacts/sigil/no-bg-seal-sigil.webp', quality: 90 },
  { src: 'artifacts/work-page/ominus-earth.png', dest: 'artifacts/work-page/ominus-earth.webp', quality: 90 },
  { src: 'artifacts/work-page/ominus-fog-cloud.png', dest: 'artifacts/work-page/ominus-fog-cloud.webp', quality: 86 },
  { src: 'artifacts/work-page/lightning.png', dest: 'artifacts/work-page/lightning.webp', quality: 90 },
];

// Encode each PNG straight to WebP with sharp.
//
// The previous implementation loaded each PNG into a headless-Chromium <canvas> and called
// canvas.toDataURL('image/webp'). That path round-tripped the pixels through the build
// machine's canvas colour pipeline and BAKED IN that machine's monitor ICC profile, yielding
// WebPs that were ~2x darker than the source PNG and tagged with a display-specific profile.
// On colour-managed screens (macOS Retina / Display-P3, and worse in Safari) those WebPs
// rendered dark — the portrait + its sampled particles looked dim. sharp is deterministic,
// preserves the source pixels exactly, and embeds no profile (we never call withMetadata),
// so the WebP now matches the PNG on every display.
for (const asset of assets) {
  const srcPath = path.join(repoRoot, asset.src);
  const destPath = path.join(repoRoot, asset.dest);

  const meta = await sharp(srcPath).metadata();
  await sharp(srcPath)
    .webp({ quality: asset.quality }) // no .withMetadata() => no embedded ICC profile
    .toFile(destPath);

  const before = fs.statSync(srcPath).size;
  const after = fs.statSync(destPath).size;
  console.log(`${asset.dest}: ${meta.width}x${meta.height}, ${before} -> ${after} bytes`);
}
