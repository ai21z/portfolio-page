import { expect, test } from '@playwright/test';
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createPagesRuntime } from './helpers/pages-runtime.mjs';
import { appendContentSecurity } from '../scripts/content-security.mjs';
import { publicFiles } from '../scripts/build-site.mjs';
import { fillContact, stubVerification } from './helpers/contact';

for (const mode of ['report-only', 'enforce']) {
  test('Pages CSP ' + mode + ' keeps essential journeys working', async ({ browser }, testInfo) => {
    test.setTimeout(120000);
    const directory = await mkdtemp(path.join(tmpdir(), 'portfolio-csp-'));
    await cp('dist', directory, { recursive: true });
    const pages = [];
    for (const file of publicFiles.filter(file => file.endsWith('.html'))) pages.push(await readFile(path.join(directory, file), 'utf8'));
    await writeFile(path.join(directory, '_headers'), appendContentSecurity(await readFile('_headers', 'utf8'), pages, mode));
    const server = await createPagesRuntime({ directory });
    const context = await browser.newContext({ baseURL: server.url, viewport: { width: 1366, height: 900 } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      (window as any).__cspViolations = [];
      document.addEventListener('securitypolicyviolation', event => {
        (window as any).__cspViolations.push({ directive: event.effectiveDirective, blocked: event.blockedURI });
      });
    });
    await stubVerification(page);
    await page.route('**/api/contact', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"state":"not_sent","error":"Synthetic service unavailable."}' }));
    try {
      for (const section of ['main', 'about', 'skills', 'work', 'blog', 'contact']) {
        const response = await page.goto('/#' + section);
        const header = mode === 'report-only' ? 'content-security-policy-report-only' : 'content-security-policy';
        if (section === 'main') expect(response).not.toBeNull();
        if (response) expect(response.headers()[header]).toContain("script-src 'self'");
        await expect(page.locator('html')).toHaveClass(/js-ready/);
        await expect(page.locator('.active-section')).toHaveAttribute('id', section);
        if (section === 'about' || section === 'skills') {
          await page.locator('#' + section + ' .paper').first().click();
          await expect(page.locator('.paper-modal')).toBeVisible();
          await page.keyboard.press('Escape');
          await expect(page.locator('.paper-modal')).toHaveCount(0);
        }
        if (section === 'contact') {
          await fillContact(page);
          await page.getByRole('button', { name: /send message/i }).click();
          await expect(page.locator('[data-status]')).toContainText('Synthetic service unavailable');
        }
        expect(await page.evaluate(() => (window as any).__cspViolations), section).toEqual([]);
      }
      for (const article of ['/blog/codex/fail-fast-learn-faster', '/blog/cosmos/first-year-software-engineer']) {
        await page.goto(article);
        await expect(page.locator('h1')).toBeVisible();
        expect(await page.evaluate(() => (window as any).__cspViolations)).toEqual([]);
      }
      expect(errors).toEqual([]);
      expect(server.unexpected).toEqual([]);
      if (mode === 'enforce') {
        await page.evaluate(() => {
          const script = document.createElement('script');
          script.textContent = 'window.__unexpectedInline = true';
          document.body.append(script);
        });
        expect(await page.evaluate(() => (window as any).__unexpectedInline)).toBeUndefined();
        await expect.poll(() => page.evaluate(() => (window as any).__cspViolations.length)).toBe(1);
      }
    } finally {
      await testInfo.attach('runtime-path.txt', { body: server.temporary, contentType: 'text/plain' });
      await context.close();
      await server.close();
    }
  });
}
