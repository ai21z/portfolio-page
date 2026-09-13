import { expect, test, type Page, type TestInfo } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { fillContact, stubVerification } from './helpers/contact';

async function audit(page: Page, testInfo: TestInfo, state: string) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  await testInfo.attach(state + '.json', { body: JSON.stringify(result.violations, null, 2), contentType: 'application/json' });
  expect(result.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map(node => ({ target: node.target, summary: node.failureSummary })) }))).toEqual([]);
}

for (const width of [390, 1366]) {
  for (const section of ['main', 'about', 'skills', 'work', 'blog', 'contact']) {
    test(`automated accessibility in ${section} at ${width}px`, async ({ page }, testInfo) => {
      await stubVerification(page);
      await page.setViewportSize({ width, height: 844 });
      await page.goto('/index.html#' + section);
      await expect(page.locator('html')).toHaveClass(/js-ready/);
      await audit(page, testInfo, section);
    });
  }
}

for (const section of ['about', 'skills']) {
  test(`${section} card keeps keyboard focus inside and restores its trigger`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto(`/index.html#${section}`);
    const trigger = page.locator(`#${section} .paper`).first();
    await trigger.focus();
    await trigger.press('Enter');
    const card = page.locator('.paper-open');
    await expect(card).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveAccessibleName(/\S/);
    await audit(page, testInfo, section + '-dialog');
    await card.locator('.paper-card-close').focus();
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Tab');
      await expect.poll(() => card.evaluate(el => el.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press('Shift+Tab');
    await expect.poll(() => card.evaluate(el => el.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(card).toHaveCount(0);
    await expect(page.locator(`#${section} .paper`).first()).toBeFocused();
  });
}

test('closing a paper during routing or resize does not leave an inert page', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto('/index.html#about');
  await page.locator('#about .paper').first().click();
  await page.evaluate(() => { location.hash = 'skills'; });
  await expect(page.locator('.paper-open')).toHaveCount(0);
  await page.locator('#skills .paper').first().click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.paper-open')).toHaveCount(0);
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await page.locator('#skills .altar-close').click();
  await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  await page.locator('#necro-menu a[href="#contact"]').click();
  await expect(page.locator('#contact')).toHaveClass(/active-section/);
});

test('compact cards keep their child links enabled after resize', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto('/index.html#about');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#about [data-paper][tabindex], #skills [data-paper][tabindex]')).toHaveCount(0);
  const email = page.locator('#about a[href="mailto:aris@zounarakis.com"]');
  await expect(email).toBeEnabled();
  await email.focus();
  await expect(email).toBeFocused();
});

test('mobile menu and work dialog preserve keyboard focus and names', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/index.html');
  const menu = page.getByRole('button', { name: 'Open menu', exact: true });
  await menu.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Main menu' })).toBeVisible();
  await audit(page, testInfo, 'menu');
  await page.keyboard.press('Escape');
  await expect(menu).toBeFocused();
  await menu.press('Enter');
  await page.locator('#necro-menu a[href="#work"]').press('Enter');
  const trigger = page.locator('.rail-node[data-id="adp"] .rail-dot-btn');
  await trigger.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'ADP', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveCSS('opacity', '1');
  await audit(page, testInfo, 'work-dialog');
  for (const key of ['Tab', 'Tab', 'Shift+Tab', 'Shift+Tab']) {
    await page.keyboard.press(key);
    await expect.poll(() => dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('graphics controls and article reader remain accessible', async ({ page }, testInfo) => {
  await page.goto('/index.html');
  await page.locator('.graphics-control__toggle').press('Enter');
  await expect(page.locator('#graphics-profile-menu')).toBeVisible();
  await audit(page, testInfo, 'graphics-menu');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Graphics performance help' }).press('Enter');
  await audit(page, testInfo, 'graphics-help');
  await page.goto('/index.html#blog/codex/fail-fast-learn-faster');
  await expect(page.locator('#graphics-help-panel')).toBeHidden();
  await expect(page.locator('#graphics-profile-menu')).toBeHidden();
  await expect(page.locator('#blog-article-content h1')).toBeVisible();
  await audit(page, testInfo, 'article-reader');
});

test('contact validation, sending and unknown outcomes remain accessible', async ({ page }, testInfo) => {
  await stubVerification(page);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/contact', async route => {
    await pending;
    await route.fulfill({ status: 504, json: { success: false, state: 'unknown', error: 'Acceptance could not be confirmed.' } });
  });
  await page.goto('/index.html#contact');
  const submit = page.locator('button[type="submit"]');
  await submit.press('Enter');
  await expect(page.getByLabel('Your Name')).toBeFocused();
  await audit(page, testInfo, 'contact-validation');
  await fillContact(page);
  await submit.press('Enter');
  await expect(submit).toBeDisabled();
  try { await audit(page, testInfo, 'contact-sending'); }
  finally { release(); }
  await expect(page.locator('[data-status]')).toContainText('Acceptance could not be confirmed');
  await expect(page.locator('[data-status]')).toHaveAttribute('aria-live', 'polite');
  await audit(page, testInfo, 'contact-unknown');
});

test('reduced motion and repeated immediate paper exits clean up their dialogs', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto('/index.html#about');
  for (let index = 0; index < 3; index++) {
    await page.locator('#about .paper').first().press('Enter');
    await page.keyboard.press('Escape');
    await expect(page.locator('.paper-modal')).toHaveCount(0);
  }
  await page.locator('#about .paper').first().press('Enter');
  await page.evaluate(() => { location.hash = 'contact'; });
  await expect(page.locator('.paper-modal')).toHaveCount(0);
  await expect(page.locator('body')).not.toHaveClass(/paper-focus/);
  await expect(page.locator('#contact')).not.toHaveAttribute('inert');
});

test('paper child controls activate without toggling the containing card', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto('/index.html#about');
  await page.locator('#about .paper').first().click();
  const card = page.locator('.paper-open');
  await card.evaluate(el => {
    const link = document.createElement('a');
    link.href = '#contact';
    link.textContent = 'Fixture link';
    link.addEventListener('click', event => event.preventDefault());
    el.append(link);
  });
  await card.getByRole('link', { name: 'Fixture link' }).press('Enter');
  await expect(card).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
});
