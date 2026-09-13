import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 412, height: 915 }, hasTouch: true, deviceScaleFactor: 2.625 });

test('mobile startup skips WebGL probes and contact verification', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', request => requests.push(request.url()));
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    (window as any).__webglRequests = 0;
    HTMLCanvasElement.prototype.getContext = function (...args: any[]) {
      if (String(args[0]).startsWith('webgl')) (window as any).__webglRequests++;
      return getContext.apply(this, args as any);
    } as typeof getContext;
  });
  await page.goto('/index.html');
  await expect(page.locator('html')).toHaveAttribute('data-graphics-effective-profile', 'quiet');
  await expect(page.locator('#threshold')).toBeHidden();
  expect(await page.evaluate(() => (window as any).__webglRequests)).toBe(0);
  expect(requests.filter(url => url.includes('challenges.cloudflare.com'))).toEqual([]);
  const portraits = requests.filter(url => url.includes('myOminousGreenPortrait'));
  expect(portraits).toHaveLength(1);
  expect(portraits[0]).toContain('myOminousGreenPortrait-800.webp');
  expect(requests.some(url => url.includes('/sigil/AZ-01.'))).toBe(false);

  await page.evaluate(() => { location.hash = 'work'; });
  await expect(page.locator('#work')).toHaveClass(/active-section/);
  await expect.poll(() => page.evaluate(() => (window as any).__webglRequests)).toBeGreaterThan(0);
});

for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1024, height: 768 }]) {
  test(`touch startup stays quiet with a saved Full setting at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.addInitScript(() => localStorage.setItem('aris.graphicsProfile', 'full'));
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/index.html');
    await expect(page.locator('html')).toHaveAttribute('data-graphics-effective-profile', 'quiet');
    await expect(page.locator('#threshold')).toBeHidden();
    const state = await page.evaluate(async () => {
      const { default: icons } = await import('/js/social-icons-animation.js');
      icons.init();
      return {
        iconCount: icons.icons.length,
        expectedCount: document.querySelectorAll('.sigil-vial:not(.sigil-vial-split)').length,
        iconsRunning: icons.isActive,
        canvases: ['spore-canvas', 'reveal-canvas'].map(id => {
          const canvas = document.getElementById(id) as HTMLCanvasElement;
          return canvas.width * canvas.height;
        }),
        portraitLoaded: (document.querySelector('.portrait') as HTMLImageElement).naturalWidth > 0,
        animatedDecorations: document.getAnimations().filter(animation =>
          animation.playState === 'running' && animation.effect?.getTiming().iterations === Infinity).length
      };
    });
    expect(state.iconCount).toBe(state.expectedCount);
    expect(state.iconsRunning).toBe(false);
    expect(state.canvases).toEqual([1, 1]);
    expect(state.portraitLoaded).toBe(true);
    expect(state.animatedDecorations).toBe(0);
    await page.clock.install();
    await page.clock.fastForward(30_000);
    await expect(page.locator('.hub-spore')).toHaveCount(0);
    await page.getByRole('button', { name: 'Open menu', exact: true }).click();
    await expect(page.locator('#necro-menu')).toBeVisible();
    await page.locator('#necro-menu [data-nav-open="about"]').click();
    await expect(page.locator('#about')).toHaveClass(/active-section/);
    expect(errors).toEqual([]);
  });
}

test('desktop social animation initializes only once and stops in Quiet', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, hasTouch: false });
  try {
    await page.goto('/index.html');
    await expect(page.locator('#threshold')).toBeHidden();
    const state = await page.evaluate(async () => {
      const { default: icons } = await import('/js/social-icons-animation.js');
      const governor = await import('/js/graphics-governor.js');
      icons.init();
      icons.init();
      const count = icons.icons.length;
      const expected = document.querySelectorAll('.sigil-vial:not(.sigil-vial-split)').length;
      governor.setGraphicsProfile('quiet', { persist: false });
      const stopped = !icons.isActive && icons.animationFrameId === null;
      governor.setGraphicsProfile('balanced', { persist: false });
      return { count, expected, stopped, resumed: icons.isActive };
    });
    expect(state.count).toBe(state.expected);
    expect(state.stopped).toBe(true);
    expect(state.resumed).toBe(true);
    await page.clock.install();
    await page.evaluate(async () => {
      const governor = await import('/js/graphics-governor.js');
      governor.setGraphicsProfile('quiet', { persist: false });
    });
    await page.clock.fastForward(30_000);
    await expect(page.locator('.hub-spore')).toHaveCount(0);
  } finally {
    await page.close();
  }
});

test('reading graphics state preserves the recovery notification', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, hasTouch: false });
  try {
    await page.clock.install();
    await page.goto('/index.html');
    await expect(page.locator('#threshold')).toBeHidden();
    await page.clock.fastForward(2000);
    await page.evaluate(async () => {
      const governor = await import('/js/graphics-governor.js');
      governor.setGraphicsProfile('balanced', { persist: false });
      (window as any).__recoveryEvents = [];
      window.addEventListener('graphics:profile-change', (event: CustomEvent) => {
        (window as any).__recoveryEvents.push(event.detail.effectiveProfile);
      });
      governor.markGraphicsActivity('test', 700);
    });
    await page.clock.fastForward(710);
    await page.evaluate(async () => {
      const governor = await import('/js/graphics-governor.js');
      governor.getGraphicsState();
    });
    await page.clock.fastForward(60);
    expect(await page.evaluate(() => (window as any).__recoveryEvents)).toContain('balanced');
  } finally {
    await page.close();
  }
});

test('contact loads and mounts verification once after opening', async ({ page }) => {
  let loads = 0;
  await page.route('https://challenges.cloudflare.com/**', route => {
    loads++;
    return route.fulfill({ contentType: 'application/javascript', body: `
      window.__verificationMounts = 0;
      window.turnstile = {
        render(container, options) {
          window.__verificationMounts++;
          options.callback('test-token');
          return 'test-widget';
        }
      };
      window.__turnstileOnLoad();
    ` });
  });
  await page.goto('/index.html');
  await expect(page.locator('#threshold')).toBeHidden();
  expect(loads).toBe(0);
  await page.evaluate(() => { location.hash = 'contact'; });
  await expect(page.getByRole('button', { name: /send message/i })).toBeEnabled();
  await page.getByLabel('Your Name').fill('Test Visitor');
  await page.evaluate(() => { location.hash = 'about'; });
  await expect(page.locator('#about')).toHaveClass(/active-section/);
  await page.evaluate(() => { location.hash = 'contact'; });
  await expect(page.getByLabel('Your Name')).toHaveValue('Test Visitor');
  expect(loads).toBe(1);
  expect(await page.evaluate(() => (window as any).__verificationMounts)).toBe(1);
});

test('a blocked verification script leaves direct email available', async ({ page }) => {
  await page.route('https://challenges.cloudflare.com/**', route => route.abort());
  await page.goto('/index.html#contact');
  await expect(page.locator('[data-status]')).toHaveText(/verification service unavailable/i);
  await expect(page.locator('[data-status] a')).toHaveAttribute('href', 'mailto:aris@zounarakis.com');
  await expect(page.getByRole('button', { name: /send message/i })).toBeDisabled();
});

test('the production stylesheet has no nested stylesheet requests', async ({ page }) => {
  const styles: string[] = [];
  page.on('request', request => {
    if (request.resourceType() === 'stylesheet') styles.push(new URL(request.url()).pathname);
  });
  await page.goto('/index.html');
  expect(styles.sort()).toEqual(['/styles/graphics-controls.css', '/styles/main.css']);
  const importedRules = await page.evaluate(() => Array.from(document.styleSheets)
    .filter(sheet => sheet.href?.includes('/styles/main.css'))
    .flatMap(sheet => Array.from(sheet.cssRules))
    .filter(rule => rule.type === CSSRule.IMPORT_RULE).length);
  expect(importedRules).toBe(0);
});

test('explicit desktop quality still checks graphics capability', async ({ browser, browserName }) => {
  test.skip(browserName === 'firefox', 'Firefox only offers Quiet and Balanced.');
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, hasTouch: false });
  try {
    await page.goto('/index.html');
    await expect(page.locator('#threshold')).toBeHidden();
    const capability = await page.evaluate(async () => {
      const governor = await import('/js/graphics-governor.js');
      const before = governor.getGraphicsState().capability.webgl2;
      governor.setGraphicsProfile('full', { persist: false });
      return { before, after: governor.getGraphicsState().capability.webgl2 };
    });
    expect(capability.before).toBeNull();
    expect(typeof capability.after).toBe('boolean');
  } finally {
    await page.close();
  }
});
