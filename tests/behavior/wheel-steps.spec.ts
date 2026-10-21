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

// A timed stream of wheel deltas, 16 ms apart like a trackpad or a free-spinning wheel, each event
// on whatever is under the pointer at that moment. Real spacing matters here, so callers run it in
// Chromium only, where the page's timers keep it.
// A number is a wheel delta. { stall } blocks the page that long, as a heavy section arrival does,
// and the next event then carries a timestamp that far later, as Chrome's merged events do. With
// timersFirst the page's overdue timers run before that event. { rest } is a pause with the page free.
// { held } is input held up outside the page (a busy browser or GPU process) while the page stays
// free: the deltas happen on time, then reach the page together, each with its own time as Firefox
// keeps them, or merged into one event stamped with the newest, as Chrome does.
type StreamItem = number | { stall: number, timersFirst?: boolean } | { rest: number } | { held: number[], merged?: boolean };
async function stream(page: Page, deltas: StreamItem[], at = POINTER, spacingMs = 16) {
  await page.evaluate(async ({ list, x, y, spacing }) => {
    for (const item of list) {
      if (typeof item === 'object') {
        if ('rest' in item) {
          await new Promise((resolve) => setTimeout(resolve, item.rest));
          continue;
        }
        if ('held' in item) {
          const queue: WheelEvent[] = [];
          for (const dy of item.held) {
            queue.push(new WheelEvent('wheel', { deltaY: dy, bubbles: true, cancelable: true }));
            await new Promise((resolve) => setTimeout(resolve, spacing));
          }
          const sum = item.held.reduce((a, b) => a + b, 0);
          const arriving = item.merged ? [new WheelEvent('wheel', { deltaY: sum, bubbles: true, cancelable: true })] : queue;
          for (const event of arriving) (document.elementFromPoint(x, y) || document.body).dispatchEvent(event);
          continue;
        }
        const until = performance.now() + item.stall;
        while (performance.now() < until) { /* hold the main thread */ }
        if (item.timersFirst) await new Promise((resolve) => setTimeout(resolve, 0));
        continue;
      }
      (document.elementFromPoint(x, y) || document.body)
        .dispatchEvent(new WheelEvent('wheel', { deltaY: item, bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, spacing));
    }
  }, { list: deltas, x: at.x, y: at.y, spacing: spacingMs });
  await page.waitForTimeout(GESTURE_GAP_MS);
}

// A trackpad swipe: a short ramp up, then inertia decaying to 1 px.
const swipe = (sign: number, events = 90) => Array.from({ length: events }, (_, i) =>
  sign * Math.max(1, Math.round(40 * (i < 6 ? (i + 1) / 6 : Math.exp(-(i - 6) / 14)))));

// A swipe whose momentum is cut off while still strong, and the next swipe's linear ramp from the
// touch, as a quick second swipe gives on a trackpad. decay is per event.
const momentum = (sign: number, events: number, decay: number) => Array.from({ length: events }, (_, i) =>
  sign * (i < 6 ? 40 * (i + 1) / 6 : 40 * decay ** (i - 6)));
const ramp = (sign: number) => [3, 8, 14, 20, 25, 31, 33, 32, 30, 28, 26].map((d) => sign * d);

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

test('a steady stream with one merged spike still moves only one section', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Needs the real 16 ms spacing that Chromium keeps.');
  await open(page, '#about');
  // 1.6 s of a steady 15 px stream. Chrome merges queued wheels into one larger event when the page
  // stalls, which shows up as one spike, here right after the step.
  const deltas = Array.from({ length: 100 }, (_, i) => (i === 12 || i === 60 ? 113 : 15));
  await stream(page, deltas);
  expect(await active(page)).toBe('skills');
});

test('a second swipe started during the first one\'s inertia moves on again', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Needs the real 16 ms spacing that Chromium keeps.');
  await open(page, '#skills');
  await stream(page, [...swipe(-1), ...swipe(-1)]);
  expect(await active(page)).toBe('intro');
});

// The same per-event swipes at 60 and 120 Hz, and 47 ms apart as real input reached a busy headless
// page: there they make a slower swipe with longer inertia, seen in few, sparse events.
for (const [label, spacing, decay, events] of [['60 Hz', 16, 0.967, 51], ['120 Hz', 8, 0.983, 96], ['sparse events', 47, 0.967, 45]] as const) {
  test(`a second swipe while the first one's momentum is still strong moves on again (${label})`, async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Needs the real event spacing that Chromium keeps.');
    await open(page, '#skills');
    // The first swipe's momentum is still 9 to 11 px per event when the second swipe starts.
    await stream(page, [...momentum(-1, events, decay), ...ramp(-1)], POINTER, spacing);
    expect(await active(page)).toBe('intro');
  });
}

for (const cut of [50, 45]) {
  test(`a brisk second swipe once the first one's inertia is nearly spent moves on again (${cut} events)`, async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Needs the real 16 ms spacing that Chromium keeps.');
    await open(page, '#skills');
    // The inertia is down to 2 or 3 px a frame, and the new swipe starts at 7 px after a 40 ms touch.
    await stream(page, [...swipe(-1).slice(0, cut), { rest: 40 }, ...swipe(-1)]);
    expect(await active(page)).toBe('intro');
  });
}

test('a swipe after a few small deltas steps once, though it steps while still speeding up', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Needs the real 16 ms spacing that Chromium keeps.');
  await open(page, '#about');
  // Fingers settling on the pad send a few small deltas, then the swipe steps on its first event.
  const decay = Array.from({ length: 80 }, (_, i) => Math.max(1, 600 * 0.94 ** i));
  await stream(page, [4, 4, 4, 1, 1, { rest: 150 }, 70, 230, 500, ...decay]);
  expect(await active(page)).toBe('skills');
});

test('one low reading after the inertia has slowed does not split it', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Needs the real 16 ms spacing that Chromium keeps.');
  await open(page, '#about');
  // Inertia at 40% of its top, one 3 px reading, then the same inertia on to its end.
  const decay = Array.from({ length: 120 }, (_, i) => Math.max(1, 40 * 0.97 ** i));
  await stream(page, [10, 20, 30, ...decay.slice(0, 30), 3, ...decay.slice(30)]);
  expect(await active(page)).toBe('skills');
});

test('merged frames after a low reading keep their true speed and do not split the gesture', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Needs the real 16 ms spacing that Chromium keeps.');
  await open(page, '#about');
  // Inertia at under half its top, one 3 px reading, then frames merged in threes: each event
  // carries three frames of travel and arrives three frames after the last.
  const decay = Array.from({ length: 90 }, (_, i) => Math.max(1, 40 * 0.97 ** i));
  const merged: StreamItem[] = [];
  for (let i = 30; i < 60; i += 3) merged.push({ stall: 32 }, decay[i] + decay[i + 1] + decay[i + 2]);
  await stream(page, [10, 20, 30, ...decay.slice(0, 30), 3, ...merged, ...decay.slice(60)]);
  expect(await active(page)).toBe('skills');
});

test('one low reading in a steady stream does not split it after a step', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Needs the real 16 ms spacing that Chromium keeps.');
  await open(page, '#about');
  const deltas = [...Array(30).fill(20), 5, 21, 23, 22, 21, ...Array(60).fill(20)];
  await stream(page, deltas);
  expect(await active(page)).toBe('skills');
});

for (const [stall, timersFirst] of [[330, false], [330, true], [240, true]] as const) {
  test(`a ${stall} ms stall right after a step does not split the gesture into a second step${timersFirst ? ', even when timers run first' : ''}`, async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Needs the real 16 ms spacing that Chromium keeps.');
    await open(page, '#about');
    // The step happens on the fourth event, and two events later the arrival holds the page while
    // the stream goes on. The rest of the stream runs well past the cooldown. A 240 ms stall leaves
    // the end timer under 50 ms late, as if the page had been free, and Chrome then hands the
    // stall's input over as one merged event.
    const merged = stall < 300 ? [15 * stall / 16] : [];
    await stream(page, [...Array(6).fill(15), { stall, timersFirst }, ...merged, ...Array(80).fill(15)]);
    expect(await active(page)).toBe('skills');
  });
}

for (const merged of [false, true]) {
  test(`input held up outside the page still belongs to its gesture (${merged ? 'merged, as Chrome' : 'own times, as Firefox'})`, async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Needs the real 16 ms spacing that Chromium keeps.');
    await open(page, '#about');
    // A busy browser or GPU process holds 300 ms of the stream while the page's own timers run.
    await stream(page, [...Array(6).fill(15), { held: Array(19).fill(15), merged }, ...Array(80).fill(15)]);
    expect(await active(page)).toBe('skills');
  });
}

test('input held up through fast-fading inertia still belongs to its gesture', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Needs the real 16 ms spacing that Chromium keeps.');
  await open(page, '#about');
  // 800 ms of the inertia are held and merged into one event, which carries a quarter of the
  // speed the inertia had before the hold.
  const decay = Array.from({ length: 70 }, (_, i) => 100 * 0.92 ** i);
  await stream(page, [10, 30, 60, 90, ...decay.slice(0, 2), { held: decay.slice(2, 52), merged: true }, ...decay.slice(52)]);
  expect(await active(page)).toBe('skills');
});

test('a swipe after the Work timeline reached its end moves on, though the scroll before it was brisk', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Needs the real 16 ms spacing that Chromium keeps.');
  await open(page, '#work');
  await expect(page.locator('#work .work-rail-scroll')).toBeVisible();
  await scrollBox(page, '#work .work-rail-scroll', 'top');
  const away = { x: 1000, y: 150 };
  // The first swipe scrolls the timeline, and its inertia runs out at 1 px a frame.
  await stream(page, swipe(1, 70), away);
  await scrollBox(page, '#work .work-rail-scroll', 'end');
  // A brisk swipe moments later: its first event carries far more than the inertia's last ones,
  // which must not pass for input held up from the scroll.
  await stream(page, [24, 40, 50, 45, 40, 35, 30, 25, 20], away);
  expect(await active(page)).toBe('contact');
});

test('one swipe that is still speeding up when it steps moves only one section', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Needs the real event spacing that Chromium keeps.');
  await open(page, '#about');
  // 120 Hz: a ramp that crosses the step distance while it still climbs, then inertia.
  const deltas = [0.5, 1, 2, 3.5, 5.5, 7.5, 10.5, 13.5, 17.5, 21.5, 26];
  for (let i = 1; i <= 160; i++) deltas.push(26 * 0.997 ** (8 * i));
  await stream(page, deltas, POINTER, 8);
  expect(await active(page)).toBe('skills');
});

test('a steady drag with a low reading, a push and merged frames moves only one section', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Needs the real 16 ms spacing that Chromium keeps.');
  await open(page, '#about');
  // Each merged frame carries three frames of travel and arrives three frames late.
  const merged = [{ stall: 32 }, 60, { stall: 32 }, 60, { stall: 32 }, 60];
  await stream(page, [...Array(30).fill(20), 5, ...Array(10).fill(26), ...merged, ...Array(40).fill(26)]);
  expect(await active(page)).toBe('skills');
});

test('notches 400 ms apart move on with every notch past the cooldown', async ({ page }) => {
  await open(page, '#about');
  // The second notch falls inside the first step's cooldown, the third is past it.
  await stream(page, [120, { rest: 384 }, 120, { rest: 384 }, 120]);
  expect(await active(page)).toBe('blog');
});

test('a gentle second swipe after a short rest moves on again', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Needs the real 16 ms spacing that Chromium keeps.');
  await open(page, '#skills');
  // A drag without inertia steps early, and after a rest a second one, too gentle to read as a new
  // swipe within the first, starts near the end of that step's cooldown and carries on past it.
  const first = [10, 14, 18, 16, 14, 12, 10, ...Array(9).fill(8)].map((d) => -d);
  const second = [8, 10, 12, 12, 12, 12, 12, 10, 10, 8, 8].map((d) => -d);
  await stream(page, [...first, { rest: 450 }, ...second]);
  expect(await active(page)).toBe('intro');
});

test('a slow notch overtaken by a nav click does not move past the clicked section', async ({ page }) => {
  await open(page, '#about');
  await page.evaluate(async () => {
    (document.elementFromPoint(700, 450) || document.body)
      .dispatchEvent(new WheelEvent('wheel', { deltaY: 50, bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 60));
    document.querySelector<HTMLElement>('#about .section-nav-link[data-section="blog"]')!.click();
  });
  await page.waitForTimeout(GESTURE_GAP_MS + 200);
  expect(await active(page)).toBe('blog');
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

test('with reduced motion the landing scrolls at once under the wheel, without an animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, '');
  const overflow = await page.locator('#main').evaluate((el) => el.scrollHeight - el.clientHeight);
  test.skip(overflow < 40, 'The landing fits this viewport, so there is nothing to scroll first.');
  await scrollBox(page, '#main', 'top');
  const label = await page.locator('.network-node-label').first().boundingBox();
  test.skip(!label, 'The network labels are not laid out in this viewport.');
  const top = await page.evaluate(({ x, y }) => {
    const target = document.elementFromPoint(x, y);
    if (document.getElementById('main')!.contains(target)) return -1;
    target!.dispatchEvent(new WheelEvent('wheel', { deltaY: 30, bubbles: true, cancelable: true }));
    return document.getElementById('main')!.scrollTop;
  }, { x: label!.x + label!.width / 2, y: label!.y + label!.height / 2 });
  test.skip(top === -1, 'The label is not above the landing here.');
  expect(top).toBeGreaterThan(20);
});

test('an open graphics menu closes on a click elsewhere and frees the wheel', async ({ page }) => {
  await open(page, '#about');
  await page.locator('.graphics-control__toggle').click();
  await expect(page.locator('#graphics-profile-menu')).toBeVisible();
  await page.mouse.click(720, 40);
  await expect(page.locator('#graphics-profile-menu')).toBeHidden();
  await gesture(page, 120);
  expect(await active(page)).toBe('skills');
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
