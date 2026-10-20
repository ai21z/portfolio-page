import { expect, test, type Page } from '@playwright/test';

// The wheel scrolls whatever can scroll under the pointer. A gesture that starts with nothing to
// scroll, and that nothing else handles, steps to the previous or next section, one per gesture.

const GESTURE_GAP_MS = 300;
const COOLDOWN_MS = 750;
const POINTER = { x: 700, y: 450 };

async function open(page: Page, hash: string) {
  await page.goto(`/index.html${hash}`);
  await expect(page.locator('html')).toHaveClass(/js-ready/);
  const section = hash ? hash.slice(1) : 'main';
  await expect(page.locator(`#${section}`)).toHaveClass(/active-section/);
  // Let the arrival settle so a gesture starts outside the step cooldown.
  await page.waitForTimeout(COOLDOWN_MS);
}

// One gesture: wheel events dispatched in one task on whatever is under the pointer, so neither a
// slow browser driver nor a busy page can split it. Synthetic events do not scroll, so a test that
// needs a scrolled box sets its scroll position directly.
async function gesture(page: Page, deltaY: number, events = 4, options: { ctrlKey?: boolean, x?: number, y?: number } = {}) {
  await page.evaluate(({ dy, n, x, y, ctrlKey }) => {
    const target = document.elementFromPoint(x, y) || document.body;
    for (let i = 0; i < n; i++) {
      target.dispatchEvent(new WheelEvent('wheel', { deltaY: dy, deltaMode: 0, bubbles: true, cancelable: true, clientX: x, clientY: y, ctrlKey }));
    }
  }, { dy: deltaY, n: events, x: options.x ?? POINTER.x, y: options.y ?? POINTER.y, ctrlKey: Boolean(options.ctrlKey) });
  await page.waitForTimeout(GESTURE_GAP_MS);
}

const active = (page: Page) => page.evaluate(() => document.querySelector('.stage.active-section')?.getAttribute('data-section'));

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
});

test('one wheel gesture moves one section, forward and back', async ({ page }) => {
  await open(page, '#about');
  await gesture(page, 120, 12);
  expect(await active(page)).toBe('skills');
  await expect(page).toHaveURL(/#skills$/);

  await page.waitForTimeout(COOLDOWN_MS);
  await gesture(page, -120);
  expect(await active(page)).toBe('about');
});

test('a section that can still scroll keeps the gesture, and the edge passes it on', async ({ page }) => {
  await open(page, '');
  const overflow = await page.locator('#main').evaluate((el) => el.scrollHeight - el.clientHeight);
  test.skip(overflow < 40, 'The landing fits this viewport, so there is nothing to scroll first.');

  await page.locator('#main').evaluate((el) => el.scrollTo({ top: 0, behavior: 'instant' }));
  await gesture(page, 120);
  expect(await active(page)).toBe('intro');

  await page.locator('#main').evaluate((el) => el.scrollTo({ top: el.scrollHeight, behavior: 'instant' }));
  await gesture(page, 120);
  expect(await active(page)).toBe('about');
});

test('the last section stays put going down, and the first going up', async ({ page }) => {
  await open(page, '#contact');
  await page.evaluate(() => document.querySelectorAll('html, body, #contact').forEach((el) => el.scrollTo({ top: el.scrollHeight, behavior: 'instant' })));
  await gesture(page, 120);
  expect(await active(page)).toBe('contact');

  await open(page, '');
  await page.locator('#main').evaluate((el) => el.scrollTo({ top: 0, behavior: 'instant' }));
  await gesture(page, -120);
  expect(await active(page)).toBe('intro');
});

test('the wheel does not move on while a card is open or while pinch zooming', async ({ page }) => {
  await open(page, '#about');
  await gesture(page, 120, 4, { ctrlKey: true });
  expect(await active(page)).toBe('about');

  const card = page.locator('#about .paper').first();
  await card.focus();
  await card.press('Enter');
  await expect(page.locator('.paper-open')).toBeVisible();
  await gesture(page, 120);
  expect(await active(page)).toBe('about');
});

test('on Work the wheel scrolls the timeline from anywhere, and moves on only past its end', async ({ page }) => {
  await open(page, '#work');
  const rail = page.locator('#work .work-rail-scroll');
  await expect(rail).toBeVisible();
  await rail.evaluate((el) => el.scrollTo({ top: 0, behavior: 'instant' }));
  // Above the globe, away from the timeline itself and from the fallback index headless browsers show.
  const away = { x: 1000, y: 150 };

  await gesture(page, 120, 4, away);
  expect(await active(page)).toBe('work');
  await expect.poll(() => rail.evaluate((el) => el.scrollTop)).toBeGreaterThan(100);

  await rail.evaluate((el) => el.scrollTo({ top: el.scrollHeight, behavior: 'instant' }));
  await page.waitForTimeout(COOLDOWN_MS);
  await gesture(page, 120, 4, away);
  expect(await active(page)).toBe('contact');
});

test('on Blog the dish zoom keeps its gesture, and wheel down at full view moves on to Work', async ({ page }) => {
  test.setTimeout(60_000);
  await open(page, '#blog');
  // The dish is ready once it has drawn a frame. Headless browsers without a usable GPU show the
  // reduced-graphics fallback instead, and then there is no zoom to hand over.
  await expect.poll(async () => (await page.locator('#blog-network-canvas.is-drawn').count())
    + (await page.locator('#blog .webgl-fallback-visible').count()), { timeout: 20_000 }).toBeGreaterThan(0);
  test.skip(await page.locator('#blog .webgl-fallback-visible').count() > 0, 'The dish fell back to reduced graphics in this browser.');

  // Zooming in consumes the whole gesture, even past the zoom limit.
  await gesture(page, -120, 10);
  expect(await active(page)).toBe('blog');

  // Zooming back out to the full view also stays on Blog, then a fresh gesture moves on.
  await gesture(page, 120, 10);
  expect(await active(page)).toBe('blog');
  await page.waitForTimeout(COOLDOWN_MS);
  await gesture(page, 120);
  expect(await active(page)).toBe('work');
});

test('a real wheel scrolls the landing to its end before a fresh gesture moves on', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Real wheel timing through the driver is only tight enough in Chromium.');
  await open(page, '');
  const overflow = await page.locator('#main').evaluate((el) => el.scrollHeight - el.clientHeight);
  test.skip(overflow < 40, 'The landing fits this viewport, so there is nothing to scroll first.');
  await page.mouse.move(POINTER.x, POINTER.y);
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, 120);
  await page.waitForTimeout(GESTURE_GAP_MS);
  expect(await active(page)).toBe('intro');
  await expect.poll(() => page.locator('#main').evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThanOrEqual(1);

  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(GESTURE_GAP_MS);
  expect(await active(page)).toBe('about');
});
