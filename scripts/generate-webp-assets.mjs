import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const assets = [
  { src: 'myOminousGreenPortrait.png', dest: 'myOminousGreenPortrait.webp', quality: 88 },
  { src: 'myOminousGreenPortrait.png', dest: 'myOminousGreenPortrait-480.webp', width: 480, quality: 82 },
  { src: 'myOminousGreenPortrait.png', dest: 'myOminousGreenPortrait-600.webp', width: 600, quality: 82 },
  { src: 'myOminousGreenPortrait.png', dest: 'myOminousGreenPortrait-800.webp', width: 800, quality: 82 },
  { src: 'artifacts/bg_base.png', dest: 'artifacts/bg_base.webp', quality: 86 },
  { src: 'artifacts/blog-articles/1st-year-SE-article-image.png', dest: 'artifacts/blog-articles/1st-year-SE-article-image-800.webp', width: 800, quality: 86 },
  { src: 'artifacts/blog-articles/1st-year-SE-article-image.png', dest: 'artifacts/blog-articles/1st-year-SE-article-image.webp', quality: 86 },
  { src: 'artifacts/sigil/AZ-01.png', dest: 'artifacts/sigil/AZ-01.webp', quality: 90 },
  { src: 'artifacts/sigil/no-bg-seal-sigil.png', dest: 'artifacts/sigil/no-bg-seal-sigil.webp', quality: 90 },
  { src: 'artifacts/sigil/no-bg-seal-sigil.png', dest: 'artifacts/sigil/no-bg-seal-sigil-512.webp', width: 512, quality: 86 },
  { src: 'artifacts/work-page/ominus-earth.png', dest: 'artifacts/work-page/ominus-earth.webp', quality: 90 },
  { src: 'artifacts/work-page/ominus-fog-cloud.png', dest: 'artifacts/work-page/ominus-fog-cloud.webp', quality: 86 },
  { src: 'artifacts/work-page/lightning.png', dest: 'artifacts/work-page/lightning.webp', quality: 90 },
];

const selected = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
for (const file of selected) {
  if (!assets.some(asset => asset.dest === file)) throw new Error(`Unknown output: ${file}`);
}

// Avoid browser canvas encoding, which can bake in the monitor's color profile.
for (const asset of assets) {
  if (selected.length && !selected.includes(asset.dest)) continue;
  if (process.argv.includes('--responsive-only') && !asset.width) continue;
  const srcPath = path.join(repoRoot, asset.src);
  const destPath = path.join(repoRoot, asset.dest);

  const meta = await sharp(srcPath)
    .resize({ width: asset.width, withoutEnlargement: true })
    .webp({ quality: asset.quality })
    .toFile(destPath);

  const before = fs.statSync(srcPath).size;
  const after = fs.statSync(destPath).size;
  console.log(`${asset.dest}: ${meta.width}x${meta.height}, ${before} -> ${after} bytes`);
}
