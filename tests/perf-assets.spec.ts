import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const formerFullName = ['V', 'issarion ', 'Zounarakis'].join('');

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
    ['artifacts/sigil/AZ-01.png', 'artifacts/sigil/AZ-01.webp'],
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
  const particles = readText('js/portrait-particles.js');

  expect(html).toContain('bg_base.webp');
  expect(html).toContain('myOminousGreenPortrait.webp');
  expect(html).toContain('no-bg-seal-sigil.webp');
  expect(globe).toContain('ominus-earth.webp');
  expect(globe).toContain('ominus-fog-cloud.webp');
  expect(globe).toContain('lightning.webp');
  expect(nav).toContain('AZ-01.webp');
  expect(particles).toContain('AZ-01.webp');
});

test('below-the-fold feature modules are lazy-loaded by section', () => {
  const html = readText('index.html');
  const app = readText('js/app.js');

  expect(html).not.toContain('src="./js/blog-network-webgl.js"');
  expect(html).not.toContain('src="./js/work-globe-webgl.js"');
  // version-tolerant: matches both bare and ?v= cache-busted dynamic imports
  expect(app).toContain("import('./blog-network-webgl.js");
  expect(app).toContain("import('./work-globe-webgl.js");
});

test('homepage exposes a clear professional search entity', () => {
  const html = readText('index.html');
  const manifest = JSON.parse(readText('manifest.json'));
  const description = 'Aris Zounarakis is a Barcelona-based software engineer at ADP working full-stack on global HCM/payroll systems, AI code evaluation, and local-first developer tools.';

  expect(html).toContain('<title>Aris Zounarakis | Software Engineer in Barcelona</title>');
  expect(html).toContain(`<meta name="description" content="${description}" />`);
  expect(html).toContain(`<meta property="og:description" content="${description}" />`);
  expect(html).toContain(`<meta name="twitter:description" content="${description}" />`);
  expect(manifest.name).toBe('Aris Zounarakis');
  expect(manifest.short_name).toBe('AZ');
  expect(manifest.description).toBe('Barcelona-based software engineer at ADP working full-stack on global HCM/payroll systems, AI code evaluation, and local-first developer tools');

  const h1Matches = html.match(/<h1\b/gi) ?? [];
  expect(h1Matches).toHaveLength(1);
  expect(html).toContain('<h1 class="name glitch-text">Aris Zounarakis</h1>');
  expect(html).toContain('I&rsquo;m Aris Zounarakis, a Barcelona-based software engineer at ADP.');
  expect(html).not.toContain(`${formerFullName} |`);
  expect(html).not.toContain(`<h1 class="name glitch-text">${formerFullName}</h1>`);

  const jsonLdMatch = html.match(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/);
  expect(jsonLdMatch).not.toBeNull();

  const person = JSON.parse(jsonLdMatch?.[1] || '{}');
  expect(person).toMatchObject({
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: 'Aris Zounarakis',
    jobTitle: 'Software Engineer',
    email: 'mailto:aris@zounarakis.com',
    nationality: {
      '@type': 'Country',
      name: 'Greece'
    },
    address: {
      '@type': 'PostalAddress',
      addressLocality: 'Barcelona',
      addressCountry: 'ES'
    }
  });
  expect(person.sameAs).toEqual(expect.arrayContaining([
    'https://github.com/ai21z',
    'https://gitlab.com/ariszoun',
    'https://linkedin.com/in/aris-zounarakis'
  ]));
  expect(person.knowsAbout).toEqual(expect.arrayContaining([
    'Java',
    'Spring Boot',
    'Local-first LLM tools',
    'AI code evaluation',
    'Global HCM/payroll systems',
    'Developer tooling'
  ]));
});

test('generated identity assets use the Aris public name', () => {
  const ogGenerator = readText('generate-og.js');
  const iconGenerator = readText('generate-icons.js');
  const readme = readText('README.md');

  expect(ogGenerator).toContain('Aris Zounarakis');
  expect(ogGenerator).not.toContain(formerFullName);
  expect(iconGenerator).toContain('>AZ<');
  expect(iconGenerator).not.toContain('>VZ<');
  expect(readme).toContain('Aris Zounarakis');
  expect(readme).not.toContain(formerFullName);
});

test('portfolio content presents Talos instead of legacy project or retrieval acronym copy', () => {
  const contentFiles = [
    'index.html',
    'js/work-globe/data/projects.js',
    'js/work-globe/data/work-locations.js'
  ];
  const combined = contentFiles.map((file) => readText(file)).join('\n');
  const legacyTerms = ['LOQ' + '-J', 'LOQ' + 'J', 'lo' + 'qj', 'R' + 'AG'];
  const legacyPattern = new RegExp(`\\b(?:${legacyTerms.join('|')})\\b`, 'g');
  const legacyMatches = contentFiles.flatMap((file) => {
    return Array.from(readText(file).matchAll(legacyPattern))
      .map((match) => `${file}:${match[0]}`);
  });

  expect(combined).toContain('Talos');
  expect(combined).toContain('Workspace Operators');
  expect(combined).toContain('Approval Gates');
  expect(combined).toContain('https://github.com/ai21z/talos-cli');
  expect(legacyMatches).toEqual([]);
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
