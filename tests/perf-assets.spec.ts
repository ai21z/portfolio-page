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
  const description = 'Aris Zounarakis is a Barcelona based software engineer at ADP working on global HCM/payroll systems across full stack product and platform tooling.';

  expect(html).toContain('<title>Aris Zounarakis | Software Engineer in Barcelona</title>');
  expect(html).toContain(`<meta name="description" content="${description}" />`);
  expect(html).toContain(`<meta property="og:description" content="${description}" />`);
  expect(html).toContain(`<meta name="twitter:description" content="${description}" />`);
  expect(manifest.name).toBe('Aris Zounarakis');
  expect(manifest.short_name).toBe('AZ');
  expect(manifest.description).toBe('Barcelona based software engineer at ADP working on global HCM/payroll systems across full stack product and platform tooling');

  const h1Matches = html.match(/<h1\b/gi) ?? [];
  expect(h1Matches).toHaveLength(1);
  expect(html).toContain('<h1 class="name glitch-text">Aris Zounarakis</h1>');
  expect(html).toContain('I&rsquo;m Aris Zounarakis, a Barcelona based software engineer at ADP. I work on global HCM and payroll systems, mostly across full stack product and platform tooling. Outside work, it is tinkering, music, side projects, and a cold one. If you like it here, cheers!');
  expect(html).not.toContain(`${formerFullName} |`);
  expect(html).not.toContain(`<h1 class="name glitch-text">${formerFullName}</h1>`);

  const jsonLdMatch = html.match(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/);
  expect(jsonLdMatch).not.toBeNull();

  const person = JSON.parse(jsonLdMatch?.[1] || '{}');
  expect(person).toMatchObject({
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: 'Aris Zounarakis',
    alternateName: [
      'Vissarion Zounarakis',
      'Vissarion Aris Zounarakis'
    ],
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
    'https://www.linkedin.com/in/vissarion-aris-zounarakis/'
  ]));
  expect(person.knowsAbout).toEqual(expect.arrayContaining([
    'Java',
    'Spring Boot',
    'Global HCM/payroll systems',
    'Developer tooling',
    'Product tooling',
    'Platform tooling'
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
    'js/work-globe/data/work-locations.js',
    'js/work-globe/data/timeline.js'
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
  expect(combined).toContain('https://github.com/ai21z/talos-assistant');
  expect(combined).toContain('https://github.com/ai21z/TrueRolls');
  expect(combined).not.toContain('Provably-fair');
  expect(combined).not.toContain('no trust required');
  expect(combined).not.toContain('Beta release coming soon');
  expect(legacyMatches).toEqual([]);
});

test('public discovery files identify the canonical portfolio URL', () => {
  const robots = readText('robots.txt');
  const sitemap = readText('sitemap.xml');

  expect(robots).toContain('User-agent: *');
  expect(robots).toContain('Allow: /');
  expect(robots).toContain('Sitemap: https://zounarakis.com/sitemap.xml');
  expect(sitemap).toContain('<loc>https://zounarakis.com/</loc>');
  expect(sitemap).toContain('<lastmod>2026-07-11</lastmod>');
  expect(sitemap).not.toContain('personal-webpage-20m.pages.dev');
});

test('social previews use absolute, fully described image metadata', () => {
  const html = readText('index.html');
  const imageUrl = 'https://zounarakis.com/og/og-1200x630.png';

  expect(html).toContain(`<meta property="og:image" content="${imageUrl}" />`);
  expect(html).toContain(`<meta property="og:image:secure_url" content="${imageUrl}" />`);
  expect(html).toContain('<meta property="og:image:width" content="1200" />');
  expect(html).toContain('<meta property="og:image:height" content="630" />');
  expect(html).toContain('<meta property="og:image:alt" content="Aris Zounarakis portfolio" />');
  expect(html).toContain(`<meta name="twitter:image" content="${imageUrl}" />`);
  expect(html).toContain('<meta name="twitter:image:alt" content="Aris Zounarakis portfolio" />');
  expect(html).not.toContain('content="./og/og-1200x630.png"');
});

test('fallback routing and static response headers are explicit', () => {
  const notFound = readText('404.html');
  const headers = readText('_headers');

  expect(notFound).toContain('<meta name="robots" content="noindex, follow" />');
  expect(notFound).toContain('<h1>Page not found</h1>');
  expect(notFound).toContain('<a href="/">Return to zounarakis.com</a>');
  expect(headers).toContain('Strict-Transport-Security: max-age=31536000');
  expect(headers).toContain('X-Frame-Options: DENY');
  expect(headers).toContain('X-Content-Type-Options: nosniff');
  expect(headers).toContain('Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()');
});

test('quick links prioritize active professional profiles', () => {
  const html = readText('index.html');
  const quickNavStart = html.indexOf('<nav class="living-sigils"');
  const quickNavEnd = html.indexOf('</nav>', quickNavStart);
  const quickNav = html.slice(quickNavStart, quickNavEnd);
  const labels = ['GitHub', 'LinkedIn', 'Email', 'Download Resume (PDF)', 'GitLab'];
  const positions = labels.map((label) => quickNav.indexOf(`aria-label="${label}"`));

  expect(quickNavStart).toBeGreaterThan(-1);
  expect(quickNavEnd).toBeGreaterThan(quickNavStart);
  expect(positions.every((position) => position >= 0)).toBe(true);
  expect(positions).toEqual([...positions].sort((a, b) => a - b));
  expect(quickNav).toContain('rel="me noopener noreferrer"');
});

test('repository documentation matches the Cloudflare Pages deployment', () => {
  const readme = readText('README.md');

  expect(readme).toContain('[zounarakis.com](https://zounarakis.com)');
  expect(readme).toContain('Cloudflare Pages Functions');
  expect(readme).toContain('npx wrangler pages deploy . --project-name personal-webpage --branch master');
  expect(readme).toContain('functions/');
  expect(readme).not.toContain('Vercel');
});

test('work content module graph shares one cache-busting version', () => {
  const references: Array<[string, RegExp]> = [
    ['index.html', /src="\.\/js\/app\.js\?v=([^"]+)"/],
    ['index.html', /src="\.\/js\/work-globe\/work-index\.js\?v=([^"]+)"/],
    ['js/app.js', /import\('\.\/work-globe-webgl\.js\?v=([^']+)'\)/],
    ['js/app.js', /import\('\.\/work-timeline\.js\?v=([^']+)'\)/],
    ['js/work-globe-webgl.js', /work-locations\.js\?v=([^']+)'/],
    ['js/work-globe-webgl.js', /projects\.js\?v=([^']+)'/],
    ['js/work-timeline.js', /timeline\.js\?v=([^']+)'/],
    ['js/work-globe/work-index.js', /work-locations\.js\?v=([^']+)'/],
    ['js/work-globe/work-index.js', /projects\.js\?v=([^']+)'/]
  ];

  const versions = references.map(([file, pattern]) => {
    const match = readText(file).match(pattern);
    expect(match, `${file} must cache-bust its Work content dependency`).not.toBeNull();
    return match?.[1];
  });

  expect(new Set(versions).size).toBe(1);
});

test('homepage downloads the final resume while preserving the legacy asset as an updated alias', () => {
  const html = readText('index.html');
  const finalPdf = 'artifacts/resume/Vissarion_Aris_Zounarakis_Software_Engineer_Resume.pdf';
  const legacyPdf = 'artifacts/resume/Aris_Zounarakis_Software_Engineer_Resume.pdf';
  const finalDocx = 'artifacts/resume/Vissarion_Aris_Zounarakis_Software_Engineer_Resume.docx';
  const legacyDocx = 'artifacts/resume/Aris_Zounarakis_Software_Engineer_Resume.docx';

  expect(html).toContain(`./${finalPdf}`);
  expect(fs.existsSync(path.join(repoRoot, finalPdf))).toBe(true);
  expect(fs.existsSync(path.join(repoRoot, finalDocx))).toBe(true);
  expect(fs.readFileSync(path.join(repoRoot, legacyPdf))).toEqual(fs.readFileSync(path.join(repoRoot, finalPdf)));
  expect(fs.readFileSync(path.join(repoRoot, legacyDocx))).toEqual(fs.readFileSync(path.join(repoRoot, finalDocx)));
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
