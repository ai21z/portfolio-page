#!/usr/bin/env node
// Icon generator: creates all sizes from sigil source

import sharp from 'sharp';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';

const SOURCE = './artifacts/sigil/AZ-VZ-01.png';
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
  <text x="8" y="12" font-family="monospace" font-size="10" font-weight="bold" text-anchor="middle" fill="#fff">VZ</text>
</svg>`;
  
  await writeFile(join(OUTPUT_DIR, 'pinned-tab.svg'), svgContent);
  console.log('✓ pinned-tab.svg (monochrome)');
} catch (err) {
  console.error('✗ Failed to generate pinned-tab.svg:', err.message);
}

console.log('\n✅ Icon generation complete!\n');
