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
    ['artifacts/blog-articles/1st-year-SE-article-image.png', 'artifacts/blog-articles/1st-year-SE-article-image.webp'],
    ['artifacts/sigil/AZ-01.png', 'artifacts/sigil/AZ-01.webp'],
    ['artifacts/sigil/AZ-01-192.png', 'artifacts/sigil/AZ-01-192.webp'],
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
  expect(html).toContain('no-bg-seal-sigil-512.webp');
  expect(globe).toContain('ominus-earth.webp');
  expect(globe).toContain('ominus-fog-cloud.webp');
  expect(globe).toContain('lightning.webp');
  // The 64 px hub and the particles' constellation mask both take the 192 px sigil. The 1024 px
  // one is only a source for the icon generators and is not shipped.
  for (const source of [nav, particles]) {
    expect(source).toContain('AZ-01-192.webp');
    expect(source).not.toContain('AZ-01.webp');
  }
  const shipped = JSON.parse(readText('scripts/public-files.json'));
  expect(shipped).not.toContain('artifacts/sigil/AZ-01.webp');
  expect(shipped).not.toContain('artifacts/sigil/AZ-01.png');
});

test('below-the-fold feature modules are lazy-loaded by section', () => {
  const html = readText('index.html');
  const app = readText('js/app.js');

  expect(html).not.toContain('src="./js/blog-network-webgl.js"');
  expect(html).not.toContain('src="./js/work-globe-webgl.js"');
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

  // The landing's h1 is the name, and it comes first. Each other view names itself with its own h1,
  // and only the view on screen is exposed (the others are inert).
  const h1s = [...html.matchAll(/<h1\b[^>]*>([^<]*)<\/h1>/gi)].map((match) => match[1]);
  expect(h1s).toEqual(['Aris Zounarakis', 'About', 'Skills', 'Blog', 'Work', 'Get in Touch']);
  expect(html).toContain('<h1 class="name glitch-text">Aris Zounarakis</h1>');
  expect(html).toContain('I&rsquo;m Aris Zounarakis, a Barcelona based software engineer at ADP. I build country-compliant payroll features on a global HCM platform, and local-first developer tools you can verify. Outside work, it is music and side projects. If you like it here, write to me.');
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

test('responsive images stay smaller than their full-size sources', () => {
  expect(sizeOf('myOminousGreenPortrait-480.webp')).toBeLessThan(90_000);
  expect(sizeOf('myOminousGreenPortrait-600.webp')).toBeLessThan(140_000);
  expect(sizeOf('myOminousGreenPortrait-800.webp')).toBeLessThan(sizeOf('myOminousGreenPortrait.webp') * 0.6);
  expect(sizeOf('artifacts/sigil/no-bg-seal-sigil-512.webp')).toBeLessThan(80_000);
  expect(sizeOf('artifacts/bg_base-portrait.webp')).toBeLessThan(sizeOf('artifacts/bg_base.webp') * 0.5);
  expect(sizeOf('artifacts/blog-articles/1st-year-SE-article-image-800.webp')).toBeLessThan(90_000);
  expect(sizeOf('artifacts/blog-articles/1st-year-SE-article-image.webp')).toBeLessThan(170_000);
});

// The categories were described three different ways (dish tooltip, Field Notes, phone cards).
test('the Blog category lines in the page match the one registry', async () => {
  const { BLOG_CATEGORIES, blogCategoryShortLine } = await import('../js/blog-categories.js');
  const html = readText('index.html');
  const decode = (text: string) => text.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  for (const category of BLOG_CATEGORIES) {
    const memo = new RegExp(`data-hub="${category.id}" href="#blog/${category.id}">[\\s\\S]*?<span class="blog-memo-desc">([^<]*)</span>`).exec(html);
    expect(memo && decode(memo[1]), `${category.id} Field Notes line`).toBe(category.line);
    const card = new RegExp(`class="specimen-slide slide-${category.id}"[^>]*aria-label="([^"]*)"[\\s\\S]*?<div class="specimen-desc">([^<]*)</div>`).exec(html);
    expect(card && decode(card[1]), `${category.id} card label`).toBe(`${category.name}. ${category.line}`);
    expect(card && decode(card[2]), `${category.id} card line`).toBe(blogCategoryShortLine(category));
  }
});

// The ring spores rode the caption path, so they crossed the lettering on every lap.
test('the ring spores run an orbit no caption sits on', () => {
  const html = readText('index.html');
  const sporePaths = new Set([...html.matchAll(/<mpath href="#([^"]+)"/g)].map((m) => m[1]));
  const captionPaths = new Set([...html.matchAll(/<textPath href="#([^"]+)"/g)].map((m) => m[1]));
  expect(sporePaths.size).toBeGreaterThan(0);
  for (const id of sporePaths) expect(captionPaths.has(id), `#${id} carries a caption`).toBe(false);
});

// A video with preload="none" and no poster showed every reader a large grey box.
test('every article video shows a published poster frame before it plays', () => {
  const published = new Set(JSON.parse(readText('scripts/public-files.json')));
  const articles = ['blog/codex/fail-fast-learn-faster.html', 'blog/cosmos/first-year-software-engineer.html'];
  let videos = 0;
  for (const article of articles) {
    for (const [tag] of readText(article).matchAll(/<video\b[^>]*>/g)) {
      videos++;
      const poster = /\bposter="([^"]+)"/.exec(tag)?.[1];
      expect(poster, `${article} video poster`).toBeTruthy();
      const file = path.posix.normalize(path.posix.join(path.posix.dirname(article), poster!));
      expect(published.has(file), `${file} is published`).toBe(true);
      expect(sizeOf(file)).toBeLessThan(60_000);
    }
  }
  expect(videos).toBeGreaterThan(0);
});

test('public discovery files identify the canonical portfolio URL', () => {
  const robots = readText('robots.txt');
  const sitemap = readText('sitemap.xml');

  expect(robots).toContain('User-agent: *');
  expect(robots).toContain('Allow: /');
  expect(robots).toContain('Sitemap: https://zounarakis.com/sitemap.xml');
  expect(sitemap).toContain('<loc>https://zounarakis.com/</loc>');
  expect(sitemap).toMatch(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
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
  const quickNavStart = html.indexOf('<div class="living-sigils" role="group" aria-label="Profiles">');
  const quickNavEnd = html.indexOf('<!-- Portrait -->', quickNavStart);
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
  expect(readme).toContain('npm run deploy -- --commit');
  expect(readme).toContain('npm run deploy:preview -- --commit');
  expect(readme).not.toContain('pages deploy . --');
  expect(readme).toContain('functions/');
  expect(readme).not.toContain('Vercel');
});

test('sources keep no cache tokens by hand, the build sets every one from the content', () => {
  // A token bumped by hand once froze the live globe on stale code. scripts/build-site.mjs now writes
  // the import map and every ?v= value, so a source may only mark a file with an empty ?v=.
  const sources = ['index.html', '404.html', 'blog/codex/fail-fast-learn-faster.html', 'blog/cosmos/first-year-software-engineer.html',
    ...fs.readdirSync(path.join(repoRoot, 'js'), { recursive: true }).filter((f) => String(f).endsWith('.js')).map((f) => 'js/' + String(f).replace(/\\/g, '/')),
    ...fs.readdirSync(path.join(repoRoot, 'styles')).filter((f) => f.endsWith('.css')).map((f) => 'styles/' + f)];
  const handKept: string[] = [];
  for (const file of sources) {
    for (const match of readText(file).matchAll(/[\w./-]+\.(?:js|css|json|webp|png|jpg|svg|woff2|mp4|ico|pdf)\?v=([^'"`\s)]+)/g)) handKept.push(`${file}: ${match[0]}`);
  }
  expect(handKept).toEqual([]);
  expect(readText('index.html')).toMatch(/<script type="importmap">\s*\{ "imports": \{\} \}\s*<\/script>/);
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
