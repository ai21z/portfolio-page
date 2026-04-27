import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readText(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function sizeOf(relativePath: string): number {
  return fs.statSync(path.join(repoRoot, relativePath)).size;
}

test('navigation uses a compact mycelium graph artifact', () => {
  const litePath = 'artifacts/network-lite.json';
  expect(fs.existsSync(path.join(repoRoot, litePath))).toBe(true);
  expect(sizeOf(litePath)).toBeLessThan(1_250_000);
  expect(sizeOf(litePath)).toBeLessThan(sizeOf('artifacts/network.json') / 10);

  const app = readText('js/app.js');
  expect(app).toContain('artifacts/network-lite.json');
  expect(app).not.toContain("fetch('artifacts/network.json')");
});

test('large runtime images have WebP variants referenced by the app', () => {
  const pairs = [
    ['myOminousGreenPortrait.png', 'myOminousGreenPortrait.webp'],
    ['artifacts/bg_base.png', 'artifacts/bg_base.webp'],
    ['artifacts/sigil/AZ-VZ-01.png', 'artifacts/sigil/AZ-VZ-01.webp'],
    ['artifacts/sigil/no-bg-seal-sigil.png', 'artifacts/sigil/no-bg-seal-sigil.webp'],
    ['artifacts/work-page/ominus-earth.png', 'artifacts/work-page/ominus-earth.webp'],
    ['artifacts/work-page/ominus-fog-cloud.png', 'artifacts/work-page/ominus-fog-cloud.webp'],
    ['artifacts/work-page/lightning.png', 'artifacts/work-page/lightning.webp'],
  ];

  for (const [png, webp] of pairs) {
    expect(fs.existsSync(path.join(repoRoot, webp)), webp).toBe(true);
    expect(sizeOf(webp), webp).toBeLessThan(sizeOf(png));
  }

  const html = readText('index.html');
  const globe = readText('js/work-globe-webgl.js');
  const nav = readText('js/navigation.js');
  const nowCards = readText('js/now-cards.js');
  const particles = readText('js/portrait-particles.js');

  expect(html).toContain('bg_base.webp');
  expect(html).toContain('myOminousGreenPortrait.webp');
  expect(html).toContain('no-bg-seal-sigil.webp');
  expect(globe).toContain('ominus-earth.webp');
  expect(globe).toContain('ominus-fog-cloud.webp');
  expect(globe).toContain('lightning.webp');
  expect(nav).toContain('AZ-VZ-01.webp');
  expect(nowCards).toContain('no-bg-seal-sigil.webp');
  expect(particles).toContain('AZ-VZ-01.webp');
});

test('below-the-fold feature modules are lazy-loaded by section', () => {
  const html = readText('index.html');
  const app = readText('js/app.js');

  expect(html).not.toContain('src="./js/blog-network-webgl.js"');
  expect(html).not.toContain('src="./js/work-globe-webgl.js"');
  expect(html).not.toContain('src="./js/now-cards.js"');
  expect(app).toContain("import('./blog-network-webgl.js')");
  expect(app).toContain("import('./work-globe-webgl.js')");
  expect(app).toContain("import('./now-cards.js')");
});

test('CSS avoids broad expensive transition and fixed-background patterns', () => {
  const styleDir = path.join(repoRoot, 'styles');
  const cssFiles = fs.readdirSync(styleDir).filter((file) => file.endsWith('.css'));
  const offenders: string[] = [];

  for (const file of cssFiles) {
    const text = readText(path.join('styles', file));
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (/transition\s*:\s*all\b/.test(line) || /background-attachment\s*:\s*fixed\b/.test(line)) {
        offenders.push(`${file}:${index + 1}:${line.trim()}`);
      }
    });
  }

  expect(offenders).toEqual([]);
});
