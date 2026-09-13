import { expect, test } from '@playwright/test';

for (const hasTouch of [false, true]) {
  test.describe(hasTouch ? 'touch input' : 'desktop input', () => {
    test.use({ hasTouch });

    test('reports matching pointer and hover capabilities', async ({ page }) => {
      const input = await page.evaluate(() => ({
        fine: matchMedia('(pointer: fine)').matches,
        coarse: matchMedia('(pointer: coarse)').matches,
        anyFine: matchMedia('(any-pointer: fine)').matches,
        anyCoarse: matchMedia('(any-pointer: coarse)').matches,
        hover: matchMedia('(hover: hover)').matches,
        anyHover: matchMedia('(any-hover: hover)').matches
      }));

      expect(input).toEqual({
        fine: !hasTouch,
        coarse: hasTouch,
        anyFine: !hasTouch,
        anyCoarse: hasTouch,
        hover: !hasTouch,
        anyHover: !hasTouch
      });
    });
  });
}
