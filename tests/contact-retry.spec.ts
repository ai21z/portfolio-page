import { expect, test } from '@playwright/test';
import { fillContact, stubVerification } from './helpers/contact';

test.beforeEach(async ({ page }) => {
  await stubVerification(page);
});

test('a lost response retains the draft and uses the same identity after token renewal', async ({ page }) => {
  const attempts: Record<string, unknown>[] = [];
  await page.route('**/api/contact', route => {
    attempts.push(route.request().postDataJSON());
    return attempts.length === 1 ? route.abort('connectionreset') : route.fulfill({
      contentType: 'application/json', body: JSON.stringify({ success: true, state: 'accepted' })
    });
  });
  await page.goto('/index.html#contact');
  await fillContact(page);
  await page.getByRole('button', { name: /send message/i }).click();
  await expect(page.locator('[data-status]')).toContainText('may already have been accepted');
  await expect(page.getByLabel('Message')).toHaveValue('This draft must never leave the local test.');
  await expect(page.locator('[data-status] a')).toHaveAttribute('href', 'mailto:aris@zounarakis.com');
  await page.getByRole('button', { name: /send message/i }).click();
  await expect(page.locator('[data-status]')).toContainText('Message accepted');
  expect(attempts).toHaveLength(2);
  expect(attempts[0].submissionId).toBe(attempts[1].submissionId);
  expect(attempts[0].submissionCreatedAt).toBe(attempts[1].submissionCreatedAt);
  expect(attempts[0].turnstileToken).not.toBe(attempts[1].turnstileToken);
});

test('the browser deadline restores editing and does not automatically retry', async ({ page }) => {
  await page.clock.install();
  let attempts = 0;
  await page.route('**/api/contact', () => { attempts++; });
  await page.goto('/index.html#contact');
  await fillContact(page);
  await page.getByRole('button', { name: /send message/i }).click();
  await expect(page.locator('[data-status]')).toContainText('Sending');
  await page.clock.fastForward(31000);
  await expect(page.locator('[data-status]')).toContainText('may already have been accepted');
  await expect(page.getByLabel('Message')).toBeEditable();
  await expect(page.getByLabel('Message')).not.toBeEmpty();
  expect(attempts).toBe(1);
});

test('a confirmed rejection preserves fields and editing creates a new logical submission', async ({ page }) => {
  const ids: string[] = [];
  await page.route('**/api/contact', route => {
    ids.push(route.request().postDataJSON().submissionId);
    return route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ state: 'rejected', error: 'The email service rejected this attempt.' }) });
  });
  await page.goto('/index.html#contact');
  await fillContact(page);
  await page.getByRole('button', { name: /send message/i }).click();
  await expect(page.locator('[data-status]')).toContainText('rejected');
  await page.getByLabel('Subject').fill('An intentionally changed subject');
  await page.getByRole('button', { name: /send message/i }).click();
  await expect.poll(() => ids.length).toBe(2);
  expect(ids[0]).not.toBe(ids[1]);
});
