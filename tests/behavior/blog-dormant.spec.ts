import { expect, test, type Page } from '@playwright/test';

// Craft and Convergence have no posts yet. They show as dormant cultures: dimmed, captioned, with no
// count and nothing that opens an empty view. A link to #blog/craft still routes.

async function drawTheDish(page: Page) {
  // Headless browsers draw on a software renderer, which keeps the reduced fallback and no rim labels.
  await page.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext as any;
    HTMLCanvasElement.prototype.getContext = function (type: string, attrs: any) {
      if (type === 'webgl2') return orig.call(this, type, { ...(attrs || {}), failIfMajorPerformanceCaveat: false });
      return orig.call(this, type, attrs);
    };
  });
}

test('the Field Notes show a dormant culture as a note, and a live one as a way in', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/index.html#blog');
  const craft = page.locator('.blog-memo-item[data-hub="craft"]');
  await expect(craft).toHaveClass(/is-dormant/);
  await expect(craft).not.toHaveAttribute('href');
  await expect(craft.locator('.blog-memo-count')).toHaveText('dormant');
  await craft.click();
  await page.waitForTimeout(300);
  await expect(page.locator('#blog-category-view')).toBeHidden();

  const cosmos = page.locator('.blog-memo-item[data-hub="cosmos"]');
  await expect(cosmos).not.toHaveClass(/is-dormant/);
  await expect(cosmos.locator('.blog-memo-count')).toHaveText('(1)');
  await cosmos.click();
  await expect(page.locator('#blog-category-view')).toBeVisible();
  // The crumbs to a dormant culture take no click either.
  await expect(page.locator('#blog-category-view .blog-nav-link[data-hub="craft"]')).toBeDisabled();
  await expect(page.locator('#blog-category-view .blog-nav-link[data-hub="codex"]')).toBeEnabled();
});

test('a dormant rim label dims, carries its caption, and leaves the Tab order', async ({ page }) => {
  await drawTheDish(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/index.html#blog');
  await expect(page.locator('#dish-labels .arc-btn')).toHaveCount(4);
  const craft = page.locator('#dish-labels .arc-btn[data-hub="craft"]');
  await expect(craft).toHaveClass(/is-dormant/);
  await expect(craft).toHaveAttribute('tabindex', '-1');
  await expect(craft).toHaveAttribute('aria-disabled', 'true');
  const caption = (hub: string) => page.locator(`#dish-labels .arc-btn[data-hub="${hub}"] .arc-dormant`)
    .evaluate((el) => getComputedStyle(el).display);
  expect(await caption('craft')).not.toBe('none');
  expect(await caption('cosmos')).toBe('none');
  await expect(page.locator('#dish-labels .arc-btn[data-hub="cosmos"]')).toHaveAttribute('tabindex', '0');

  await craft.dispatchEvent('click');
  await page.waitForTimeout(300);
  await expect(page.locator('#blog-category-view')).toBeHidden();
  await page.locator('#dish-labels .arc-btn[data-hub="codex"]').dispatchEvent('click');
  await expect(page.locator('#blog-category-view')).toBeVisible();
});

test('a link to a dormant culture still routes, to its dormant note', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/index.html#blog/craft');
  await expect(page.locator('#blog-category-view')).toBeVisible();
  await expect(page.locator('#blog-category-title')).toHaveText('CRAFT');
  await expect(page.locator('.blog-empty-state')).toHaveText(/^Dormant for now\./);
});

test('on a phone a dormant culture card is a note, not a link', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/index.html#blog');
  const craft = page.locator('.specimen-slide.slide-craft');
  await expect(craft).toHaveClass(/is-dormant/);
  await expect(craft).not.toHaveAttribute('href');
  await expect(craft.locator('.specimen-count')).toHaveText('dormant');
  await expect(page.locator('.specimen-slide.slide-codex')).toHaveAttribute('href', '#blog/codex');
});

test('a failed post list leaves every culture open rather than calling them all dormant', async ({ page }) => {
  await page.route('**/blog/articles.json', (route) => route.abort());
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/index.html#blog');
  await page.waitForTimeout(800);
  await expect(page.locator('.blog-memo-item.is-dormant')).toHaveCount(0);
  await expect(page.locator('.blog-memo-item[data-hub="craft"]')).toHaveAttribute('href', '#blog/craft');
});
