import { expect, test, type Page } from '@playwright/test';

// The Petri dish is fitted to the room between the Field Notes column and the section rail, so no
// rim label prints on a legend word or loses the pointer to a legend link, and CRAFT and CODEX stay
// on screen. Where there is room the dish stays centred.

async function openBlog(page: Page, viewport: { width: number, height: number }) {
  await page.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext as any;
    HTMLCanvasElement.prototype.getContext = function (type: string, attrs: any) {
      if (type === 'webgl2') return orig.call(this, type, { ...(attrs || {}), failIfMajorPerformanceCaveat: false });
      return orig.call(this, type, attrs);
    };
  });
  await page.setViewportSize(viewport);
  await page.goto('/index.html#blog');
  await expect(page.locator('#blog')).toHaveClass(/active-section/);
  await expect(page.locator('#dish-labels text.arc-label')).toHaveCount(4);
  await expect(page.locator('.blog-memorandum')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  // The labels are rebuilt on the debounced resize that follows the fonts and the section fade.
  await page.waitForTimeout(600);
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
    const labels: Record<string, { letters: { x: number, y: number, gap: number, owner: string | null }[], centreX: number }> = {};
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
        const gap = Math.min(...words.map((rect) => Math.hypot(
          Math.max(rect.left - x, 0, x - rect.right),
          Math.max(rect.top - y, 0, y - rect.bottom))));
        const owner = (document.elementFromPoint(x, y)?.closest('.arc-btn, .blog-memo-item') as HTMLElement | null);
        letters.push({ x, y, gap, owner: owner ? (owner.dataset.hub || 'legend') : null });
      }
      const box = text.getBoundingClientRect();
      labels[hub] = { letters, centreX: box.left + box.width / 2 };
    }
    return { labels, words: words.length, width: innerWidth, height: innerHeight };
  });
}

for (const viewport of [
  { width: 1440, height: 900 }, { width: 1280, height: 720 }, { width: 1366, height: 768 },
  { width: 1280, height: 1024 }, { width: 1200, height: 900 }, { width: 1100, height: 700 },
]) {
  test(`the rim labels keep clear of the Field Notes (${viewport.width}x${viewport.height})`, async ({ page }) => {
    await openBlog(page, viewport);
    const { labels, words, height } = await rimLabels(page);
    expect(words).toBeGreaterThan(30);
    for (const [hub, label] of Object.entries(labels)) {
      for (const letter of label.letters) {
        // Half a letter plus a gutter: the letter's middle stays well off every legend word.
        expect(letter.gap, `${hub} letter at ${Math.round(letter.x)},${Math.round(letter.y)}`).toBeGreaterThan(30);
        expect(letter.owner, `${hub} letter at ${Math.round(letter.x)},${Math.round(letter.y)}`).toBe(hub);
      }
    }
    // The letters' middles sit at least 16 px inside the window, so no cap is cut by its edge.
    expect(Math.min(...labels.craft.letters.map((letter) => letter.y))).toBeGreaterThan(16);
    expect(Math.max(...labels.codex.letters.map((letter) => letter.y))).toBeLessThan(height - 16);
  });
}

test('the dish stays centred where there is room for it', async ({ page }) => {
  await openBlog(page, { width: 1920, height: 1080 });
  const { labels, width } = await rimLabels(page);
  expect(Math.abs(labels.craft.centreX - width / 2)).toBeLessThan(2);
  expect(Math.abs(labels.codex.centreX - width / 2)).toBeLessThan(2);
});
