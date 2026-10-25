import { expect, test, type Locator, type Page } from '@playwright/test';
import { stubVerification } from './helpers/contact';

// The type change: the reading face (Literata) and the data face (JetBrains Mono) beside Special Elite,
// self-hosted. Special Elite keeps the name, titles, headings and stamps. Labels never set below 12 px.

const family = (locator: Locator) => locator.evaluate((el) => getComputedStyle(el).fontFamily.replace(/["']/g, ''));
const size = (locator: Locator) => locator.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
const loaded = (page: Page, face: string) => page.evaluate(async (f) => { await document.fonts.ready; return document.fonts.check(`16px "${f}"`); }, face);

// A trace's page snapshots lay out the hidden sections and so fetch faces a browser never fetches for
// content-visibility: hidden, which would hide what a phone landing really loads. No traces in this file.
test.use({ trace: 'off' });

test('the fonts ship with their licences, and both article pages preload Special Elite', async ({ page, request }) => {
  for (const [file, holder] of [['OFL-Literata.txt', 'Literata Project Authors'], ['OFL-JetBrainsMono.txt', 'JetBrains Mono Project Authors']]) {
    const text = await (await request.get('/artifacts/fonts/' + file)).text();
    expect(text).toContain(holder);
    expect(text).toContain('SIL Open Font License, Version 1.1');
  }
  for (const font of ['literata-400.woff2', 'literata-600.woff2', 'literata-400-italic.woff2', 'jetbrains-mono-400.woff2', 'jetbrains-mono-600.woff2']) {
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

test('the Graphics control, its info mark and the ring captions take the data face', async ({ page }) => {
  await stubVerification(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/index.html#about');
  const toggle = page.locator('.graphics-control__toggle');
  await expect(toggle).toBeVisible();
  expect(await family(toggle)).toMatch(/^JetBrains Mono,/);
  expect(await size(toggle)).toBeGreaterThanOrEqual(12);
  expect(await family(page.locator('.graphics-control__info'))).toMatch(/^JetBrains Mono,/);
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
// beside the portrait. Over HTTP/2, as served, it moved the simulated phone LCP by 0.08 s. The closed
// sections' faces come once the page has loaded, before a visitor opens one.
test('a phone landing fetches only the bio\'s Literata until it has loaded, then the rest in the background', async ({ page }) => {
  const fonts: string[] = [];
  page.on('request', (request) => { if (/\/artifacts\/fonts\/(literata|jetbrains)/.test(request.url())) fonts.push(request.url().split('/').pop()!.split('?')[0]); });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/index.html', { waitUntil: 'load' });
  await expect(page.locator('html')).toHaveClass(/js-ready/);
  await page.waitForTimeout(1000);
  expect(fonts).toEqual(['literata-400.woff2']);
  await expect.poll(() => [...fonts].sort(), { timeout: 4000 })
    .toEqual(['jetbrains-mono-400.woff2', 'literata-400-italic.woff2', 'literata-400.woff2', 'literata-600.woff2']);
});

// Card text sat 2 px from the binding holes, so the holes read as touching the first letter of each line.
test('cards read in Literata under Special Elite headings, with keys and tags in the mono, clear of the holes', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const section of ['about', 'skills']) {
    await page.goto(`/index.html#${section}`);
    const cards = page.locator(`#${section} .slab`);
    await expect(cards.first()).toBeVisible();
    for (let index = 0; index < await cards.count(); index++) {
      const card = cards.nth(index);
      expect(await family(card.locator('h2'))).toMatch(/^Special Elite/);
      const clearance = await card.evaluate((slab) => {
        const holes = getComputedStyle(slab, '::before');
        const tile = parseFloat(holes.backgroundSize);
        // The hole's dark disc reaches 0.5 of its tile's farthest corner from the tile's middle.
        return parseFloat(getComputedStyle(slab).paddingLeft) - (parseFloat(holes.left) + tile / 2 + 0.5 * tile * Math.SQRT1_2);
      });
      expect(clearance, `${section} card ${index}`).toBeGreaterThanOrEqual(6);
    }
  }
  await page.goto('/index.html#about');
  expect(await family(page.locator('.slab-about p'))).toMatch(/^Literata,/);
  expect(await family(page.locator('.about-values span').first())).toMatch(/^JetBrains Mono,/);
  expect(await family(page.locator('.about-values span').nth(1))).toMatch(/^Literata,/);
  // The values start on one column, measured in the card's own frame since the card is turned.
  const starts = await page.locator('.about-values li span:nth-child(2)').evaluateAll((spans) => spans.map((s) => (s as HTMLElement).offsetLeft));
  expect(new Set(starts).size).toBe(1);
  await page.goto('/index.html#skills');
  expect(await family(page.locator('.slab-systems .tech-stack li').first())).toMatch(/^JetBrains Mono,/);
});

test('stacked cards on a phone set nothing under 12 px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const section of ['about', 'skills']) {
    await page.goto(`/index.html#${section}`);
    await expect(page.locator(`#${section} .slab`).first()).toBeVisible();
    const sizes = await page.locator(`#${section} .slab`).evaluateAll((slabs) => slabs.flatMap((slab) =>
      [...slab.querySelectorAll('h2, h3, p, li, span')].filter((el) => getComputedStyle(el).display !== 'none')
        .map((el) => parseFloat(getComputedStyle(el).fontSize))));
    expect(Math.min(...sizes), section).toBeGreaterThanOrEqual(12);
  }
});

// Jurors praised the typewriter notebook, so its labels, writing and Send keep Special Elite.
test('the Contact notebook keeps the typewriter, with the quote in Literata and the address and counter in the mono', async ({ page }) => {
  await stubVerification(page);
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto('/index.html#contact');
    await expect(page.locator('.notebook-header')).toBeVisible();
    for (const typed of ['.notebook-header', '.notebook-label', '#name', '.notebook-submit']) expect(await family(page.locator(typed).first()), typed).toMatch(/^Special Elite/);
    expect(await family(page.locator('.notebook-quote'))).toMatch(/^Literata,/);
    for (const data of ['.contact-email', '.char-count']) expect(await family(page.locator(data)), data).toMatch(/^JetBrains Mono,/);
    expect(await size(page.locator('.char-count'))).toBeGreaterThanOrEqual(12);
  }
});
