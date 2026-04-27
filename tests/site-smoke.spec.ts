import { test, expect } from '@playwright/test';

const turnstileStubScript = `
  window.turnstile = {
    render: function (container, options) {
      if (options && typeof options.callback === 'function') {
        options.callback('test-turnstile-token');
      }
      return 'stub-widget';
    },
    reset: function () {},
    remove: function () {}
  };
  if (typeof window.__turnstileOnLoad === 'function') {
    window.__turnstileOnLoad();
  } else {
    document.dispatchEvent(new CustomEvent('turnstile-loaded'));
  }
`;

test.beforeEach(async ({ page }) => {
  await page.route('https://challenges.cloudflare.com/**', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: turnstileStubScript
    });
  });
});

test('loads major sections without page errors or missing local assets', async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const badLocalResponses: string[] = [];

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (url.hostname === '127.0.0.1' && response.status() >= 400) {
      badLocalResponses.push(`${response.status()} ${url.pathname}`);
    }
  });

  for (const hash of ['', '#now', '#work', '#blog', '#contact']) {
    await page.goto(`/index.html${hash}`);
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.stage.active-section')).toBeVisible();
  }

  await expect(page.locator('#main')).toHaveCount(1);
  await expect(page.locator('#work-globe-canvas')).toHaveCount(1);
  await expect(page.locator('#blog-network-canvas')).toHaveCount(1);
  await expect(page.locator('#now-card-grid')).toHaveCount(1);
  await expect(page.locator('#contact-form')).toHaveCount(1);

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(badLocalResponses).toEqual([]);
});

test('defers compact mycelium network data until navigation effects need it', async ({ page }) => {
  let liteNetworkRequests = 0;
  let originalNetworkRequests = 0;

  await page.route('**/artifacts/network-lite.json', (route) => {
    liteNetworkRequests += 1;
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ paths: [] })
    });
  });
  await page.route('**/artifacts/network.json', (route) => {
    originalNetworkRequests += 1;
    route.abort();
  });

  await page.goto('/index.html');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(500);

  expect(liteNetworkRequests).toBe(0);
  expect(originalNetworkRequests).toBe(0);

  await page.locator('.network-node-label[data-node="about"]').hover();
  await expect.poll(() => liteNetworkRequests).toBeGreaterThan(0);
  expect(originalNetworkRequests).toBe(0);
});
