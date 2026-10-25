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

// A desktop portrait is 380 to 520 px wide, so it takes the file for its slot instead of the 1024 px one
// (427 KB), and the preload asks for the same file, so the portrait is fetched once.
for (const device of [
  { width: 1440, height: 900, dpr: 2, source: '-800.webp' },
  { width: 1440, height: 900, dpr: 1, source: '-480.webp' },
  { width: 1920, height: 1080, dpr: 1, source: '-480.webp' },
  { width: 2560, height: 1440, dpr: 2, source: 'myOminousGreenPortrait.webp' }
]) {
  test(`desktop portrait takes the ${device.source} file at ${device.width}x${device.height}@${device.dpr}x`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ viewport: { width: device.width, height: device.height }, deviceScaleFactor: device.dpr, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const images: string[] = [];
    page.on('request', (request) => { if (request.url().includes('myOminousGreenPortrait')) images.push(request.url()); });
    try {
      await page.goto(baseURL + '/index.html');
      const portrait = page.locator('.portrait');
      await expect.poll(() => portrait.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
      expect(images).toHaveLength(1);
      expect(images[0].split('/').pop()!.split('?')[0].endsWith(device.source), images[0]).toBe(true);
    } finally {
      await context.close();
    }
  });
}

// The particles that travel to a hovered node are the engraving's brightest specks (the dust), which the
// smaller photo files average away: the full file holds about 265 at the sampling grid, the 800 px one 46 and
// the 480 px one none, so the stream had nothing to send. The particles sample the full file, fetched after
// load, so the photo stays the small one. The stream itself needs the Rich tier, which the test browsers'
// software renderers do not reach, so this checks what it sends.
test('the portrait particles sample the full file after load and after a reload, so the dust that travels to a hovered node is there', async ({ browser, baseURL, browserName }) => {
  // Firefox runs no portrait particles, and Safari's lighter budget samples fewer and does not stream on Auto.
  test.skip(browserName !== 'chromium', 'Only Chromium runs the full particle budget here');
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  try {
    await page.goto(baseURL + '/index.html');
    await page.waitForFunction(() => (window as any).__portraitParticleStats?.particleCount > 0, null, { timeout: 20_000 });
    const requests = await page.evaluate(() => {
      const load = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
      return performance.getEntriesByType('resource').filter((entry) => entry.name.includes('myOminousGreenPortrait'))
        .map((entry) => ({ file: entry.name.split('/').pop()!.split('?')[0], beforeLoad: entry.startTime < load.loadEventStart }));
    });
    expect(requests.filter((r) => r.beforeLoad).map((r) => r.file)).toEqual(['myOminousGreenPortrait-480.webp']);
    expect(requests.filter((r) => !r.beforeLoad).map((r) => r.file)).toEqual(['myOminousGreenPortrait.webp']);
    expect(await page.evaluate(() => (window as any).__portraitParticleStats.dustCount)).toBeGreaterThan(150);
    // A reload draws the photo from the cached full file, and a srcset photo reports its natural size in its
    // slot's pixels (379), so the particles must still sample their own copy of the file.
    await page.reload();
    await page.waitForFunction(() => (window as any).__portraitParticleStats?.particleCount > 0, null, { timeout: 20_000 });
    expect(await page.evaluate(() => (window as any).__portraitParticleStats.dustCount), 'after a reload').toBeGreaterThan(150);
  } finally {
    await context.close();
  }
});
