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

// One gesture: wheel events dispatched in one task, each on whatever is under the pointer at that
// moment, so neither a slow browser driver nor a busy page can split it. Synthetic events do not
// scroll, so a test that needs a scrolled box positions it with scrollBox.
async function gesture(page: Page, deltaY: number, events = 4, options: { ctrlKey?: boolean, x?: number, y?: number } = {}) {
  await page.evaluate(({ dy, n, x, y, ctrlKey }) => {
    for (let i = 0; i < n; i++) {
      const target = document.elementFromPoint(x, y) || document.body;
      target.dispatchEvent(new WheelEvent('wheel', { deltaY: dy, deltaMode: 0, bubbles: true, cancelable: true, clientX: x, clientY: y, ctrlKey }));
    }
  }, { dy: deltaY, n: events, x: options.x ?? POINTER.x, y: options.y ?? POINTER.y, ctrlKey: Boolean(options.ctrlKey) });
  await page.waitForTimeout(GESTURE_GAP_MS);
}

// Positions a box and waits two frames, so its scroll event has fired before the next wheel.
async function scrollBox(page: Page, selector: string, where: 'top' | 'end') {
  await page.locator(selector).first().evaluate((el, end) => {
    el.scrollTo({ top: end ? el.scrollHeight : 0, behavior: 'instant' });
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }, where === 'end');
}

const active = (page: Page) => page.evaluate(() => document.querySelector('.stage.active-section')?.getAttribute('data-section'));

async function openDish(page: Page) {
  await open(page, '#blog');
  // The dish is ready once it has drawn a frame. Headless browsers without a usable GPU show the
  // reduced-graphics fallback instead, and then there is no zoom to hand over.
  await expect.poll(async () => (await page.locator('#blog-network-canvas.is-drawn').count())
    + (await page.locator('#blog .webgl-fallback-visible').count()), { timeout: 20_000 }).toBeGreaterThan(0);
  return (await page.locator('#blog .webgl-fallback-visible').count()) === 0;
}

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

test('one notch reported in lines, as Firefox can, steps like a notch in pixels', async ({ page }) => {
  await open(page, '#about');
  await page.evaluate(() => {
    const target = document.elementFromPoint(700, 450) || document.body;
    target.dispatchEvent(new WheelEvent('wheel', { deltaY: 3, deltaMode: WheelEvent.DOM_DELTA_LINE, bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(GESTURE_GAP_MS);
  expect(await active(page)).toBe('skills');
});

test('a slow notch lighter than the step distance still moves on once the gesture ends', async ({ page }) => {
  await open(page, '#about');
  // A slow notch on macOS Chrome arrives as about 4 px, and one at 200% browser zoom as 50 px.
  await gesture(page, 4, 1);
  expect(await active(page)).toBe('skills');
});

test('reversing the wheel steps the new way, never the way the gesture started', async ({ page }) => {
  await open(page, '#about');
  await gesture(page, 120, 1);
  expect(await active(page)).toBe('skills');
  // One more notch down during the cooldown, then notches back up across its end, 150 ms apart.
  await page.evaluate(async () => {
    const send = (dy: number) => (document.elementFromPoint(700, 450) || document.body)
      .dispatchEvent(new WheelEvent('wheel', { deltaY: dy, bubbles: true, cancelable: true }));
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    await wait(10);
    send(120);
    for (let i = 0; i < 4; i++) { await wait(150); send(-120); }
  });
  await page.waitForTimeout(GESTURE_GAP_MS);
  expect(await active(page)).toBe('about');
});

test('a section that can still scroll keeps the gesture, and the edge passes it on', async ({ page }) => {
  await open(page, '');
  const overflow = await page.locator('#main').evaluate((el) => el.scrollHeight - el.clientHeight);
  test.skip(overflow < 40, 'The landing fits this viewport, so there is nothing to scroll first.');

  await scrollBox(page, '#main', 'top');
  await gesture(page, 120);
  expect(await active(page)).toBe('intro');

  await scrollBox(page, '#main', 'end');
  await gesture(page, 120);
  expect(await active(page)).toBe('about');
});

test('a wheel that carried the landing to its end in the same frame stays on the landing', async ({ page }) => {
  await open(page, '');
  const overflow = await page.locator('#main').evaluate((el) => el.scrollHeight - el.clientHeight);
  test.skip(overflow < 40, 'The landing fits this viewport, so there is nothing to scroll first.');
  await scrollBox(page, '#main', 'top');
  // An unanimated wheel scroll lands before the page's listener runs: the box is at its end, but
  // its scroll event has not fired yet.
  await page.evaluate(() => {
    const main = document.getElementById('main')!;
    main.scrollTo({ top: main.scrollHeight, behavior: 'instant' });
    (document.elementFromPoint(700, 450) || document.body)
      .dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(GESTURE_GAP_MS);
  expect(await active(page)).toBe('intro');
});

test('over the landing nav the wheel scrolls the landing before it moves on', async ({ page }) => {
  await open(page, '');
  const overflow = await page.locator('#main').evaluate((el) => el.scrollHeight - el.clientHeight);
  test.skip(overflow < 40, 'The landing fits this viewport, so there is nothing to scroll first.');
  await scrollBox(page, '#main', 'top');
  const label = await page.locator('.network-node-label').first().boundingBox();
  test.skip(!label, 'The network labels are not laid out in this viewport.');
  const at = { x: label!.x + label!.width / 2, y: label!.y + label!.height / 2 };
  const outside = await page.evaluate(({ x, y }) => !document.getElementById('main')!.contains(document.elementFromPoint(x, y)), at);
  test.skip(!outside, 'The label is not above the landing here.');

  await gesture(page, 120, 2, at);
  expect(await active(page)).toBe('intro');
  await expect.poll(() => page.locator('#main').evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
});

test('the last section stays put going down, and the first going up', async ({ page }) => {
  await open(page, '#contact');
  await page.evaluate(() => document.querySelectorAll('html, body, #contact').forEach((el) => el.scrollTo({ top: el.scrollHeight, behavior: 'instant' })));
  await page.waitForTimeout(100);
  await gesture(page, 120);
  expect(await active(page)).toBe('contact');

  await open(page, '');
  await scrollBox(page, '#main', 'top');
  await gesture(page, -120);
  expect(await active(page)).toBe('intro');
});

test('the wheel does not move on while a card, a panel or a pinch is in progress', async ({ page }) => {
  await open(page, '#about');
  await gesture(page, 120, 4, { ctrlKey: true });
  expect(await active(page)).toBe('about');

  await page.locator('.graphics-control__info').click();
  await expect(page.locator('#graphics-help-panel')).toBeVisible();
  await gesture(page, 120);
  expect(await active(page)).toBe('about');
  await expect(page.locator('#graphics-help-panel')).toBeVisible();
  await page.keyboard.press('Escape');

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
  await scrollBox(page, '#work .work-rail-scroll', 'top');
  // Above the globe, away from the timeline itself and from the fallback index headless browsers show.
  const away = { x: 1000, y: 150 };

  await gesture(page, 120, 4, away);
  expect(await active(page)).toBe('work');
  await expect.poll(() => rail.evaluate((el) => el.scrollTop)).toBeGreaterThan(100);

  await scrollBox(page, '#work .work-rail-scroll', 'end');
  await page.waitForTimeout(COOLDOWN_MS);
  await gesture(page, 120, 4, away);
  expect(await active(page)).toBe('contact');
});

test('on Blog the dish zoom keeps its gesture, and wheel down at full view moves on to Work', async ({ page }) => {
  test.setTimeout(60_000);
  test.skip(!(await openDish(page)), 'The dish fell back to reduced graphics in this browser.');

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

test('pinch and ctrl+wheel stay with the dish at its zoom limit, so the page never zooms', async ({ page }) => {
  test.setTimeout(60_000);
  test.skip(!(await openDish(page)), 'The dish fell back to reduced graphics in this browser.');
  const prevented = await page.evaluate(() => {
    const canvas = document.getElementById('blog-network-canvas')!;
    const event = new WheelEvent('wheel', { deltaY: 120, ctrlKey: true, bubbles: true, cancelable: true });
    canvas.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(prevented).toBe(true);
  await expect(page.locator('#zoom-text-content')).toContainText('75%');
});

test('the rest of a gesture that stepped into Blog does not zoom the dish', async ({ page }) => {
  test.setTimeout(60_000);
  test.skip(!(await openDish(page)), 'The dish fell back to reduced graphics in this browser.');
  const point = { x: 900, y: 300 };
  const onDish = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id === 'blog-network-canvas', point);
  test.skip(!onDish, 'Something covers the dish at the test point here.');
  await expect(page.locator('#zoom-text-content')).toContainText('75%');
  await page.locator('#blog .section-nav-link[data-section="work"]').first().click();
  await expect(page.locator('#work')).toHaveClass(/active-section/);
  await page.waitForTimeout(COOLDOWN_MS);
  await scrollBox(page, '#work .work-rail-scroll', 'top');

  // Upward over the globe: the first notch steps to Blog, the rest land on the dish.
  await gesture(page, -120, 6, point);
  expect(await active(page)).toBe('blog');
  await expect(page.locator('#zoom-text-content')).toContainText('75%');
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

  await page.waitForTimeout(GESTURE_GAP_MS);
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(GESTURE_GAP_MS);
  expect(await active(page)).toBe('about');
});
