import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// The Field Notes search: Ctrl K or Command K reaches it, an empty field lists every note, words narrow the list and
// show where they were found, the dish sifts with the results, and Enter or a click reads the post.

async function openDish(page: Page) {
  // Headless browsers draw on a software renderer, which keeps the reduced fallback and no dish.
  await page.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext as any;
    HTMLCanvasElement.prototype.getContext = function (type: string, attrs: any) {
      if (type === 'webgl2') return orig.call(this, type, { ...(attrs || {}), failIfMajorPerformanceCaveat: false });
      return orig.call(this, type, attrs);
    };
  });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/index.html#blog');
  await expect(page.locator('#blog-network-canvas')).toHaveClass(/is-drawn/);
}

test('Ctrl K or Command K opens the search, and an empty field lists every note, newest first', async ({ page }) => {
  await openDish(page);
  const search = page.getByRole('searchbox', { name: 'Search the notes' });
  await expect(search).toBeVisible();
  await page.keyboard.press('ControlOrMeta+k');
  await expect(search).toBeFocused();
  await expect(search).toHaveValue('');
  const registry = await (await page.request.get('/blog/articles.json')).json();
  const total = Object.values(registry).flat().length;
  await expect(page.locator('.blog-search-hit')).toHaveCount(total);
  await expect(page.locator('.blog-search-summary')).toHaveText(`All ${total} notes, newest first`);
  const dates = await page.locator('.blog-search-meta').allTextContents();
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const stamps = dates.map(text => {
    const [day, month, year] = text.split('·').pop()!.trim().split(' ');
    return Number(year) * 10000 + (months.indexOf(month.toUpperCase()) + 1) * 100 + Number(day);
  });
  expect(stamps).toEqual([...stamps].sort((a, b) => b - a));
  // Nothing typed, nothing sifted: the dish keeps every nucleus lit.
  await expect(page.locator('#dish-nuclei')).not.toHaveClass(/is-sifting/);
});

test('words narrow the notes, mark where they were found, and sift the dish', async ({ page }) => {
  await openDish(page);
  await page.keyboard.press('ControlOrMeta+k');
  await page.keyboard.type('repetition guard');
  const hits = page.locator('.blog-search-hit');
  await expect(hits).toHaveCount(1);
  await expect(hits.first().locator('.blog-search-title')).toHaveText('Twelve Local Models, One Harness That Checks Them');
  await expect(hits.first().locator('.blog-search-snippet')).toContainText('the repetition guard');
  await expect(hits.first().locator('.blog-search-snippet mark', { hasText: 'guard' })).toHaveCount(1);
  await expect(page.locator('#dish-nuclei')).toHaveClass(/is-sifting/);
  await expect(page.locator('.dish-nucleus.is-match')).toHaveCount(1);
  await expect(page.locator('.dish-nucleus.is-match')).toHaveAttribute('data-article', 'twelve-local-models');

  // The result in focus names its nucleus, as a hover would.
  await page.keyboard.press('ArrowDown');
  await expect(hits.first()).toBeFocused();
  await expect(page.locator('.dish-nucleus[data-article="twelve-local-models"]')).toHaveClass(/is-named/);
  await expect(page.locator('.dish-nucleus[data-article="twelve-local-models"] .dish-nucleus-title')).toHaveCSS('opacity', '1');
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('searchbox', { name: 'Search the notes' })).toBeFocused();

  await page.keyboard.press('Control+A');
  await page.keyboard.type('xylophone quasar');
  await expect(hits).toHaveCount(0);
  await expect(page.locator('.blog-search-summary')).toContainText('Nothing matches');
  await expect(page.locator('#blog-search-status')).toHaveText('No note matches.');
});

test('Enter reads the first note in place, and Escape closes the results, then empties the field', async ({ page }) => {
  await openDish(page);
  const search = page.getByRole('searchbox', { name: 'Search the notes' });
  await search.click();
  await page.keyboard.type('dora');
  await expect(page.locator('.blog-search-hit')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('#blog-search-results')).toBeHidden();
  await expect(page.locator('#dish-nuclei')).not.toHaveClass(/is-sifting/);
  await expect(search).toHaveValue('dora');
  await expect(page).toHaveURL(/#blog$/);
  await page.keyboard.press('Escape');
  await expect(search).toHaveValue('');

  await page.keyboard.type('dora');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#blog\/codex\/fail-fast-learn-faster$/);
  await expect(page.locator('#blog-article-content .article-title')).toHaveText('Fail Fast, Learn Faster. Instinct, on Purpose');
  await expect(page.locator('#blog-article-content')).toBeFocused();
});

test('a result is a real link to its page, and a click reads it in place', async ({ page }) => {
  await openDish(page);
  await page.getByRole('searchbox', { name: 'Search the notes' }).click();
  const hit = page.locator('.blog-search-hit[data-article="the-work-test-cycle"]');
  await expect(hit).toHaveAttribute('href', '/blog/codex/the-work-test-cycle');
  await hit.click();
  await expect(page).toHaveURL(/#blog\/codex\/the-work-test-cycle$/);
});

test('the open search passes the automated accessibility audit', async ({ page }) => {
  await openDish(page);
  await page.keyboard.press('ControlOrMeta+k');
  await page.keyboard.type('java');
  await expect(page.locator('.blog-search-hit').first()).toBeVisible();
  const result = await new AxeBuilder({ page }).include('.blog-search')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(result.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map(node => node.target) }))).toEqual([]);
});

test('without scripts the search stays hidden', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();
  try {
    await page.goto(baseURL + '/index.html#blog');
    await expect(page.locator('.blog-search')).toBeHidden();
  } finally {
    await context.close();
  }
});

test('on a phone the search heads the culture cards in place of the plain post list', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/index.html#blog');
  await expect(page.locator('html')).toHaveClass(/js-ready/);
  const search = page.getByRole('searchbox', { name: 'Search the notes' });
  await expect(search).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Published writing' })).toBeHidden();
  const field = await search.boundingBox();
  const firstCard = await page.locator('.specimen-slide').first().boundingBox();
  expect(field!.y + field!.height).toBeLessThan(firstCard!.y);
  await expect(search).toHaveCSS('font-size', '16px');
  await search.click();
  await page.keyboard.type('kindness');
  await expect(page.locator('.blog-search-hit')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.locator('.blog-search-hit').click();
  await expect(page).toHaveURL(/#blog\/cosmos\/first-year-software-engineer$/);
});
