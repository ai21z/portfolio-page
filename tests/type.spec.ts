import { expect, test, type Locator, type Page } from '@playwright/test';
import { stubVerification } from './helpers/contact';

// The type change: the reading face (Literata) and the data face (JetBrains Mono) beside Special Elite,
// self-hosted. Special Elite keeps the name, titles, headings and stamps. Labels never set below 12 px.

const family = (locator: Locator) => locator.evaluate((el) => getComputedStyle(el).fontFamily.replace(/["']/g, ''));
const size = (locator: Locator) => locator.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
const loaded = (page: Page, face: string) => page.evaluate(async (f) => { await document.fonts.ready; return document.fonts.check(`16px "${f}"`); }, face);

test('the fonts ship with their licences, and both article pages preload Special Elite', async ({ page, request }) => {
  for (const [file, holder] of [['OFL-Literata.txt', 'Literata Project Authors'], ['OFL-JetBrainsMono.txt', 'JetBrains Mono Project Authors']]) {
    const text = await (await request.get('/artifacts/fonts/' + file)).text();
    expect(text).toContain(holder);
    expect(text).toContain('SIL Open Font License, Version 1.1');
  }
  for (const font of ['literata-400.woff2', 'literata-600.woff2', 'literata-400-italic.woff2', 'jetbrains-mono-400.woff2']) {
    const response = await request.get('/artifacts/fonts/' + font);
    expect(response.status(), font).toBe(200);
    expect((await response.body()).length, font).toBeLessThan(25_000);
  }
  for (const slug of ['codex/fail-fast-learn-faster', 'cosmos/first-year-software-engineer']) {
    await page.goto('/blog/' + slug);
    const preloads = await page.locator('link[rel="preload"][as="font"]').evaluateAll((links) => links.map((l) => l.getAttribute('href')));
    // Literata is not preloaded: on a slow phone the preload took bandwidth from the hero and poster.
    expect(preloads.some((h) => h!.endsWith('/artifacts/fonts/literata-400.woff2')), slug).toBe(false);
    expect(preloads.some((h) => h!.endsWith('/artifacts/fonts/SpecialElite-Regular.woff2')), slug).toBe(true);
  }
});

test('posts read in Literata under Special Elite headings, in the page and in the reader, and load no mono', async ({ page }) => {
  const mono: string[] = [];
  page.on('request', (request) => { if (request.url().includes('jetbrains-mono')) mono.push(request.url()); });
  await page.goto('/blog/codex/fail-fast-learn-faster');
  const paragraph = page.locator('.article-content p').first();
  expect(await family(paragraph)).toMatch(/^Literata,/);
  expect(await family(page.locator('.article-title'))).toMatch(/^Special Elite/);
  // The post's labels stay in the reading face: the mono would be one more file before the first paint.
  expect(await family(page.locator('.article-meta'))).toMatch(/^Literata,/);
  expect(await loaded(page, 'Literata')).toBe(true);
  expect(mono).toEqual([]);

  await page.goto('/index.html#blog/codex/fail-fast-learn-faster');
  await expect(page.locator('#blog-article-content h1')).toBeVisible();
  expect(await family(page.locator('#blog-article-content .article-content p').first())).toMatch(/^Literata,/);
  // The reader's text is Literata, its section headings stay in the display face.
  expect(await family(page.locator('#blog-article-content .article-content h2').first())).toMatch(/^Special Elite/);
});

test('the Work note reads in Literata with its labels in JetBrains Mono, none under 12 px', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/index.html#work');
  await page.locator('.rail-node[data-id="adp"] .rail-dot-btn').hover();
  const note = page.locator('.work-note');
  await expect(note).toBeVisible();
  expect(await family(note.locator('.work-note-summary'))).toMatch(/^Literata,/);
  expect(await family(note.locator('.work-facts dd').first())).toMatch(/^Literata,/);
  for (const label of ['.work-note-kicker', '.work-note-meta', '.work-facts dt', '.work-note-cta']) {
    const el = note.locator(label).first();
    expect(await family(el), label).toMatch(/^JetBrains Mono,/);
    expect(await size(el), label).toBeGreaterThanOrEqual(12);
  }
});

test('the Graphics control and the ring captions take the data face, the info mark the reading face', async ({ page }) => {
  await stubVerification(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/index.html#about');
  const toggle = page.locator('.graphics-control__toggle');
  await expect(toggle).toBeVisible();
  expect(await family(toggle)).toMatch(/^JetBrains Mono,/);
  expect(await size(toggle)).toBeGreaterThanOrEqual(12);
  expect(await family(page.locator('.graphics-control__info'))).toMatch(/^Literata,/);
  expect(await family(page.locator('#about .ring-text--top'))).toMatch(/^JetBrains Mono,/);
});

test('the 404 page reads in Literata with its code and link in JetBrains Mono', async ({ page }) => {
  await page.goto('/no-such-page');
  expect(await family(page.locator('main p:not(.code)'))).toMatch(/^Literata,/);
  expect(await family(page.locator('.code'))).toMatch(/^JetBrains Mono,/);
  expect(await family(page.locator('main a'))).toMatch(/^JetBrains Mono,/);
  expect(await family(page.locator('h1'))).toMatch(/^Special Elite/);
});

test('the landing reads in Literata under the Special Elite name, with its labels and coordinates in the mono', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/index.html');
  await expect(page.locator('html')).toHaveClass(/js-ready/);
  expect(await family(page.locator('.name'))).toMatch(/^Special Elite/);
  for (const reading of ['.tape', '.selected-projects a', '.foot small']) expect(await family(page.locator(reading).first()), reading).toMatch(/^Literata,/);
  const label = page.locator('.network-node-label[data-section="about"]');
  await expect(label).toBeVisible();
  for (const data of [label, label.locator('.node-preview'), page.locator('.foot-coords')]) expect(await family(data)).toMatch(/^JetBrains Mono,/);
  for (const small of ['.foot small', '.foot-coords']) expect(await size(page.locator(small)), small).toBeGreaterThanOrEqual(12);
  await page.goto('/index.html#about');
  const link = page.locator('.section-nav-link').first();
  await expect(link).toBeVisible();
  expect(await family(link)).toMatch(/^JetBrains Mono,/);
  expect(await size(link)).toBeGreaterThanOrEqual(12);
});

// A phone shows no network labels or coordinates on the landing, so the bio's Literata is the only new file
// beside the portrait. Over HTTP/2, as served, it moved the simulated phone LCP by 0.08 s.
test('a phone landing fetches Literata for the bio and never the mono', async ({ page }) => {
  const fonts: string[] = [];
  page.on('request', (request) => { if (/\/artifacts\/fonts\/(literata|jetbrains)/.test(request.url())) fonts.push(request.url().split('/').pop()!.split('?')[0]); });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/index.html');
  await expect(page.locator('html')).toHaveClass(/js-ready/);
  await page.waitForTimeout(1500);
  expect(fonts).toEqual(['literata-400.woff2']);
});
