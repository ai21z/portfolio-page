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

  for (const hash of ['', '#about', '#work', '#blog', '#contact']) {
    await page.goto(`/index.html${hash}`);
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.stage.active-section')).toBeVisible();
  }

  await expect(page.locator('#main')).toHaveCount(1);
  await expect(page.locator('#work-globe-canvas')).toHaveCount(1);
  await expect(page.locator('#blog-network-canvas')).toHaveCount(1);
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

test('a desktop builds the mycelium network in idle time before any hover, a phone does not', async ({ browser, browserName }) => {
  // Safari has no idle callback, so there the first hover still builds it.
  test.skip(browserName === 'webkit', 'WebKit has no requestIdleCallback');
  test.setTimeout(45_000);
  const open = async (viewport: { width: number; height: number }, hasTouch: boolean) => {
    const page = await browser.newPage({ viewport, hasTouch });
    // Headless runs are on a software renderer, which the governor would keep on Quiet.
    await page.addInitScript(() => localStorage.setItem('aris.graphicsProfile', 'balanced'));
    const requests: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/artifacts/network-lite.json') requests.push(request.url());
    });
    await page.goto('/index.html');
    return { page, requests };
  };
  const [desktop, phone] = await Promise.all([open({ width: 1440, height: 900 }, false), open({ width: 390, height: 844 }, true)]);
  try {
    await expect.poll(() => desktop.requests.length, { timeout: 20_000 }).toBe(1);
    await expect.poll(() => desktop.page.evaluate(async () =>
      Object.keys((await import('/js/state.js')).LOCKED_ROUTES).length), { timeout: 10_000 }).toBe(5);
    await phone.page.waitForTimeout(2000);
    expect(phone.requests).toEqual([]);
  } finally {
    await Promise.all([desktop.page.close(), phone.page.close()]);
  }
});

test('Blog starts its network once after the idle warm-up loaded its module', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'The shader warm-up runs in Chromium only');
  test.setTimeout(45_000);
  await page.addInitScript(() => {
    localStorage.setItem('aris.graphicsProfile', 'balanced');
    // Every start of the network asks the Blog canvas for its context, even where it then shows the fallback.
    (window as any).__blogContexts = 0;
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: any[]) {
      if (this.id === 'blog-network-canvas') (window as any).__blogContexts++;
      return (getContext as any).apply(this, args);
    } as any;
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  // The warm-up loads Blog's module, then Work's, so Blog's step is done once Work's module is asked for.
  const workModule = page.waitForRequest(/\/js\/work-globe-webgl\.js/, { timeout: 25_000 });
  await page.goto('/index.html');
  await workModule;
  await page.evaluate(() => { location.hash = 'blog'; });
  await expect(page.locator('#blog')).toHaveClass(/active-section/);
  await expect.poll(() => page.evaluate(() => (window as any).__blogContexts)).toBeGreaterThan(0);
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => (window as any).__blogContexts)).toBe(1);
});

// The first entry into About, Skills or Contact built its GPU programs in the frame that showed it. The
// idle warm-up paints copies of the cards, the lens and the notebook first (js/paint-warmup.js): one at a
// time, after the landing's intro, while the pointer rests, hidden from everyone and gone afterwards.
test('the idle warm-up paints the paper views once, out of reach, while the visitor is still', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'The idle warm-up runs where requestIdleCallback exists');
  test.setTimeout(45_000);
  await page.addInitScript(() => {
    localStorage.setItem('aris.graphicsProfile', 'balanced');
    const seen: any[] = [];
    (window as any).__warmCopies = seen;
    new MutationObserver((records) => {
      for (const record of records) for (const node of record.addedNodes) {
        if (!(node instanceof HTMLElement) || !node.classList.contains('paint-warmup')) continue;
        seen.push({
          at: performance.now(),
          hidden: node.getAttribute('aria-hidden') === 'true' && node.inert,
          named: node.querySelectorAll('[id], [name], [for]').length,
          copy: node.firstElementChild?.className
        });
      }
    }).observe(document, { childList: true, subtree: true });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/index.html');
  // A pointer that keeps moving holds the copies back.
  let lastMove = 0;
  for (let i = 0; i < 36; i++) {
    await page.mouse.move(20 + (i % 2) * 6, 20);
    lastMove = await page.evaluate(() => performance.now());
    await page.waitForTimeout(300);
  }
  await expect.poll(() => page.evaluate(() => (window as any).__warmCopies.length), { timeout: 25_000 }).toBe(4);
  const copies = await page.evaluate(() => (window as any).__warmCopies);
  expect(copies.map((copy: any) => copy.copy.split(' ')[0])).toEqual(['slab', 'slab', 'altar-lens', 'notebook-page']);
  for (const copy of copies) {
    expect(copy.at).toBeGreaterThan(Math.max(9000, lastMove + 1400));
    expect(copy.hidden).toBe(true);
    expect(copy.named).toBe(0);
  }
  await expect(page.locator('.paint-warmup')).toHaveCount(0);
});

test('intro ritual toggle and work navigation do not throw route errors', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/index.html');
  await page.waitForLoadState('domcontentloaded');

  // A toggle with a plain name, its state in aria-pressed.
  const sigil = page.getByRole('button', { name: 'Drifting labels', exact: true });
  await expect(sigil).toBeVisible();
  await expect(sigil).toHaveAttribute('aria-pressed', 'false');
  await sigil.click();
  await expect(sigil).toHaveAttribute('aria-pressed', 'true');

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
  await expect.poll(async () => {
    const fallbackVisible = await page.locator('#blog .webgl-fallback-visible').isVisible().catch(() => false);
    if (fallbackVisible) return 'fallback';
    const width = await page.locator('#blog-network-canvas').evaluate((canvas: HTMLCanvasElement) => canvas.width);
    return width > 100 ? 'canvas' : 'pending';
  }).not.toBe('pending');
  const blogFallbackVisible = await page.locator('#blog .webgl-fallback-visible').isVisible().catch(() => false);
  if (blogFallbackVisible) {
    await expect(page.locator('#blog .webgl-fallback-visible')).toContainText(/Graphics are reduced/i);
    await expect.poll(
      () => page.locator('#blog-network-canvas').evaluate((canvas: HTMLCanvasElement) => canvas.width)
    ).toBeLessThanOrEqual(1);
  } else {
    await expect.poll(
      () => page.locator('#blog-network-canvas').evaluate((canvas: HTMLCanvasElement) => canvas.width)
    ).toBeGreaterThan(100);
  }

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
  const hashes = ['', '#about', '#skills', '#work', '#blog', '#contact'];

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

test('portrait fallback handling does not rely on inline event handlers', async ({ page }) => {
  await page.goto('/index.html');
  await page.waitForLoadState('domcontentloaded');

  const inlineHandlers = await page.locator('.core-plate img[onerror]').count();
  expect(inlineHandlers).toBe(0);
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
      const optionalRects = [1, 2, 3, 4, 5].map((n) => rectFor(`.living-sigils .sigil-vial:nth-of-type(${n})`));
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

// On laptops the social rail hung into the text column and its last link sat on the bio's first line.
// Where there is room the column stands as far from the left edge as the hub sigil from the right one.
test('the profile column mirrors the hub sigil gap to the edge, and keeps clear of the bio and the portrait', async ({ page }) => {
  for (const viewport of [{ width: 1280, height: 720 }, { width: 1280, height: 800 }, { width: 1366, height: 768 }, { width: 1024, height: 768 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }, { width: 2560, height: 1440 }]) {
    await page.setViewportSize(viewport);
    await page.goto('/index.html');
    await expect(page.locator('.living-sigils')).toBeVisible();
    await expect(page.locator('.living-sigils')).toHaveAttribute('data-rail-left', '');
    const gap = await page.evaluate(() => {
      const links = [...document.querySelectorAll('.living-sigils .sigil-vial')].map((a) => a.getBoundingClientRect());
      const column = Math.min(...['.tape', '.portrait', '.name'].map((selector) => document.querySelector(selector)!.getBoundingClientRect().left));
      const hubGap = innerWidth - document.querySelector('.network-sigil-node')!.getBoundingClientRect().right;
      return { toColumn: column - Math.max(...links.map((r) => r.right)), toEdge: Math.min(...links.map((r) => r.left)), lefts: new Set(links.map((r) => Math.round(r.left))).size, hubGap, roomy: column - 16 - 44 >= hubGap && hubGap >= 16 };
    });
    // The glass hovers 2.5px about its place, inside the link's box.
    const size = `${viewport.width}x${viewport.height}`;
    expect(gap.toColumn, `${size} column to text column`).toBeGreaterThanOrEqual(16);
    expect(gap.toEdge, `${size} column to window edge`).toBeGreaterThanOrEqual(16);
    expect(gap.lefts, `${size} one straight column`).toBe(1);
    if (gap.roomy) expect(Math.abs(gap.toEdge - gap.hubGap), `${size} column mirrors the hub's gap`).toBeLessThan(1.5);
  }
});

test('uses the desktop blog map and mobile specimen grid at the correct breakpoints', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/index.html#blog');
  await page.waitForLoadState('domcontentloaded');

  await expect(page.locator('#blog-map')).toBeVisible();
  await expect(page.locator('.blog-mobile')).toBeHidden();
  await expect.poll(async () => {
    if (await page.locator('.arc-btn[data-hub="craft"]').count()) return 'arc';
    if (await page.locator('#blog .webgl-fallback-visible').isVisible().catch(() => false)) return 'fallback';
    return 'pending';
  }).not.toBe('pending');

  // Craft is a dormant culture, which opens nothing, so the live Codex is the one opened here.
  if (await page.locator('.arc-btn[data-hub="codex"]').count()) {
    await expect(page.locator('.arc-btn[data-hub="codex"]')).toBeVisible();
    await page.locator('.arc-btn[data-hub="codex"]').press('Enter');
  } else {
    await expect(page.locator('#blog .webgl-fallback-visible')).toContainText(/Graphics are reduced/i);
    await page.locator('.blog-memo-item[data-hub="codex"]').press('Enter');
  }
  await expect(page).toHaveURL(/#blog\/codex$/);
  await expect(page.locator('#blog-category-view')).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/index.html#blog');
  await page.waitForLoadState('domcontentloaded');

  await expect(page.locator('#blog-map')).toBeHidden();
  await expect(page.locator('.blog-mobile')).toBeVisible();
  await expect(page.locator('a.slide-codex')).toBeVisible();
  await page.locator('a.slide-codex').click();
  await expect(page).toHaveURL(/#blog\/codex$/);
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
