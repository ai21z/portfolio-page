#!/usr/bin/env node
// Icon generator: creates all sizes from sigil source

import sharp from 'sharp';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';

const SOURCE = './artifacts/sigil/AZ-01.png';
const OUTPUT_DIR = './icons';

const ICONS = [
  { name: 'favicon-16.png', size: 16 },
  { name: 'favicon-32.png', size: 32 },
  { name: 'favicon-48.png', size: 48 },
  { name: 'apple-touch-180.png', size: 180 },
  { name: 'android-192.png', size: 192 },
  { name: 'android-512.png', size: 512 },
  { name: 'maskable-512.png', size: 512, maskable: true }
];

await mkdir(OUTPUT_DIR, { recursive: true });

console.log('🎨 Generating icons from sigil...\n');

for (const icon of ICONS) {
  try {
    let pipeline = sharp(SOURCE).resize(icon.size, icon.size, {
      fit: 'contain',
      background: { r: 11, g: 11, b: 12, alpha: 0 }
    });

    if (icon.maskable) {
      const padding = Math.floor(icon.size * 0.1);
      pipeline = sharp(SOURCE)
        .resize(icon.size - padding * 2, icon.size - padding * 2, {
          fit: 'contain',
          background: { r: 11, g: 11, b: 12, alpha: 1 }
        })
        .extend({
          top: padding,
          bottom: padding,
          left: padding,
          right: padding,
          background: { r: 11, g: 11, b: 12, alpha: 1 }
        });
    }

    await pipeline.png().toFile(join(OUTPUT_DIR, icon.name));
    console.log(`✓ ${icon.name} (${icon.size}×${icon.size}${icon.maskable ? ', maskable safe zone' : ''})`);
  } catch (err) {
    console.error(`✗ Failed to generate ${icon.name}:`, err.message);
  }
}

console.log('\n🎨 Generating pinned-tab.svg...');
try {
  const svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
  <rect width="16" height="16" fill="#000"/>
  <text x="8" y="12" font-family="monospace" font-size="10" font-weight="bold" text-anchor="middle" fill="#fff">AZ</text>
</svg>`;
  
  await writeFile(join(OUTPUT_DIR, 'pinned-tab.svg'), svgContent);
  console.log('✓ pinned-tab.svg (monochrome)');
} catch (err) {
  console.error('✗ Failed to generate pinned-tab.svg:', err.message);
}

// /favicon.ico for clients that ask for it without reading the page's icon links. An ICO file can
// hold PNG images directly, so it wraps the 16, 32 and 48 px favicons generated above.
function pngIco(pngs) {
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ size, data }, i) => {
    const entry = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, entry);
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...pngs.map(png => png.data)]);
}

console.log('\n🎨 Generating favicon.ico...');
try {
  const pngs = await Promise.all([16, 32, 48].map(async size => ({ size, data: await readFile(join(OUTPUT_DIR, `favicon-${size}.png`)) })));
  await writeFile('favicon.ico', pngIco(pngs));
  console.log('✓ favicon.ico (16, 32, 48)');
} catch (err) {
  console.error('✗ Failed to generate favicon.ico:', err.message);
}

console.log('\n✅ Icon generation complete!\n');
