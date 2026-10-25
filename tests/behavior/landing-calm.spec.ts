import { expect, test } from '@playwright/test';

// The calm field (js/calm-field.js): on wide layouts a dark ellipse sized from the name, portrait, bio,
// project links and colophon, so the network fades where the reading happens. Phones keep the network.

for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }, { width: 1920, height: 1080 }, { width: 1024, height: 768 }]) {
  test(`the calm field sits under the reading column (${viewport.width}x${viewport.height})`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/index.html');
    await expect(page.locator('#main')).toHaveAttribute('data-calm', '');
    const field = await page.evaluate(() => {
      const main = document.getElementById('main')!;
      const value = (name: string) => parseFloat(main.style.getPropertyValue(name));
      const [x, y, rx, ry] = ['--calm-x', '--calm-y', '--calm-rx', '--calm-ry'].map(value);
      const range = document.createRange();
      range.selectNodeContents(document.querySelector('.tape')!);
      const bio = range.getBoundingClientRect();
      // How far into the ellipse each corner of the bio lies, 1 at its edge.
      const reach = (px: number, py: number) => Math.hypot((px - x) / rx, (py - y) / ry);
      const coords = document.querySelector('.foot-coords')!.getBoundingClientRect();
      return {
        corners: [reach(bio.left, bio.top), reach(bio.right, bio.top), reach(bio.left, bio.bottom), reach(bio.right, bio.bottom)],
        colophon: [reach(coords.left, coords.bottom), reach(coords.right, coords.bottom)],
        before: getComputedStyle(main, '::before').backgroundImage
      };
    });
    expect(field.before).toContain('radial-gradient');
    // The whole bio sits where the field is at least half dark (its 0.5 stop is at 0.74). The colophon's
    // far end, the column's bottom right corner and the last place an ellipse reaches, keeps a third.
    for (const corner of field.corners) expect(corner).toBeLessThan(0.74);
    for (const end of field.colophon) expect(end).toBeLessThan(0.8);
  });
}

test('a phone keeps the network under the landing column', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/index.html');
  await expect(page.locator('html')).toHaveClass(/js-ready/);
  await page.waitForTimeout(300);
  await expect(page.locator('#main')).not.toHaveAttribute('data-calm');
});
