import { expect, test } from '@playwright/test';

// The posts wear the site's chrome: media stand in plates on the text column, and the video rests
// with one play stamp (js/article-plates.js) that hands over to the browser's controls once it plays.
const CODEX = '/blog/codex/fail-fast-learn-faster';

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`the post's plates hold the text column and the video plays from its stamp (${viewport.width}x${viewport.height})`, async ({ page }) => {
    await page.setViewportSize(viewport);
    for (const path of [CODEX, '/blog/cosmos/first-year-software-engineer']) {
      await page.goto(path);
      const edges = await page.evaluate(() => {
        const plate = document.querySelector('.article-plate')!.getBoundingClientRect();
        const text = document.querySelector('.article-content p')!.getBoundingClientRect();
        return { plate: [plate.left, plate.right], text: [text.left, text.right] };
      });
      expect(Math.abs(edges.plate[0] - edges.text[0]), `${path} plate left`).toBeLessThan(1);
      expect(Math.abs(edges.plate[1] - edges.text[1]), `${path} plate right`).toBeLessThan(1);
    }
    await page.goto(CODEX);
    const video = page.locator('.article-plate video');
    await expect(video).toHaveJSProperty('controls', false);
    await page.getByRole('button', { name: 'Play the video' }).click();
    await expect(video).toHaveJSProperty('controls', true);
    await expect(page.locator('.plate-play')).toHaveCount(0);
    await expect(video).toBeFocused();
  });
}

test('without scripts the post video keeps its own controls', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  const page = await context.newPage();
  await page.goto(CODEX);
  await expect(page.locator('.article-plate video')).toHaveAttribute('controls', '');
  await expect(page.locator('.plate-play')).toHaveCount(0);
  await context.close();
});

test('the reader gives its post the play stamp, and shows the crumb only where the MAP stamp is hidden', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/index.html#blog/codex/fail-fast-learn-faster`);
  await expect(page.locator('#blog-article-content .plate-play')).toBeVisible();
  await expect(page.locator('#blog-article-content .breadcrumb')).toBeHidden();
  await expect(page.locator('#blog-article-view .blog-nav')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#blog-article-content .breadcrumb')).toBeVisible();
  await expect(page.locator('#blog-article-content .breadcrumb a')).toHaveText(['Blog', 'Codex']);
});
