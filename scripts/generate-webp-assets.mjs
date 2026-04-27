import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const assets = [
  { src: 'myOminousGreenPortrait.png', dest: 'myOminousGreenPortrait.webp', quality: 0.88 },
  { src: 'artifacts/bg_base.png', dest: 'artifacts/bg_base.webp', quality: 0.86 },
  { src: 'artifacts/sigil/AZ-VZ-01.png', dest: 'artifacts/sigil/AZ-VZ-01.webp', quality: 0.9 },
  { src: 'artifacts/sigil/no-bg-seal-sigil.png', dest: 'artifacts/sigil/no-bg-seal-sigil.webp', quality: 0.9 },
  { src: 'artifacts/work-page/ominus-earth.png', dest: 'artifacts/work-page/ominus-earth.webp', quality: 0.9 },
  { src: 'artifacts/work-page/ominus-fog-cloud.png', dest: 'artifacts/work-page/ominus-fog-cloud.webp', quality: 0.86 },
  { src: 'artifacts/work-page/lightning.png', dest: 'artifacts/work-page/lightning.webp', quality: 0.9 },
];

function toDataUrl(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  const bytes = fs.readFileSync(absolutePath);
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

const browser = await chromium.launch();
const page = await browser.newPage();

try {
  for (const asset of assets) {
    const result = await page.evaluate(
      async ({ dataUrl, quality }) => {
        const image = new Image();
        image.decoding = 'async';
        const loaded = new Promise((resolve, reject) => {
          image.onload = resolve;
          image.onerror = () => reject(new Error('Image decode failed'));
        });
        image.src = dataUrl;
        await loaded;

        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;

        const context = canvas.getContext('2d', { alpha: true });
        context.drawImage(image, 0, 0);

        return {
          dataUrl: canvas.toDataURL('image/webp', quality),
          width: image.naturalWidth,
          height: image.naturalHeight,
        };
      },
      { dataUrl: toDataUrl(asset.src), quality: asset.quality }
    );

    const encoded = result.dataUrl.replace(/^data:image\/webp;base64,/, '');
    const outputPath = path.join(repoRoot, asset.dest);
    fs.writeFileSync(outputPath, Buffer.from(encoded, 'base64'));

    const before = fs.statSync(path.join(repoRoot, asset.src)).size;
    const after = fs.statSync(outputPath).size;
    console.log(`${asset.dest}: ${result.width}x${result.height}, ${before} -> ${after} bytes`);
  }
} finally {
  await browser.close();
}
