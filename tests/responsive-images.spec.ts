import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

for (const device of [
  { width: 320, dpr: 2, source: '-480.webp', size: 240 },
  { width: 390, dpr: 2, source: '-600.webp', size: 260 },
  { width: 412, dpr: 2.625, source: '-800.webp', size: 280 }
]) {
  test(`portrait selection and reserved space at ${device.width}px`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ viewport: { width: device.width, height: 844 }, deviceScaleFactor: device.dpr, hasTouch: true, reducedMotion: 'reduce' });
    const page = await context.newPage();
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const images: string[] = [];
    await page.route('**/myOminousGreenPortrait*', async route => {
      images.push(route.request().url());
      await blocked;
      await route.continue();
    });
    try {
      await page.goto(baseURL + '/index.html', { waitUntil: 'domcontentloaded' });
      const portrait = page.locator('.portrait');
      const reserved = await portrait.boundingBox();
      expect(reserved!.width).toBeCloseTo(device.size, 0);
      expect(reserved!.height).toBeCloseTo(device.size, 0);
      release();
      await expect.poll(() => portrait.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
      await page.waitForLoadState('load');
      const settled = await portrait.boundingBox();
      expect(settled!.height).toBeCloseTo(reserved!.height, 0);
      expect(images).toHaveLength(1);
      expect(images[0]).toContain(device.source);
    } finally {
      release();
      await context.close();
    }
  });
}

test('article media works in standalone and embedded reading', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of ['/blog/cosmos/first-year-software-engineer', '/index.html#blog/cosmos/first-year-software-engineer']) {
    const images: string[] = [];
    const collect = (request: { url(): string }) => {
      if (request.url().includes('1st-year-SE-article-image')) images.push(request.url());
    };
    page.on('request', collect);
    await page.goto(route);
    if (route.includes('index')) await expect(page.locator('#threshold')).toBeHidden();
    const picture = page.locator('.article-image:visible');
    await expect(picture).toBeVisible();
    await expect.poll(() => picture.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
    expect(await picture.evaluate((el: HTMLImageElement) => el.currentSrc)).toContain('1st-year-SE-article-image-800.webp');
    expect(images.every(url => !url.endsWith('.png'))).toBe(true);
    const bounds = await picture.boundingBox();
    expect(bounds!.width / bounds!.height).toBeCloseTo(16 / 9, 2);
    await picture.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(route.includes('index') ? 'article-embedded.png' : 'article-standalone.png'), animations: 'disabled' });
    const contrast = await new AxeBuilder({ page }).include('.breadcrumb').withTags(['wcag2aa']).analyze();
    expect(contrast.violations.map(rule => ({ id: rule.id, nodes: rule.nodes.map(node => node.failureSummary) }))).toEqual([]);
    page.off('request', collect);
  }
});

test('the first-year article discovers its font before CSS', async ({ page }) => {
  await page.goto('/blog/cosmos/first-year-software-engineer');
  const preload = page.locator('link[rel="preload"][as="font"]');
  await expect(preload).toHaveAttribute('href', '../../artifacts/fonts/SpecialElite-Regular.woff2');
  expect(await preload.evaluate(el => Boolean(el.compareDocumentPosition(document.querySelector('link[rel="stylesheet"]')!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => performance.getEntriesByType('resource').filter(r => r.name.endsWith('SpecialElite-Regular.woff2')).length)).toBe(1);
});
