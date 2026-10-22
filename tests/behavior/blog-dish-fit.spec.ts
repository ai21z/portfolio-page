import { expect, test, type Page } from '@playwright/test';

// The Petri dish is fitted to the room between the Field Notes column and the section rail, so no
// rim label prints on a legend word or the rail, or loses the pointer to a legend link, and CRAFT
// and CODEX stay on screen. The network is drawn in the fitted dish. Where there is room the dish
// stays centred.

async function openBlog(page: Page, viewport: { width: number, height: number }) {
  await page.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext as any;
    HTMLCanvasElement.prototype.getContext = function (type: string, attrs: any) {
      if (type === 'webgl2') return orig.call(this, type, { ...(attrs || {}), failIfMajorPerformanceCaveat: false });
      return orig.call(this, type, attrs);
    };
    // Where the network is drawn, as the module reports it on every resize.
    addEventListener('blog:transform', (event: any) => { (window as any).__net = event.detail; });
  });
  await page.setViewportSize(viewport);
  await page.goto('/index.html#blog');
  await expect(page.locator('#blog')).toHaveClass(/active-section/);
  await expect(page.locator('#dish-labels text.arc-label')).toHaveCount(4);
  await expect(page.locator('.blog-memorandum')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  // The Field Notes fade in from 10px above: measure where they rest. The orb pulses never end.
  await page.evaluate(() => Promise.all(document.querySelector('.blog-memorandum')!.getAnimations({ subtree: true })
    .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
    .map((animation) => animation.finished.catch(() => undefined))));
}

async function rimLabels(page: Page) {
  return page.evaluate(() => {
    const words: DOMRect[] = [];
    const walker = document.createTreeWalker(document.querySelector('.blog-memorandum')!, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent || '';
      for (const match of text.matchAll(/\S+/g)) {
        const range = document.createRange();
        range.setStart(node, match.index!);
        range.setEnd(node, match.index! + match[0].length);
        words.push(...[...range.getClientRects()].filter((rect) => rect.width && rect.height));
      }
    }
    const rail = [...document.querySelectorAll('#blog .section-nav a')]
      .map((link) => link.getBoundingClientRect()).filter((rect) => rect.width && rect.height);
    const distance = (rects: DOMRect[], x: number, y: number) => Math.min(Infinity, ...rects.map((rect) => Math.hypot(
      Math.max(rect.left - x, 0, x - rect.right),
      Math.max(rect.top - y, 0, y - rect.bottom))));
    // A letter that falls off the end of its arc is not drawn, and its extent is empty.
    const dropped = (text: SVGTextElement) => {
      const str = text.textContent || '';
      let lost = '';
      for (let i = 0; i < text.getNumberOfChars(); i++) {
        const extent = text.getExtentOfChar(i);
        if (str[i]?.trim() && !extent.width && !extent.height) lost += str[i];
      }
      return lost;
    };
    const labels: Record<string, { letters: { x: number, y: number, gap: number, railGap: number, owner: string | null }[], centreX: number, dropped: string }> = {};
    for (const text of document.querySelectorAll<SVGTextElement>('#dish-labels text.arc-label')) {
      const hub = text.closest<SVGGElement>('.arc-btn')!.dataset.hub!;
      const ctm = text.getScreenCTM()!;
      const size = parseFloat(getComputedStyle(text).fontSize);
      const str = text.textContent || '';
      const letters = [];
      for (let i = 0; i < text.getNumberOfChars(); i++) {
        if (!str[i]?.trim()) continue;
        // The middle of the letter: halfway along its advance, a third of the type size above
        // the baseline, turned with the letter.
        const start = text.getStartPositionOfChar(i);
        const end = text.getEndPositionOfChar(i);
        const turn = text.getRotationOfChar(i) * Math.PI / 180;
        const ux = (start.x + end.x) / 2 + Math.sin(turn) * 0.35 * size;
        const uy = (start.y + end.y) / 2 - Math.cos(turn) * 0.35 * size;
        const x = ctm.a * ux + ctm.c * uy + ctm.e;
        const y = ctm.b * ux + ctm.d * uy + ctm.f;
        const owner = (document.elementFromPoint(x, y)?.closest('.arc-btn, .blog-memo-item') as HTMLElement | null);
        letters.push({ x, y, gap: distance(words, x, y), railGap: distance(rail, x, y), owner: owner ? (owner.dataset.hub || 'legend') : null });
      }
      const box = text.getBoundingClientRect();
      labels[hub] = { letters, centreX: box.left + box.width / 2, dropped: dropped(text) };
    }
    const caption = document.querySelector<SVGTextElement>('#dish .dish-tag-text');
    return {
      labels, rail: rail.length, words: words.length, width: innerWidth, height: innerHeight,
      captionDropped: caption ? dropped(caption) : 'no caption',
      net: (window as any).__net as { scale: number, offsetX: number, baseW: number },
    };
  });
}

for (const viewport of [
  { width: 1440, height: 900 }, { width: 1280, height: 720 }, { width: 1366, height: 768 },
  { width: 1280, height: 1024 }, { width: 1200, height: 900 }, { width: 1100, height: 700 },
]) {
  test(`the rim labels keep clear of the Field Notes and the rail (${viewport.width}x${viewport.height})`, async ({ page }) => {
    await openBlog(page, viewport);
    const { labels, words, rail, height, net, captionDropped } = await rimLabels(page);
    expect(words).toBeGreaterThan(30);
    expect(rail).toBe(5);
    for (const [hub, label] of Object.entries(labels)) {
      expect(label.dropped, `${hub} letters drawn`).toBe('');
      for (const letter of label.letters) {
        // Half a letter plus a gutter: the letter's middle stays well off every legend word and rail link.
        const at = `${hub} letter at ${Math.round(letter.x)},${Math.round(letter.y)}`;
        expect(letter.gap, at).toBeGreaterThan(30);
        expect(letter.railGap, `${at} to the rail`).toBeGreaterThan(30);
        expect(letter.owner, at).toBe(hub);
      }
    }
    expect(captionDropped, 'caption letters drawn').toBe('');
    // The letters' middles sit at least 16 px inside the window, so no cap is cut by its edge.
    expect(Math.min(...labels.craft.letters.map((letter) => letter.y))).toBeGreaterThan(16);
    expect(Math.max(...labels.codex.letters.map((letter) => letter.y))).toBeLessThan(height - 16);
    // The network is drawn in the middle of the fitted dish, under CRAFT.
    expect(Math.abs(net.offsetX + net.baseW * net.scale / 2 - labels.craft.centreX)).toBeLessThan(2);
  });
}

// A short or small window shrinks the dish. Its labels and caption grow their arcs to stay whole.
for (const viewport of [{ width: 1440, height: 400 }, { width: 1024, height: 768 }, { width: 901, height: 600 }]) {
  test(`every rim letter and the whole caption are drawn on a small dish (${viewport.width}x${viewport.height})`, async ({ page }) => {
    await openBlog(page, viewport);
    const { labels, captionDropped } = await rimLabels(page);
    for (const [hub, label] of Object.entries(labels)) expect(label.dropped, `${hub} letters drawn`).toBe('');
    expect(captionDropped, 'caption letters drawn').toBe('');
  });
}

test('the dish stays centred where there is room for it', async ({ page }) => {
  await openBlog(page, { width: 1920, height: 1080 });
  const { labels, width } = await rimLabels(page);
  expect(Math.abs(labels.craft.centreX - width / 2)).toBeLessThan(2);
  expect(Math.abs(labels.codex.centreX - width / 2)).toBeLessThan(2);
});

test('a window resized while a category is open still shows the rim labels back on the map', async ({ page }) => {
  await openBlog(page, { width: 1280, height: 720 });
  await page.locator('.blog-memo-item[data-hub="craft"]').click();
  await expect(page.locator('#blog')).toHaveAttribute('data-mode', 'category');
  await page.setViewportSize({ width: 1440, height: 900 });
  // The module rebuilds the dish 100 ms after the last resize.
  await expect.poll(() => page.locator('#dish').getAttribute('viewBox')).toBe('0 0 1440 900');
  await page.locator('#btn-map-category').click();
  await expect(page.locator('#blog')).toHaveAttribute('data-mode', 'map');
  await expect(page.locator('#dish-labels svg')).toHaveAttribute('viewBox', '0 0 1440 900');
  for (const label of await page.locator('#dish-labels text.arc-label').all()) {
    await expect.poll(async () => (await label.boundingBox())?.width ?? 0).toBeGreaterThan(20);
  }
});

test('a hub tooltip stays clear of CRAFT and the rail when the rail sits in the top corner', async ({ page }) => {
  await openBlog(page, { width: 901, height: 700 });
  for (const hub of ['craft', 'cosmos', 'codex', 'convergence']) {
    await page.locator(`.blog-memo-item[data-hub="${hub}"]`).hover();
    const tooltip = page.locator('.blog-hub-tooltip.visible');
    await expect(tooltip).toBeVisible();
    const tip = (await tooltip.boundingBox())!;
    const { labels } = await rimLabels(page);
    for (const letter of labels.craft.letters) {
      // Half a letter clear of the tooltip box.
      const gap = Math.hypot(Math.max(tip.x - letter.x, 0, letter.x - tip.x - tip.width), Math.max(tip.y - letter.y, 0, letter.y - tip.y - tip.height));
      expect(gap, `${hub} tooltip to CRAFT`).toBeGreaterThan(12);
    }
    for (const link of await page.locator('#blog .section-nav a').all()) {
      const box = (await link.boundingBox())!;
      const apart = box.x >= tip.x + tip.width || tip.x >= box.x + box.width || box.y >= tip.y + tip.height || tip.y >= box.y + box.height;
      expect(apart, `${hub} tooltip clear of the rail`).toBe(true);
    }
  }
  await page.mouse.move(0, 0);
});
