import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const artifactPath = path.join(repoRoot, 'artifacts', 'browser-audit-parts', 'contact-entry-performance.json');

const turnstileStubScript = `
  window.turnstile = {
    render: function (container, options) {
      setTimeout(function () {
        if (options && typeof options.callback === 'function') {
          options.callback('test-turnstile-token');
        }
      }, 10);
      return 'stub-widget';
    },
    execute: function () {},
    reset: function () {},
    remove: function () {}
  };
  if (typeof window.__turnstileOnLoad === 'function') {
    window.__turnstileOnLoad();
  } else {
    document.dispatchEvent(new CustomEvent('turnstile-loaded'));
  }
`;

async function waitForActiveSection(page: Page, id: string) {
  await page.waitForFunction((sectionId) => {
    const section = document.getElementById(sectionId);
    return !!section && section.classList.contains('active-section');
  }, id);
}

test.beforeEach(async ({ page }) => {
  await page.route('https://challenges.cloudflare.com/**', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: turnstileStubScript
    });
  });
});

test('records Contact first-entry frame timing evidence at old-laptop viewport', async ({ page, browserName }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/index.html');
  await page.waitForLoadState('domcontentloaded');
  await waitForActiveSection(page, 'main');

  const samplePromise = page.evaluate(() => {
    return new Promise<{
      frameCount: number;
      averageDeltaMs: number;
      maxDeltaMs: number;
      framesOver50ms: number;
      framesOver100ms: number;
    }>((resolve) => {
      const deltas: number[] = [];
      const startedAt = performance.now();
      let last = startedAt;

      const tick = (now: number) => {
        deltas.push(now - last);
        last = now;

        if (now - startedAt < 1500) {
          requestAnimationFrame(tick);
          return;
        }

        const measured = deltas.slice(1);
        const total = measured.reduce((sum, value) => sum + value, 0);
        resolve({
          frameCount: measured.length,
          averageDeltaMs: Number((total / Math.max(1, measured.length)).toFixed(2)),
          maxDeltaMs: Number(Math.max(0, ...measured).toFixed(2)),
          framesOver50ms: measured.filter((value) => value > 50).length,
          framesOver100ms: measured.filter((value) => value > 100).length
        });
      };

      requestAnimationFrame(tick);
    });
  });

  await page.locator('.network-node-label[data-node="contact"]').click();
  await waitForActiveSection(page, 'contact');
  const sample = await samplePromise;

  fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
  const existing = fs.existsSync(artifactPath)
    ? JSON.parse(fs.readFileSync(artifactPath, 'utf8'))
    : {};

  existing[browserName] = {
    viewport: '1366x768',
    scenario: 'intro-to-contact',
    turnstile: 'stubbed',
    ...sample
  };

  fs.writeFileSync(artifactPath, `${JSON.stringify(existing, null, 2)}\n`);

  expect(sample.frameCount).toBeGreaterThan(0);
});
