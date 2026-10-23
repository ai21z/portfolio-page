import { expect, test, type Page } from '@playwright/test';

// The orbit title around the About and Skills altars is set as four phrases, one in each gap between
// the paper cards. No card may cover any part of a letter, at rest or while a card lifts under the
// pointer. Where a gap is too short for its phrase, the phrase is left out rather than cut.

async function coveredLetters(page: Page, section: string) {
  return page.evaluate((id) => {
    const svg = document.querySelector(`#${id} svg.ring`)!;
    const covered: string[] = [];
    const shown: string[] = [];
    let letters = 0;
    for (const text of svg.querySelectorAll<SVGTextElement>('text.ring-text')) {
      // A phrase left out on a short window has no letters to cover.
      if (getComputedStyle(text).display === 'none') continue;
      // The addressable characters, as SVG collapses the white space in the markup.
      const str = (text.textContent || '').replace(/\s+/g, ' ').trim();
      shown.push(str);
      const ctm = text.getScreenCTM()!;
      const size = parseFloat(getComputedStyle(text).fontSize);
      const toScreen = (x: number, y: number) => [ctm.a * x + ctm.c * y + ctm.e, ctm.b * x + ctm.d * y + ctm.f];
      for (let i = 0; i < text.getNumberOfChars(); i++) {
        if (!str[i]?.trim()) continue;
        letters++;
        // The body of the letter, a 5 by 5 grid along its advance and up to 0.7 of the type size above
        // the baseline, turned with the letter. One point under a card is enough to fail.
        const start = text.getStartPositionOfChar(i);
        const end = text.getEndPositionOfChar(i);
        const turn = text.getRotationOfChar(i) * Math.PI / 180;
        let hits = 0;
        for (const along of [0.15, 0.325, 0.5, 0.675, 0.85]) {
          for (const up of [0, 0.175, 0.35, 0.525, 0.7]) {
            const [x, y] = toScreen(start.x + (end.x - start.x) * along + Math.sin(turn) * up * size,
              start.y + (end.y - start.y) * along - Math.cos(turn) * up * size);
            if (document.elementFromPoint(x, y)?.closest('.slab')) hits++;
          }
        }
        if (hits) covered.push(`${str[i]} of "${str}" (${hits}/25)`);
      }
    }
    return { shown, letters, covered };
  }, section);
}

async function settle(page: Page, section: string) {
  await page.evaluate((id) => Promise.all([...document.querySelectorAll(`#${id} .slab`)]
    .flatMap((el) => el.getAnimations({ subtree: true }))
    .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
    .map((animation) => animation.finished.catch(() => undefined))), section);
}

async function openSection(page: Page, viewport: { width: number, height: number }, section: string) {
  await page.setViewportSize(viewport);
  await page.goto(`/index.html#${section}`);
  await expect(page.locator(`#${section}`)).toHaveClass(/active-section/);
  await page.evaluate(() => document.fonts.ready);
  // The cards settle into place as the section opens.
  await settle(page, section);
}

// Maximized browser windows on common screens, plus a narrow window that has the section links
// beside the cards.
const viewports = [
  { width: 1920, height: 1080 }, { width: 1920, height: 953 }, { width: 1920, height: 830 }, { width: 1920, height: 700 },
  { width: 1440, height: 900 }, { width: 1366, height: 768 }, { width: 1366, height: 657 }, { width: 1280, height: 720 },
  { width: 1280, height: 689 }, { width: 1280, height: 610 }, { width: 960, height: 800 }
];

for (const viewport of viewports) {
  for (const section of ['about', 'skills']) {
    test(`no card covers the ${section} orbit title (${viewport.width}x${viewport.height})`, async ({ page }) => {
      await openSection(page, viewport, section);
      const rest = await coveredLetters(page, section);
      expect(rest.covered).toEqual([]);
      // At most one phrase gives way on a short window, and the name always stays.
      expect(rest.shown.length).toBeGreaterThanOrEqual(3);
      expect(rest.letters).toBeGreaterThan(40);
      if (section === 'about') expect(rest.shown).toContain('ARIS ZOUNARAKIS');
    });
  }
}

const hoverViewports = [
  { width: 1920, height: 953 }, { width: 1440, height: 900 }, { width: 1366, height: 768 },
  { width: 1366, height: 657 }, { width: 1280, height: 720 }, { width: 960, height: 800 }
];

for (const viewport of hoverViewports) {
  for (const section of ['about', 'skills']) {
    test(`a card lifting under the pointer covers no letter of the ${section} orbit title (${viewport.width}x${viewport.height})`, async ({ page }) => {
      await openSection(page, viewport, section);
      const cards = page.locator(`#${section} .slab`);
      for (let index = 0; index < await cards.count(); index++) {
        await cards.nth(index).hover();
        // The card lifts on a short transition, and the one hovered before it sinks back. Measure
        // where both rest.
        await settle(page, section);
        expect((await coveredLetters(page, section)).covered, `card ${index}`).toEqual([]);
      }
    });
  }
}

// Below 1025 px the section links sit at the top right, beside the right column of cards.
for (const section of ['about', 'skills']) {
  test(`no section link lies over a ${section} card (960x800)`, async ({ page }) => {
    await openSection(page, { width: 960, height: 800 }, section);
    const links = await page.evaluate((id) => {
      const over: string[] = [];
      let seen = 0;
      for (const link of document.querySelectorAll<HTMLElement>(`#${id} .section-nav a`)) {
        const box = link.getBoundingClientRect();
        if (!box.width || !box.height) continue;
        seen++;
        for (const across of [0.05, 0.2, 0.35, 0.5, 0.65, 0.8, 0.95]) {
          for (const down of [0.2, 0.5, 0.8]) {
            const stack = document.elementsFromPoint(box.left + box.width * across, box.top + box.height * down);
            if (stack.some((el) => el.classList.contains('slab') && el.closest(`#${id}`))) over.push(link.textContent!.trim());
          }
        }
      }
      return { seen, over: [...new Set(over)] };
    }, section);
    expect(links.seen).toBeGreaterThan(0);
    expect(links.over).toEqual([]);
  });
}

test('the orbit title recedes while a card is open, so no cut phrase shows around it', async ({ page }) => {
  await openSection(page, { width: 1440, height: 900 }, 'about');
  const card = page.locator('#about .slab').first();
  await card.focus();
  await card.press('Enter');
  await expect(page.locator('.paper-open')).toBeVisible();
  await expect.poll(() => page.locator('#about svg.ring').evaluate((el) => Number(getComputedStyle(el).opacity))).toBeLessThan(0.3);
});
