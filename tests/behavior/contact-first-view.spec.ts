import { expect, test, type Page } from '@playwright/test';
import { stubVerification } from '../helpers/contact';

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
