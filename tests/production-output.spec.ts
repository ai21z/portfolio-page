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

test('serves the portfolio assets and public documents', async ({ request }) => {
  for (const file of [
    '/index.html', '/js/app.js', '/js/contact.js', '/styles/main.css',
    '/robots.txt', '/sitemap.xml', '/manifest.json', '/og/og-1200x630.png',
    '/artifacts/network-lite.json', '/artifacts/fonts/LICENSE.txt',
    '/artifacts/resume/Vissarion_Aris_Zounarakis_Software_Engineer_Resume.pdf'
  ]) {
    const response = await request.get(file);
    expect(response.status(), file).toBe(200);
  }
});
