import { expect, test } from '@playwright/test';

// Each Skills card has one heading, its field set under it as a line. An opened card adds where the
// skill shows in practice, a line kept out of the card at rest so the cards keep their fitted size.
test('a Skills card has one heading, and opening it adds its line in practice, whole', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/index.html#skills');
  await expect(page.locator('#skills')).toHaveClass(/active-section/);

  for (const card of await page.locator('#skills .slab').all()) {
    await expect(card.locator('h1, h2, h3, h4, h5, h6')).toHaveCount(1);
    await expect(card.locator('.slab-open-line')).toBeHidden();
  }
  await expect(page.locator('#skills .slab-systems .slab-subhead')).toHaveText('Backend & Infrastructure');

  await page.locator('#skills .slab-systems .paper-trigger').click();
  const card = page.locator('.paper-open');
  await expect(card).toBeVisible();
  const line = card.locator('.slab-open-line');
  await expect(line).toBeVisible();
  await expect(line).toHaveText(/^In practice\. Country-compliant payroll services/);
  await expect(line.getByRole('link', { name: 'Talos' })).toHaveAttribute('href', 'https://taloslocal.com/');
  // The opened card measured itself with the line, so the line ends inside it.
  await expect.poll(async () => {
    const [l, c] = await Promise.all([line.boundingBox(), card.boundingBox()]);
    return l!.y + l!.height <= c!.y + c!.height + 1;
  }).toBe(true);

  await page.keyboard.press('Escape');
  await expect(page.locator('.paper-open')).toHaveCount(0);
  await expect(page.locator('#skills .slab-systems .slab-open-line')).toBeHidden();
});
