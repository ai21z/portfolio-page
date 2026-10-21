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
