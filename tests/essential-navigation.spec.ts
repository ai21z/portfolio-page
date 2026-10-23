import { expect, test } from '@playwright/test';

for (const scripts of ['disabled', 'blocked-app', 'broken-module']) {
  for (const width of [390, 1366]) {
    test('essential content survives ' + scripts + ' at ' + width + 'px', async ({ browser, baseURL }) => {
      const context = await browser.newContext({ javaScriptEnabled: scripts !== 'disabled', viewport: { width, height: 844 } });
      const page = await context.newPage();
      if (scripts === 'blocked-app') await page.route('**/js/app.js*', route => route.abort());
      // A module of the app that fails while it loads: the app never starts.
      if (scripts === 'broken-module') {
        await page.route('**/js/navigation.js*', route => route.fulfill({ contentType: 'application/javascript', body: 'throw new Error("broken module");' }));
      }
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
      await expect(page.locator('.grid')).toHaveCSS('display', 'grid');
      // While the app loads, the plain fallback nav stays out of sight.
      await expect(page.getByRole('navigation', { name: 'Portfolio navigation' })).toBeHidden();
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

test('a cold load never shows the plain fallback nav while the app loads', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__navSeen = 0;
    const sample = () => {
      const nav = document.querySelector('.essential-nav');
      if (nav) {
        const style = getComputedStyle(nav);
        if (style.display !== 'none' && style.visibility !== 'hidden' && nav.getBoundingClientRect().height > 0) (window as any).__navSeen++;
      }
      if (!document.documentElement.classList.contains('js-ready')) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  // A first visit on a slow line: the app's script arrives well after the page and its styles.
  await page.route('**/js/app.js*', async route => {
    await new Promise(resolve => setTimeout(resolve, 800));
    await route.continue();
  });
  await page.goto('/index.html', { waitUntil: 'commit' });
  await expect(page.locator('html')).toHaveClass(/js-ready/);
  expect(await page.evaluate(() => (window as any).__navSeen)).toBe(0);
  await expect(page.getByRole('navigation', { name: 'Portfolio navigation' })).toBeHidden();
});

test('a stalled load shows the plain nav once the app is long overdue, and the app hides it on arrival', async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  // One module of the app hangs: the page never reaches DOMContentLoaded while it does.
  await page.route('**/js/navigation.js*', async route => {
    await held;
    await route.continue();
  });
  try {
    await page.goto('/index.html', { waitUntil: 'commit' });
    const nav = page.getByRole('navigation', { name: 'Portfolio navigation' });
    await expect(nav).toBeHidden();
    await expect(nav).toBeVisible({ timeout: 8000 });
    await nav.getByRole('link', { name: 'Work' }).click();
    await expect(page.locator('#work-index')).toBeVisible();
    release();
    await expect(page.locator('html')).toHaveClass(/js-ready/);
    await expect(nav).toBeHidden();
  } finally {
    release();
  }
});

test('a running app keeps the plain nav hidden even if the head script that marks scripts is blocked', async ({ page }) => {
  await page.route('**/index.html', async route => {
    const response = await route.fetch();
    const body = (await response.text()).replace(/<script>\s*\(function \(\) \{\s*var root = document\.documentElement;[\s\S]*?<\/script>/, '');
    await route.fulfill({ response, body });
  });
  await page.goto('/index.html');
  await expect(page.locator('html')).toHaveClass(/js-ready/);
  await expect(page.locator('html')).not.toHaveClass(/(^|\s)js(\s|$)/);
  await expect(page.getByRole('navigation', { name: 'Portfolio navigation' })).toBeHidden();
});
