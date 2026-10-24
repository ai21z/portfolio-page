import { test, expect } from '@playwright/test';

test('does not serve private or development files', async ({ request }) => {
  for (const file of [
    '/.claude/launch.json', '/.env', '/.dev.vars', '/.git/config', '/.gitignore',
    '/docs/local/BLOG-GUIDE.md', '/docs/local/cleanup-audit.md',
    '/docs/superpowers/plans/2026-05-01-adaptive-graphics-governor.md',
    '/tests/contact-form.spec.ts', '/artifacts/browser-audit-report.json',
    '/package.json', '/package-lock.json', '/functions/api/contact.js', '/scripts/build-site.mjs'
  ]) {
    const response = await request.get(file);
    expect(response.status(), file).toBe(404);
  }
});

test('keeps every email address in the page out of Cloudflare email obfuscation', async ({ request }) => {
  // The obfuscation adds parser-blocking scripts and rewrites mailto links to a page that needs JavaScript.
  const html = await (await request.get('/index.html')).text();
  const body = html.slice(html.indexOf('<body>'));
  const start = body.indexOf('<!--email_off-->');
  const end = body.indexOf('<!--/email_off-->');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const addresses = [...body.matchAll(/[\w.+-]+@[\w-]+\.[\w.]+/g)].map(match => match.index);
  expect(addresses.length).toBeGreaterThan(0);
  for (const at of addresses) expect(at > start && at < end, `address at ${at}`).toBe(true);
});

test('serves pages without development comments, keeping only the email_off markers', async ({ request }) => {
  for (const page of ['/index.html', '/404.html', '/blog/codex/fail-fast-learn-faster', '/blog/cosmos/first-year-software-engineer']) {
    const html = await (await request.get(page)).text();
    const comments = [...html.matchAll(/<!--([\s\S]*?)-->/g)].map(match => match[1].trim());
    expect(comments.filter(text => text !== 'email_off' && text !== '/email_off'), page).toEqual([]);
  }
});

test('serves the portfolio assets and public documents', async ({ request }) => {
  for (const file of [
    '/index.html', '/favicon.ico', '/js/app.js', '/js/contact.js', '/styles/main.css',
    '/robots.txt', '/sitemap.xml', '/manifest.json', '/og/og-1200x630.png',
    '/artifacts/network-lite.json', '/artifacts/fonts/LICENSE.txt',
    '/artifacts/resume/Vissarion_Aris_Zounarakis_Software_Engineer_Resume.pdf'
  ]) {
    const response = await request.get(file);
    expect(response.status(), file).toBe(200);
  }
});
