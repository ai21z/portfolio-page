import { chromium, expect, test } from '@playwright/test';

const VIEWS = ['intro', 'about', 'skills', 'blog', 'work', 'contact'];

test('under reduced motion no view runs a looping animation, and the SVG spores are paused', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  try {
    for (const view of VIEWS) {
      await page.goto(`/index.html${view === 'intro' ? '' : '#' + view}`);
      await expect(page.locator('#threshold')).toBeHidden();
      await page.waitForTimeout(800);
      const state = await page.evaluate(() => ({
        looping: document.getAnimations()
          .filter(a => a.playState === 'running' && a.effect?.getComputedTiming().iterations === Infinity)
          .map(a => (a as CSSAnimation).animationName || 'script'),
        unpaused: [...document.querySelectorAll('svg')]
          .filter(svg => svg.querySelector('animate, animateMotion, animateTransform') && !(svg as SVGSVGElement).animationsPaused())
          .length,
        smoothScroll: getComputedStyle(document.documentElement).scrollBehavior
      }));
      expect(state.looping, view).toEqual([]);
      expect(state.unpaused, view).toBe(0);
      expect(state.smoothScroll, view).toBe('auto');
    }
  } finally {
    await context.close();
  }
});

test('a reduced-motion setting changed while the page is open pauses and resumes the SVG spores', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/index.html#about');
  await expect(page.locator('#about')).toHaveClass(/active-section/);
  const paused = () => page.evaluate(() => [...document.querySelectorAll('svg')]
    .filter(svg => svg.querySelector('animateMotion'))
    .map(svg => (svg as SVGSVGElement).animationsPaused()));
  expect((await paused()).every(state => !state)).toBe(true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(async () => (await paused()).every(Boolean)).toBe(true);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect.poll(async () => (await paused()).every(state => !state)).toBe(true);
});

test('under reduced motion the article scroll buttons jump instead of gliding', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/index.html#blog/codex/fail-fast-learn-faster');
  const view = page.locator('#blog-article-view');
  await expect(view).toBeVisible();
  await view.evaluate(el => { el.scrollTop = 900; el.dispatchEvent(new Event('scroll')); });
  await expect(page.locator('.article-scroll-nav')).toHaveClass(/visible/);
  // An instant scroll has landed by the time click() returns. A smooth one has barely started.
  const top = await page.evaluate(() => {
    (document.querySelector('.scroll-nav-btn[data-action="top"]') as HTMLButtonElement).click();
    return document.getElementById('blog-article-view')!.scrollTop;
  });
  expect(top).toBe(0);
});

test('under reduced motion the WebGL views hold still, and a drag still turns the globe, then stops', async ({ browserName, baseURL }) => {
  // The globe and the dish draw with WebGL, which needs a real GPU here.
  test.skip(browserName !== 'chromium', 'needs a GPU Chromium');
  test.setTimeout(90_000);
  const gpu = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
  try {
    const context = await gpu.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, hasTouch: false, isMobile: false, reducedMotion: 'reduce', baseURL });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    const shot = async () => (await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 300, y: 80, width: 840, height: 740, scale: 1 } })).data;
    for (const view of ['blog', 'work']) {
      await page.goto(`/index.html#${view}`);
      const live = await page.evaluate(() => Boolean(document.querySelector(`.stage.active-section canvas:not([style*="display: none"])`)) &&
        !document.querySelector('.stage.active-section .webgl-fallback-visible'));
      test.skip(!live, 'no hardware WebGL here');
      await page.waitForTimeout(view === 'work' ? 6000 : 4000);
      await page.mouse.move(2, 2);
      // A scene in motion differs in every pair. A one-off redraw, such as the governor changing tier
      // under a loaded machine, differs in one pair only.
      let still = false;
      for (let attempt = 0; attempt < 3 && !still; attempt++) {
        const first = await shot();
        await page.waitForTimeout(1200);
        still = (await shot()) === first;
      }
      expect(still, `${view} moved while held still`).toBe(true);
    }
    const box = (await page.locator('#work-globe-canvas').boundingBox())!;
    const before = await shot();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 200, box.y + box.height / 2, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const released = await shot();
    expect(released).not.toBe(before);
    await page.waitForTimeout(1200);
    expect(await shot(), 'the globe coasted after the drag').toBe(released);
  } finally {
    await gpu.close();
  }
});
