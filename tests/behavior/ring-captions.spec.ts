import { expect, test, type Page } from '@playwright/test';

// The orbit title around the About and Skills altars is set as four phrases, one in each gap between
// the paper cards. No card may cover a letter, at rest or while a card lifts under the pointer.

async function coveredLetters(page: Page, section: string) {
  return page.evaluate((id) => {
    const svg = document.querySelector(`#${id} svg.ring`)!;
    const covered: string[] = [];
    let letters = 0;
    for (const text of svg.querySelectorAll<SVGTextElement>('text.ring-text')) {
      const str = text.textContent || '';
      const ctm = text.getScreenCTM()!;
      const size = parseFloat(getComputedStyle(text).fontSize);
      const toScreen = (x: number, y: number) => [ctm.a * x + ctm.c * y + ctm.e, ctm.b * x + ctm.d * y + ctm.f];
      for (let i = 0; i < text.getNumberOfChars(); i++) {
        if (!str[i]?.trim()) continue;
        letters++;
        // The middle of the letter: halfway along its advance, a third of the type size above the
        // baseline, turned with the letter.
        const start = text.getStartPositionOfChar(i);
        const end = text.getEndPositionOfChar(i);
        const turn = text.getRotationOfChar(i) * Math.PI / 180;
        const [x, y] = toScreen((start.x + end.x) / 2 + Math.sin(turn) * 0.35 * size, (start.y + end.y) / 2 - Math.cos(turn) * 0.35 * size);
        if (document.elementFromPoint(x, y)?.closest('.slab')) covered.push(`${str[i]} of "${str.trim()}"`);
      }
    }
    return { letters, covered };
  }, section);
}

async function openSection(page: Page, viewport: { width: number, height: number }, section: string) {
  await page.setViewportSize(viewport);
  await page.goto(`/index.html#${section}`);
  await expect(page.locator(`#${section}`)).toHaveClass(/active-section/);
  await page.evaluate(() => document.fonts.ready);
  // The cards settle into place as the section opens.
  await page.evaluate((id) => Promise.all([...document.querySelectorAll(`#${id} .slab`)]
    .flatMap((el) => el.getAnimations({ subtree: true }))
    .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
    .map((animation) => animation.finished.catch(() => undefined))), section);
}

for (const viewport of [{ width: 1920, height: 1080 }, { width: 1440, height: 900 }, { width: 1366, height: 768 }, { width: 1280, height: 720 }]) {
  for (const section of ['about', 'skills']) {
    test(`no card covers the ${section} orbit title (${viewport.width}x${viewport.height})`, async ({ page }) => {
      await openSection(page, viewport, section);
      const rest = await coveredLetters(page, section);
      expect(rest.letters).toBeGreaterThan(50);
      expect(rest.covered).toEqual([]);
    });
  }
}

test('a card lifting under the pointer covers no letter of the orbit title', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Hover geometry is shared; one engine is enough.');
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }]) {
    for (const section of ['about', 'skills']) {
      await openSection(page, viewport, section);
      const cards = page.locator(`#${section} .slab`);
      for (let index = 0; index < await cards.count(); index++) {
        await cards.nth(index).hover();
        await page.waitForTimeout(400);
        expect((await coveredLetters(page, section)).covered, `${section} ${viewport.width}x${viewport.height} card ${index}`).toEqual([]);
      }
      await page.mouse.move(0, 0);
    }
  }
});

test('the orbit title recedes while a card is open, so no cut phrase shows around it', async ({ page }) => {
  await openSection(page, { width: 1440, height: 900 }, 'about');
  const card = page.locator('#about .slab').first();
  await card.focus();
  await card.press('Enter');
  await expect(page.locator('.paper-open')).toBeVisible();
  await expect.poll(() => page.locator('#about svg.ring').evaluate((el) => Number(getComputedStyle(el).opacity))).toBeLessThan(0.3);
});
