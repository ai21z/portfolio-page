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

test('intro ritual toggle and work navigation do not throw route errors', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/index.html');
  await page.waitForLoadState('domcontentloaded');

  const sigil = page.locator('.network-sigil-node');
  await expect(sigil).toBeVisible();
  await sigil.click();

  const workNode = page.locator('.network-node-label[data-node="work"]');
  await expect(workNode).toBeVisible();
  await workNode.click();

  await expect(page.locator('#work.active-section')).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('releases hidden visualization canvas buffers after leaving sections', async ({ page }) => {
  const waitForActiveSection = async (sectionId: string) => {
    await page.waitForFunction((id) => {
      const section = document.getElementById(id);
      return !!section && section.classList.contains('active-section');
    }, sectionId);
  };

  await page.goto('/index.html#work');
  await page.waitForLoadState('domcontentloaded');
  await waitForActiveSection('work');
  await expect.poll(
    () => page.locator('#work-globe-canvas').evaluate((canvas: HTMLCanvasElement) => canvas.width)
  ).toBeGreaterThan(100);

  await page.goto('/index.html#contact');
  await waitForActiveSection('contact');
  await expect.poll(
    () => page.locator('#work-globe-canvas').evaluate((canvas: HTMLCanvasElement) => canvas.width)
  ).toBeLessThanOrEqual(1);

  await page.goto('/index.html#blog');
  await waitForActiveSection('blog');
  await expect.poll(
    () => page.locator('#blog-network-canvas').evaluate((canvas: HTMLCanvasElement) => canvas.width)
  ).toBeGreaterThan(100);

  await page.goto('/index.html#contact');
  await waitForActiveSection('contact');
  await expect.poll(
    () => page.locator('#blog-network-canvas').evaluate((canvas: HTMLCanvasElement) => canvas.width)
  ).toBeLessThanOrEqual(1);
});

test('does not horizontally overflow common responsive viewports', async ({ page }) => {
  const viewports = [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1366, height: 768 }
  ];
  const hashes = ['', '#now', '#work', '#blog', '#contact'];

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);

    for (const hash of hashes) {
      await page.goto(`/index.html${hash}`);
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.stage.active-section')).toBeVisible();

      const overflow = await page.evaluate(() => {
        const doc = document.documentElement;
        const body = document.body;
        return Math.max(doc.scrollWidth, body.scrollWidth) - window.innerWidth;
      });

      expect(overflow, `${viewport.width}x${viewport.height} ${hash || '#intro'}`).toBeLessThanOrEqual(2);
    }
  }
});

test('keeps the intro composed on short desktop and old-laptop viewports', async ({ page }) => {
  const viewports = [
    { width: 1366, height: 768 },
    { width: 1366, height: 650 },
    { width: 1280, height: 650 },
    { width: 1024, height: 600 }
  ];

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto('/index.html');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.stage.active-section')).toBeVisible();

    const result = await page.evaluate(() => {
      const rectFor = (selector: string) => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return {
          selector,
          visible: rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || '1') > 0.05,
          top: rect.top,
          left: rect.left,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height
        };
      };

      const overlaps = (a: ReturnType<typeof rectFor>, b: ReturnType<typeof rectFor>) => {
        if (!a || !b || !a.visible || !b.visible) return false;
        return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
      };

      const essentialSelectors = ['.name', '.portrait-wrap', '.text-column', '.graphics-control'];
      const essentialRects = essentialSelectors.map(rectFor);
      const optionalRects = ['.living-sigils'].map(rectFor);
      const visibleLabelRects = Array.from(document.querySelectorAll('.network-node-label .node-label'))
        .map((element) => {
          const parent = element.closest('.network-node-label');
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return {
            selector: `.network-node-label[data-node="${parent?.getAttribute('data-node') || ''}"] .node-label`,
            visible: rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || '1') > 0.05,
            top: rect.top,
            left: rect.left,
            right: rect.right,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height
          };
        })
        .filter((rect) => rect.visible);

      const viewportInset = 8;
      const outsideViewport = [...essentialRects, ...optionalRects]
        .filter((rect): rect is NonNullable<typeof rect> => !!rect && rect.visible)
        .filter((rect) => (
          rect.top < -2 ||
          rect.left < -2 ||
          rect.right > window.innerWidth + 2 ||
          rect.bottom > window.innerHeight - viewportInset
        ));

      const labelOverlaps = visibleLabelRects
        .filter((label) => essentialRects.some((rect) => overlaps(label, rect)))
        .map((label) => label.selector);

      const scrollWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);

      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        overflowX: scrollWidth - window.innerWidth,
        outsideViewport,
        labelOverlaps
      };
    });

    expect(result.overflowX, `${viewport.width}x${viewport.height} overflow`).toBeLessThanOrEqual(2);
    expect(result.outsideViewport, `${viewport.width}x${viewport.height} clipped intro elements`).toEqual([]);
    expect(result.labelOverlaps, `${viewport.width}x${viewport.height} labels overlap hero`).toEqual([]);
  }
});

test('uses the desktop blog map and mobile specimen grid at the correct breakpoints', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/index.html#blog');
  await page.waitForLoadState('domcontentloaded');

  await expect(page.locator('#blog-map')).toBeVisible();
  await expect(page.locator('.blog-mobile')).toBeHidden();
  await expect(page.locator('.arc-btn[data-hub="craft"]')).toBeVisible();
  await page.locator('.arc-btn[data-hub="craft"]').press('Enter');
  await expect(page).toHaveURL(/#blog\/craft$/);
  await expect(page.locator('#blog-category-view')).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/index.html#blog');
  await page.waitForLoadState('domcontentloaded');

  await expect(page.locator('#blog-map')).toBeHidden();
  await expect(page.locator('.blog-mobile')).toBeVisible();
  await expect(page.locator('a.slide-craft')).toBeVisible();
  await page.locator('a.slide-craft').click();
  await expect(page).toHaveURL(/#blog\/craft$/);
  await expect(page.locator('#blog-category-view')).toBeVisible();
});

test('disabled or unknown hash routes fall back to intro instead of a blank page', async ({ page }) => {
  for (const hash of ['#resume', '#projects', '#not-a-section']) {
    await page.goto(`/index.html${hash}`);
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('#main.active-section')).toBeVisible();
    await expect(page.locator('.stage.active-section')).toHaveCount(1);
    await expect.poll(() => new URL(page.url()).hash, {
      message: `${hash} should be normalized back to the intro route`
    }).toBe('');
  }
});

test('coarse pointer social streams do not crash when portrait particles are disabled', async ({ browser, browserName, baseURL }) => {
  test.skip(browserName !== 'chromium', 'Firefox Playwright does not support isMobile contexts.');

  const context = await browser.newContext({
    viewport: { width: 320, height: 568 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true
  });

  await context.route('https://challenges.cloudflare.com/**', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: turnstileStubScript
    });
  });

  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto(new URL('/index.html', baseURL || 'http://127.0.0.1:4173').toString());
  await page.waitForLoadState('domcontentloaded');

  await expect(page.locator('.living-sigils .sigil-vial').first()).toBeVisible();
  await page.locator('.living-sigils .sigil-vial').first().hover();
  await page.waitForTimeout(250);

  expect(pageErrors).toEqual([]);
  await context.close();
});
