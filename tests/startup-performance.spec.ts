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

test('movement keeps the graphics tier and real slowness still notifies after a state read', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, hasTouch: false });
  try {
    // Contact runs no sampled render loop, so only the frames reported here reach the governor.
    await page.clock.install();
    await page.goto('/index.html#contact');
    await expect(page.locator('#contact')).toHaveClass(/active-section/);
    await page.clock.fastForward(2000);
    await page.evaluate(async () => {
      const governor = await import('/js/graphics-governor.js');
      governor.setGraphicsProfile('balanced', { persist: false });
      (window as any).__tierEvents = [];
      (window as any).__dprEvents = 0;
      window.addEventListener('graphics:profile-change', (event: CustomEvent) => {
        (window as any).__tierEvents.push(event.detail.effectiveProfile);
      });
      window.addEventListener('dpr-changed', () => { (window as any).__dprEvents++; });
      governor.markGraphicsActivity('test', 700);
    });
    const during = await page.evaluate(async () => {
      const governor = await import('/js/graphics-governor.js');
      return governor.getGraphicsState();
    });
    expect(during.movementRegression).toBe(true);
    expect(during.effectiveProfile).toBe('balanced');
    // Past the movement window and the settle time after the profile change.
    await page.clock.fastForward(1100);
    expect(await page.evaluate(() => (window as any).__tierEvents)).toEqual([]);
    expect(await page.evaluate(() => (window as any).__dprEvents)).toBe(0);

    const report = (deltaMs: number, count: number, intervalMs = 1000 / 30) => page.evaluate(async ([delta, n, cap]) => {
      const governor = await import('/js/graphics-governor.js');
      for (let i = 0; i < n; i++) governor.reportFrameSample('test', delta, cap);
      governor.getGraphicsState();
    }, [deltaMs, count, intervalMs]);

    // One vsync past a 30 fps cap is jitter, not slowness.
    await report(50.1, 30);
    await page.clock.fastForward(600);
    await report(50.1, 1);
    expect(await page.evaluate(() => (window as any).__tierEvents)).toEqual([]);

    // A 24 fps cap under Chrome's 30 Hz Energy Saver renders every 66.7 ms by design.
    await report(66.7, 30, 1000 / 24);
    await page.clock.fastForward(600);
    await report(66.7, 1, 1000 / 24);
    expect(await page.evaluate(() => (window as any).__tierEvents)).toEqual([]);

    // Two vsyncs past the cap is real slowness.
    await report(80, 20);
    await page.clock.fastForward(600);
    await report(80, 1);
    expect(await page.evaluate(() => (window as any).__tierEvents)).toEqual(['quiet']);
    await expect(page.locator('html')).toHaveAttribute('data-graphics-effective-profile', 'quiet');
  } finally {
    await page.close();
  }
});

test('capped loops render on the vsync that meets their cap despite timestamp jitter', async ({ page }) => {
  await page.goto('/index.html#contact');
  const due = await page.evaluate(async () => {
    const { frameDue } = await import('/js/graphics-governor.js');
    const cap30 = 1000 / 30;
    const cap24 = 1000 / 24;
    return {
      uncapped: frameDue(0.1, 0),
      oneVsyncAt30: frameDue(16.7, cap30),
      twoVsyncsJitteredLow: frameDue(33.2, cap30),
      slackEdge: frameDue(29.4, cap30),
      beforeSlack: frameDue(29.2, cap30),
      twoVsyncsAt24: frameDue(33.4, cap24),
      threeVsyncsAt24: frameDue(50, cap24),
      fiveFramesAt120Hz: frameDue(41.6, cap24)
    };
  });
  expect(due).toEqual({
    uncapped: true,
    oneVsyncAt30: false,
    twoVsyncsJitteredLow: true,
    slackEdge: true,
    beforeSlack: false,
    twoVsyncsAt24: false,
    threeVsyncsAt24: true,
    fiveFramesAt120Hz: true
  });
});

test('a slow burst costs one tier and the tier is retried with growing backoff', async ({ browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'Auto reaches Rich only in Chromium.');
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, hasTouch: false });
  try {
    await page.addInitScript(() => {
      localStorage.removeItem('aris.graphicsProfile');
      Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', { configurable: true, get: () => 8 });
      Object.defineProperty(Navigator.prototype, 'deviceMemory', { configurable: true, get: () => 8 });
    });
    // Contact runs no sampled render loop, so only the frames reported here reach the governor.
    await page.clock.install();
    await page.goto('/index.html#contact');
    await expect(page.locator('#contact')).toHaveClass(/active-section/);
    await page.clock.fastForward(2000);
    await page.evaluate(() => {
      (window as any).__tierEvents = [];
      window.addEventListener('graphics:profile-change', (event: CustomEvent) => {
        (window as any).__tierEvents.push(event.detail.effectiveProfile);
      });
    });
    const events = () => page.evaluate(() => (window as any).__tierEvents);
    const state = () => page.evaluate(async () => (await import('/js/graphics-governor.js')).getGraphicsState());
    const report = (deltaMs: number, count: number) => page.evaluate(async ([delta, n]) => {
      const governor = await import('/js/graphics-governor.js');
      for (let i = 0; i < n; i++) governor.reportFrameSample('test', delta, 0);
    }, [deltaMs, count]);
    const burst = async () => {
      await report(80, 20);
      await page.clock.fastForward(600);
      await report(80, 1);
    };
    expect((await state()).effectiveProfile).toBe('rich');

    // Gaps over a second are pauses such as a hidden tab, not frames.
    await report(5000, 6);
    await page.clock.fastForward(600);
    await report(16.7, 1);
    expect(await events()).toEqual([]);

    await burst();
    expect(await events()).toEqual(['balanced']);
    // The same burst is not counted twice, and the frames right after the change are not evidence.
    await page.clock.fastForward(600);
    await report(80, 20);
    await page.clock.fastForward(600);
    await report(80, 1);
    expect(await events()).toEqual(['balanced']);

    // With no sampled loop running, the stepped-down tier is retried after 20 s.
    await page.clock.fastForward(20_000);
    expect(await events()).toEqual(['balanced', 'rich']);

    // Failing the retry steps back down and the next retry waits 60 s instead of 20 s. The same
    // slowdown taking a second step still counts as one failed retry.
    await page.clock.fastForward(1100);
    await burst();
    expect(await events()).toEqual(['balanced', 'rich', 'balanced']);
    expect((await state()).failedPromotions).toBe(1);
    await page.clock.fastForward(1100);
    await burst();
    expect(await events()).toEqual(['balanced', 'rich', 'balanced', 'quiet']);
    expect((await state()).failedPromotions).toBe(1);
    await page.clock.fastForward(21_000);
    expect(await events()).toEqual(['balanced', 'rich', 'balanced', 'quiet']);
    await page.clock.fastForward(40_000);
    expect(await events()).toEqual(['balanced', 'rich', 'balanced', 'quiet', 'balanced']);
  } finally {
    await page.close();
  }
});

test('a held-back tier is retried after the base dips and returns, and never while the tab is hidden', async ({ browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'Auto reaches Rich only in Chromium.');
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, hasTouch: false });
  try {
    await page.addInitScript(() => {
      localStorage.removeItem('aris.graphicsProfile');
      Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', { configurable: true, get: () => 8 });
      Object.defineProperty(Navigator.prototype, 'deviceMemory', { configurable: true, get: () => 8 });
      // Lets the test hide the tab without leaving the page.
      let hidden = false;
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
      (window as any).__setHidden = (value: boolean) => { hidden = value; };
    });
    await page.clock.install();
    await page.goto('/index.html#contact');
    await expect(page.locator('#contact')).toHaveClass(/active-section/);
    await page.clock.fastForward(2000);
    const effective = () => page.locator('html').getAttribute('data-graphics-effective-profile');
    const report = (deltaMs: number, count: number) => page.evaluate(async ([delta, n]) => {
      const governor = await import('/js/graphics-governor.js');
      for (let i = 0; i < n; i++) governor.reportFrameSample('test', delta, 0);
    }, [deltaMs, count]);
    expect(await effective()).toBe('rich');
    await report(80, 20);
    await page.clock.fastForward(600);
    await report(80, 1);
    expect(await effective()).toBe('balanced');

    // A narrow window lowers the base to Balanced, so the retry finds nothing held back.
    await page.setViewportSize({ width: 1000, height: 900 });
    await page.clock.fastForward(20_500);
    expect(await effective()).toBe('balanced');
    // Restoring the width raises the base again, and the retry is armed again.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(() => (window as any).__setHidden(true));
    await page.clock.fastForward(20_500);
    expect(await effective()).toBe('balanced');
    await page.evaluate(() => (window as any).__setHidden(false));
    await page.clock.fastForward(5_500);
    expect(await effective()).toBe('rich');
  } finally {
    await page.close();
  }
});

test('a section module from a newer release reloads the page once, then only warns', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, hasTouch: false });
  try {
    // An open tab keeps its old governor, so a newer globe module importing a new export fails to link.
    await page.route('**/js/work-globe-webgl.js*', route => route.fulfill({
      contentType: 'application/javascript',
      body: "import { exportFromANewerRelease } from './graphics-governor.js'; export default exportFromANewerRelease;"
    }));
    // Firefox can restart a load still in progress, so count navigation requests rather than load events.
    let navigations = 0;
    page.on('request', request => { if (request.isNavigationRequest()) navigations++; });
    const warnings: string[] = [];
    page.on('console', message => { if (message.type() === 'warning') warnings.push(message.text()); });
    await page.goto('/index.html#work');
    await expect.poll(() => warnings.some(text => text.includes('work globe module unavailable')), { timeout: 15_000 }).toBe(true);
    expect(navigations).toBe(2);
    await expect(page.locator('#work')).toHaveClass(/active-section/);
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
