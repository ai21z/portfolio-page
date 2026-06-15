import { test, expect } from '@playwright/test';

test('blog Back/Forward traverses map <-> category without losing Forward', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext as any;
    HTMLCanvasElement.prototype.getContext = function (type: string, attrs: any) {
      if (type === 'webgl2') {
        const ctx = orig.call(this, type, { ...(attrs || {}), failIfMajorPerformanceCaveat: false });
        if (ctx && !(ctx as any).__s) {
          (ctx as any).__s = true; const gp = ctx.getParameter.bind(ctx);
          ctx.getParameter = (p: number) => (p === 0x9246 ? 'ANGLE (NVIDIA GeForce RTX 3080 Direct3D11)' : gp(p));
        }
        return ctx;
      }
      return orig.call(this, type, attrs);
    };
  });

  await page.setViewportSize({ width: 390, height: 844 }); // mobile: specimen links are real <a href="#blog/..">
  await page.goto('/index.html#blog');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => document.getElementById('blog')?.classList.contains('active-section'), { timeout: 8000 });
  await page.waitForTimeout(300);

  const mode = () => page.evaluate(() => ({
    hash: location.hash,
    blogMode: document.getElementById('blog')?.dataset.mode,
    categoryHidden: document.getElementById('blog-category-view')?.hasAttribute('hidden'),
  }));
  const histLen = () => page.evaluate(() => history.length);

  const len0 = await histLen();
  await page.locator('.specimen-slide.slide-craft').click(); // -> #blog/craft
  await page.waitForTimeout(350);
  const atCraft = await mode();
  const len1 = await histLen();

  await page.goBack();
  await page.waitForTimeout(350);
  const afterBack = await mode();

  await page.goForward();
  await page.waitForTimeout(350);
  const afterForward = await mode();

  console.log('BLOGHIST', JSON.stringify({ len0, len1, atCraft, afterBack, afterForward, errors }));
  expect(errors).toEqual([]);
  // entering the hub adds exactly ONE history entry (no double-push)
  expect(len1 - len0).toBe(1);
  expect(atCraft.hash).toBe('#blog/craft');
  expect(atCraft.blogMode).toBe('category');
  // Back -> map
  expect(afterBack.hash === '#blog' || afterBack.hash === '').toBe(true);
  expect(afterBack.blogMode).toBe('map');
  // Forward still works (was destroyed before the fix) -> category again
  expect(afterForward.hash).toBe('#blog/craft');
  expect(afterForward.blogMode).toBe('category');
});
