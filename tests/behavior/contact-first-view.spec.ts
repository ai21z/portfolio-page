import { expect, test, type Page } from '@playwright/test';
import { fillContact, stubVerification } from '../helpers/contact';

// What a visitor sees on opening Contact, before typing anything.

async function openContact(page: Page, viewport: { width: number, height: number }) {
  await page.setViewportSize(viewport);
  await stubVerification(page);
  await page.goto('/index.html#contact');
  await expect(page.locator('#contact')).toHaveClass(/active-section/);
  await page.evaluate(() => document.fonts.ready);
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`the contact sheet has no hidden scroll strip of its own (${viewport.width}x${viewport.height})`, async ({ page }) => {
    await openContact(page, viewport);
    // A strip would take the first wheel or touch gesture and stop it short of the page.
    const overflow = await page.locator('#contact').evaluate((el) => el.scrollHeight - el.clientHeight);
    expect(overflow).toBeLessThanOrEqual(1);
  });
}

// Where the sheet fits the window, the page must not scroll past it either: a wheel down would
// move it, and the next wheel up would only scroll it back instead of moving on to Work.
for (const viewport of [
  { width: 1920, height: 1080 }, { width: 1920, height: 913 }, { width: 1536, height: 864 }, { width: 1512, height: 860 },
  { width: 1440, height: 900 }, { width: 1470, height: 840 }, { width: 1366, height: 768 }, { width: 1280, height: 720 }
]) {
  test(`the page does not scroll past a contact sheet that fits (${viewport.width}x${viewport.height})`, async ({ page }) => {
    await openContact(page, viewport);
    const overflow = await page.evaluate(() => [document.body, document.documentElement, document.getElementById('contact')!]
      .map((el) => el.scrollHeight - el.clientHeight));
    expect(Math.max(...overflow)).toBeLessThanOrEqual(1);
  });
}

test('with larger text set by the reader, a field error wraps onto its own lines, never over the next label', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'The browser text size is set through Chromium.');
  // Chrome's Very large font size setting.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Page.setFontSizes', { fontSizes: { standard: 24, fixed: 21 } });
  for (const viewport of [{ width: 1280, height: 720 }, { width: 360, height: 780 }]) {
    await openContact(page, viewport);
    await page.locator('#contact-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
    await expect(page.locator('#contact .validation-msg:not(:empty)')).toHaveCount(4);
    // The errors shake into place: measure where they rest.
    await page.evaluate(() => Promise.all([...document.querySelectorAll('#contact .validation-msg')]
      .flatMap((el) => el.getAnimations()).map((animation) => animation.finished.catch(() => undefined))));
    const overlaps = await page.evaluate(() => {
      // In the sheet's own coordinates: the sheet is tilted, so screen boxes of lines that only
      // touch overlap by a few pixels.
      const sheet = document.querySelector('#contact .notebook-page');
      const box = (el: HTMLElement) => {
        let top = 0, left = 0;
        for (let node: HTMLElement | null = el; node && node !== sheet; node = node.offsetParent as HTMLElement | null) {
          top += node.offsetTop;
          left += node.offsetLeft;
        }
        return { top, left, bottom: top + el.offsetHeight, right: left + el.offsetWidth };
      };
      const boxes = (selector: string) => [...document.querySelectorAll<HTMLElement>(`#contact ${selector}`)].map(box);
      const labels = boxes('.notebook-label');
      return boxes('.validation-msg:not(:empty)')
        .flatMap((e) => labels.filter((l) => e.left < l.right && l.left < e.right && e.top < l.bottom && l.top < e.bottom)).length;
    });
    expect(overlaps).toBe(0);
  }
});

// The jury found Send below the fold at 1440x900. Short laptop windows pair name and email on one
// ruled line to keep it in view.
for (const viewport of [
  { width: 1920, height: 1080 }, { width: 1440, height: 900 }, { width: 1366, height: 768 },
  { width: 1280, height: 720 }, { width: 390, height: 844 }, { width: 360, height: 780 }
]) {
  test(`Send is in the first view of the contact sheet (${viewport.width}x${viewport.height})`, async ({ page }) => {
    await openContact(page, viewport);
    const send = page.getByRole('button', { name: /send message/i });
    // The sheet rises 30px into place as it opens.
    await expect.poll(async () => {
      const box = await send.boundingBox();
      return box ? Math.round(box.y + box.height) : Infinity;
    }).toBeLessThanOrEqual(viewport.height);
  });
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`with the spam check blocked, Contact opens calm and ready to send (${viewport.width}x${viewport.height})`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.route('https://challenges.cloudflare.com/**', (route) => route.abort());
    await page.goto('/index.html#contact');
    await expect(page.locator('#contact')).toHaveClass(/active-section/);
    await page.waitForTimeout(500);
    await expect(page.locator('#contact [data-status]')).toHaveText('');
    await expect(page.locator('#contact .error')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /send message/i })).toBeEnabled();
  });
}

test('a check that asks for a tick is explained while Send waits, and sends once ticked', async ({ page }) => {
  await page.clock.install();
  await page.route('https://challenges.cloudflare.com/**', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: "window.turnstile = { render(el, o) { window.__tick = () => { o['after-interactive-callback'](); o.callback('ticked-token'); }; setTimeout(() => o['before-interactive-callback'](), 0); return 'w'; }, reset() {}, remove() {} }; window.__turnstileOnLoad();"
  }));
  const tokens: string[] = [];
  await page.route('**/api/contact', (route) => {
    tokens.push(route.request().postDataJSON().turnstileToken);
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, state: 'accepted' }) });
  });
  await page.goto('/index.html#contact');
  await expect(page.locator('#contact [data-turnstile]')).toHaveClass(/is-interactive/);
  await fillContact(page);
  await page.getByRole('button', { name: /send message/i }).click();
  const status = page.locator('#contact [data-status]');
  await expect(status).toHaveText('Tick the box and your message is on its way.');
  await expect(status).not.toHaveClass(/error/);
  // A visitor ticking takes as long as they take: the press keeps waiting.
  await page.clock.fastForward(20000);
  await expect(status).toHaveText('Tick the box and your message is on its way.');
  await page.evaluate(() => (window as any).__tick());
  await expect(status).toContainText('Message accepted');
  expect(tokens).toEqual(['ticked-token']);
  await expect(page.locator('#contact [data-turnstile]')).not.toHaveClass(/is-interactive/);
});

test('a press waits 12 seconds for a check that never answers, then offers email with the draft editable', async ({ page }) => {
  await page.clock.install();
  await page.route('https://challenges.cloudflare.com/**', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: "window.turnstile = { render() { return 'silent'; }, reset() {}, remove() {} }; window.__turnstileOnLoad();"
  }));
  let posts = 0;
  await page.route('**/api/contact', (route) => { posts++; return route.abort(); });
  await page.goto('/index.html#contact');
  await expect(page.locator('#contact')).toHaveClass(/active-section/);
  await fillContact(page);
  await page.getByRole('button', { name: /send message/i }).click();
  const status = page.locator('#contact [data-status]');
  await page.clock.fastForward(11000);
  await expect(status).toHaveText('Sending your message...');
  await page.clock.fastForward(1500);
  await expect(status).toHaveText(/spam check did not clear this time.*send it by email/i);
  await expect(page.getByRole('button', { name: /send message/i })).toBeEnabled();
  await expect(page.getByLabel('Message')).toBeEditable();
  expect(posts).toBe(0);
});

test('a tick asked for after the press lifts the 12 second limit, and the tick sends', async ({ page }) => {
  await page.clock.install();
  await page.route('https://challenges.cloudflare.com/**', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: "window.turnstile = { render(el, o) { window.__ask = () => o['before-interactive-callback'](); window.__tick = () => { o['after-interactive-callback'](); o.callback('ticked-late'); }; return 'w'; }, reset() {}, remove() {} }; window.__turnstileOnLoad();"
  }));
  const tokens: string[] = [];
  await page.route('**/api/contact', (route) => {
    tokens.push(route.request().postDataJSON().turnstileToken);
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, state: 'accepted' }) });
  });
  await page.goto('/index.html#contact');
  await expect(page.locator('#contact')).toHaveClass(/active-section/);
  await fillContact(page);
  await page.getByRole('button', { name: /send message/i }).click();
  await page.clock.fastForward(5000);
  await page.evaluate(() => (window as any).__ask());
  const status = page.locator('#contact [data-status]');
  await expect(status).toHaveText('Tick the box and your message is on its way.');
  await page.clock.fastForward(20000);
  await expect(status).toHaveText('Tick the box and your message is on its way.');
  await page.evaluate(() => (window as any).__tick());
  await expect(status).toContainText('Message accepted');
  expect(tokens).toEqual(['ticked-late']);
});

test('a spam check script that arrives after its load timeout still mounts', async ({ page }) => {
  await page.clock.install();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('https://challenges.cloudflare.com/**', async (route) => {
    await gate;
    await route.fulfill({
      contentType: 'application/javascript',
      body: "window.__mounts = 0; window.turnstile = { render(el, o) { window.__mounts++; setTimeout(() => o.callback('late-token'), 0); return 'late'; }, reset() {}, remove() {} }; window.__turnstileOnLoad();"
    });
  });
  // The held script also holds the page's load event.
  await page.goto('/index.html#contact', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#contact')).toHaveClass(/active-section/);
  await page.clock.fastForward(9000);
  release();
  await expect.poll(() => page.evaluate(() => (window as any).__mounts)).toBe(1);
  await expect(page.locator('#contact [data-status]')).toHaveText('');
});

// On phones and tablets the close button sits in a corner torn out of the sheet and scrolls with
// it, so at no scroll position does it lie on the paper, a line of text or the seal.
for (const viewport of [
  { width: 390, height: 844 }, { width: 360, height: 780 }, { width: 375, height: 667 },
  { width: 320, height: 568 }, { width: 844, height: 390 }, { width: 768, height: 1024 }
]) {
  test(`the phone close button never lies on the sheet (${viewport.width}x${viewport.height})`, async ({ page }) => {
    await openContact(page, viewport);
    const settle = () => page.evaluate(() => Promise.all([...document.querySelectorAll('#contact .notebook-page, #contact .notebook-page *')]
      .flatMap((el) => el.getAnimations())
      .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
      .map((animation) => animation.finished.catch(() => undefined))));
    const paperUnderClose = () => page.evaluate(() => {
      const close = document.querySelector<HTMLElement>('#contact .contact-close')!;
      const scrollers = [document.documentElement, document.body];
      const end = Math.max(...scrollers.map((el) => el.scrollHeight - el.clientHeight));
      const hits: string[] = [];
      close.style.visibility = 'hidden';
      for (let at = 0; at <= end + 4; at += 4) {
        for (const el of scrollers) el.scrollTop = Math.min(at, end);
        // Sampled with the button hidden, over its 44px disc.
        const disc = close.getBoundingClientRect();
        const cx = disc.left + disc.width / 2;
        const cy = disc.top + disc.height / 2;
        for (let x = -22; x <= 22; x += 2) {
          for (let y = -22; y <= 22; y += 2) {
            if (x * x + y * y > 22 * 22) continue;
            if (document.elementFromPoint(cx + x, cy + y)?.closest('.notebook-page, .wax-seal')) hits.push(`${cx + x},${cy + y} at scroll ${Math.min(at, end)}`);
          }
        }
      }
      close.style.visibility = '';
      for (const el of scrollers) el.scrollTop = 0;
      return hits;
    });
    await settle();
    expect(await paperUnderClose()).toEqual([]);
    // With every field error showing, the sheet is longer and the page scrolls further.
    await page.locator('#contact-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
    await expect(page.locator('#contact .validation-msg:not(:empty)')).toHaveCount(4);
    await settle();
    expect(await paperUnderClose()).toEqual([]);
    await expect(page.locator('#contact .contact-close')).toBeVisible();
  });
}
