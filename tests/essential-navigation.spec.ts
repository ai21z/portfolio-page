import { expect, test } from '@playwright/test';

for (const scripts of ['disabled', 'blocked-app']) {
  for (const width of [390, 1366]) {
    test('essential content survives ' + scripts + ' at ' + width + 'px', async ({ browser, baseURL }) => {
      const context = await browser.newContext({ javaScriptEnabled: scripts !== 'disabled', viewport: { width, height: 844 } });
      const page = await context.newPage();
      if (scripts === 'blocked-app') await page.route('**/js/app.js*', route => route.abort());
      try {
        await page.goto(baseURL + '/index.html#work');
        await expect(page.getByRole('navigation', { name: 'Portfolio navigation' })).toBeVisible();
        await expect(page.locator('#work-index')).toBeVisible();
        await expect(page.locator('#work-index')).toContainText('ADP');
        await expect(page.locator('#work-index a[href="https://github.com/ai21z/TrueRolls"]')).toBeVisible();
        await page.getByRole('navigation', { name: 'Portfolio navigation' }).getByRole('link', { name: 'Writing' }).click();
        await expect(page.getByRole('navigation', { name: 'Published writing' }).getByRole('link')).toHaveCount(2);
        await expect(page.getByRole('navigation', { name: 'Published writing' })).toBeVisible();
        await page.reload();
        await expect(page.getByRole('navigation', { name: 'Published writing' })).toBeVisible();
        await page.getByRole('navigation', { name: 'Portfolio navigation' }).getByRole('link', { name: 'Contact' }).click();
        await expect(page.locator('#contact .contact-email')).toBeVisible();
        await page.goBack();
        await expect(page.getByRole('navigation', { name: 'Published writing' })).toBeVisible();
        await page.goForward();
        await expect(page.locator('#contact .contact-email')).toBeVisible();
        await page.getByRole('navigation', { name: 'Portfolio navigation' }).getByRole('link', { name: 'Home' }).click();
        const email = page.getByRole('link', { name: 'Email Aris', exact: true });
        await email.scrollIntoViewIfNeeded();
        const footer = await email.boundingBox();
        const navigation = await page.getByRole('navigation', { name: 'Portfolio navigation' }).boundingBox();
        expect(footer!.y + footer!.height).toBeLessThanOrEqual(navigation!.y);
      } finally {
        await context.close();
      }
    });
  }
}

test('the initial legacy category hash survives inline fallback startup', async ({ page }) => {
  await page.goto('/index.html#blog/craft');
  await expect(page).toHaveURL(/#blog\/craft$/);
  await expect(page.locator('#blog')).toHaveAttribute('data-mode', 'category');
});

for (const width of [390, 1366]) {
  test('startup keeps intro geometry stable at ' + width + 'px', async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/js/app.js*', async route => {
      await blocked;
      await route.continue();
    });
    try {
      await page.goto('/index.html', { waitUntil: 'commit' });
      await expect(page.getByRole('navigation', { name: 'Portfolio navigation' })).toBeVisible();
      await expect.poll(() => page.evaluate(() => Array.from(document.fonts)
        .some(font => font.family.includes('Special Elite') && font.status === 'loaded'))).toBe(true);
      const before = await page.locator('.grid').boundingBox();
      const heading = await page.locator('h1').boundingBox();
      release();
      await expect(page.locator('html')).toHaveClass(/js-ready/);
      const after = await page.locator('.grid').boundingBox();
      const settledHeading = await page.locator('h1').boundingBox();
      expect(after!.y).toBeCloseTo(before!.y, 0);
      expect(settledHeading!.y).toBeCloseTo(heading!.y, 0);
      expect(settledHeading!.height).toBeCloseTo(heading!.height, 0);
    } finally {
      release();
    }
  });
}
