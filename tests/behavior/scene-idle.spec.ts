import { expect, test, type Page } from '@playwright/test';

// The Blog dish and the Work globe should spend nothing when no one can see them move: a compact
// layout hides the dish, and under reduced motion both scenes hold still.

async function drawOnSoftware(page: Page) {
  // Headless browsers draw on a software renderer, which keeps the reduced fallback.
  await page.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext as any;
    HTMLCanvasElement.prototype.getContext = function (type: string, attrs: any) {
      if (type === 'webgl2') return orig.call(this, type, { ...(attrs || {}), failIfMajorPerformanceCaveat: false });
      return orig.call(this, type, attrs);
    };
  });
}

async function countFrames(page: Page) {
  await page.addInitScript(() => {
    const orig = window.requestAnimationFrame.bind(window);
    (window as any).__frames = 0;
    window.requestAnimationFrame = (callback: FrameRequestCallback) => {
      (window as any).__frames++;
      return orig(callback);
    };
  });
  return async (ms: number) => {
    const start = await page.evaluate(() => (window as any).__frames);
    await page.waitForTimeout(ms);
    return (await page.evaluate(() => (window as any).__frames)) - start;
  };
}

test('a compact Blog never loads or draws the dish, a widened window starts it, and narrowing stops it', async ({ page }) => {
  await drawOnSoftware(page);
  const requested: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/blog-network-webgl.js') || path.endsWith('/blog_network.json')) requested.push(path);
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/index.html#blog');
  await expect(page.locator('#blog')).toHaveClass(/active-section/);
  await page.waitForTimeout(1500);
  expect(requested).toEqual([]);
  const canvas = page.locator('#blog-network-canvas');
  await expect(canvas).not.toHaveClass(/is-drawn/);

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(canvas).toHaveClass(/is-drawn/, { timeout: 15_000 });
  expect(requested).toContain('/js/blog-network-webgl.js');

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(canvas).not.toHaveClass(/is-drawn/);
  await expect.poll(() => canvas.evaluate((el: HTMLCanvasElement) => el.width)).toBe(1);
});

for (const [section, ready] of [['blog', '#blog-network-canvas.is-drawn'], ['work', '#work .work-rail .rail-node']] as const) {
  test(`under reduced motion the ${section} scene stops asking for frames once still, and input wakes it`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await drawOnSoftware(page);
    const frames = await countFrames(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/index.html#' + section);
    await expect(page.locator('#' + section)).toHaveClass(/active-section/);
    await page.waitForSelector(ready, { timeout: 15_000 });
    await page.waitForTimeout(2500);
    // Held still: about one frame a second, where every frame was drawn before.
    const idle = await frames(2000);
    expect(idle).toBeLessThan(15);
    // A pointer moving over the scene keeps it drawing: more frames in two seconds than when idle.
    // Headless frame rates vary with load (software WebGL draws the globe slowly in WebKit), so the
    // check compares two equal spans rather than counting.
    const start = await page.evaluate(() => (window as any).__frames);
    for (let step = 0; step < 10; step++) {
      await page.mouse.move(880 + step * 6, 450 + step * 3);
      await page.waitForTimeout(200);
    }
    const awake = (await page.evaluate(() => (window as any).__frames)) - start;
    expect(awake).toBeGreaterThan(idle * 2);
  });
}
