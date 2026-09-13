import { expect, test } from '@playwright/test';
import { stubVerification } from './helpers/contact';

for (const viewport of [{ width: 320, height: 568 }, { width: 844, height: 390 }, { width: 1366, height: 900 }]) {
  test(`layout review at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    test.setTimeout(90000);
    await stubVerification(page);
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const section of ['main', 'about', 'skills', 'work', 'blog', 'contact']) {
      await page.goto('/index.html#' + section);
      await expect(page.locator('html')).toHaveClass(/js-ready/);
      await expect(page.locator('#threshold')).toBeHidden();
      const active = page.locator('#' + section);
      await expect(active).toHaveClass(/active-section/);
      for (const inactive of await page.locator('.stage:not(.active-section)').all()) {
        await expect(inactive).toHaveCSS('opacity', '0');
      }
      if (section === 'work') await expect(page.locator('.work-rail')).toBeVisible();
      if (section === 'contact') await expect(page.locator('button[type="submit"]')).toBeEnabled();
      await page.screenshot({ path: testInfo.outputPath(section + '.png'), animations: 'disabled' });
      const clippedText = await active.evaluate(el => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        const clipped: string[] = [];
        while (walker.nextNode()) {
          const node = walker.currentNode;
          const parent = node.parentElement;
          if (!node.textContent?.trim() || !parent?.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) ||
              parent.closest('[aria-hidden="true"], .sr-only, #work-index')) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          if (Array.from(range.getClientRects()).some(rect => rect.width > 0 && (rect.left < -1 || rect.right > innerWidth + 1))) {
            clipped.push(node.textContent.trim().slice(0, 100));
          }
        }
        return clipped;
      });
      expect(clippedText, section + ' text reflow').toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width + 1);
      expect(await page.locator('img:visible').evaluateAll(images => images.every(image =>
        (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
    }
    expect(errors).toEqual([]);
  });
}

test('200 percent text remains reachable in contact and standalone reading', async ({ page }, testInfo) => {
  await stubVerification(page);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of ['/index.html#contact', '/blog/codex/fail-fast-learn-faster']) {
    await page.goto(route);
    await page.evaluate(() => {
      const textElements = Array.from(document.body.querySelectorAll<HTMLElement>('*'))
        .filter(el => Array.from(el.childNodes).some(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()))
        .map(el => ({ el, size: parseFloat(getComputedStyle(el).fontSize) }));
      for (const { el, size } of textElements) el.style.fontSize = `${size * 2}px`;
    });
    const link = route.includes('contact') ? page.locator('.contact-email') : page.locator('.back-button');
    await link.scrollIntoViewIfNeeded();
    await expect(link).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(route.includes('contact') ? 'contact-large-text.png' : 'article-large-text.png'), animations: 'disabled' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
  }
});

test('intro canvas has visible pixels and changes between frames', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto('/index.html');
  await expect(page.locator('#threshold')).toBeHidden();
  const canvas = page.locator('#spore-canvas');
  await expect.poll(() => canvas.evaluate((el: HTMLCanvasElement) => el.width)).toBeGreaterThan(100);
  const sample = () => canvas.evaluate((el: HTMLCanvasElement) => {
    const pixels = el.getContext('2d')!.getImageData(0, 0, el.width, el.height).data;
    let visible = 0;
    let hash = 2166136261;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 3]) visible++;
      hash = Math.imul(hash ^ pixels[index + 3], 16777619);
    }
    return { visible, hash };
  });
  await expect.poll(async () => (await sample()).visible).toBeGreaterThan(0);
  const first = await sample();
  await expect.poll(async () => (await sample()).hash).not.toBe(first.hash);
  await testInfo.attach('canvas-pixels.json', { body: JSON.stringify({ first, last: await sample() }), contentType: 'application/json' });
});

test('unavailable globe keeps its notice, timeline and work text separate', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      if (String(type).startsWith('webgl')) return null;
      return original.call(this, type, ...args);
    } as typeof original;
  });
  for (const width of [1024, 1366]) {
    await page.setViewportSize({ width, height: 768 });
    await page.goto('/index.html#work');
    await expect(page.locator('#work .webgl-fallback-visible')).toBeVisible();
    const rail = await page.locator('.work-rail').boundingBox();
    const text = await page.locator('#work-index').boundingBox();
    const notice = await page.locator('#work .webgl-fallback-visible').boundingBox();
    expect(text!.x).toBeGreaterThanOrEqual(rail!.x + rail!.width + 12);
    expect(text!.y).toBeGreaterThanOrEqual(notice!.y + notice!.height + 12);
    await page.screenshot({ path: testInfo.outputPath(`work-fallback-${width}.png`), animations: 'disabled' });
  }
});
