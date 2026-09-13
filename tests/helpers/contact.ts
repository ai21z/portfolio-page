import type { Page } from '@playwright/test';

export async function stubVerification(page: Page) {
  await page.route('https://challenges.cloudflare.com/**', route => route.fulfill({
    contentType: 'application/javascript',
    body: "let callback; window.turnstile = { render(el, opts) { callback = opts.callback; setTimeout(() => callback('fixture-token'), 0); return 'fixture'; }, reset() { setTimeout(() => callback('renewed-token'), 0); }, remove() {} }; document.dispatchEvent(new CustomEvent('turnstile-loaded'));"
  }));
}

export async function fillContact(page: Page) {
  await page.getByLabel('Your Name').fill('Fixture Visitor');
  await page.getByLabel('Your Email').fill('visitor@example.test');
  await page.getByLabel('Subject').fill('Synthetic contact check');
  await page.getByLabel('Message').fill('This draft must never leave the local test.');
}
