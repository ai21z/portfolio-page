import { test, expect } from '@playwright/test';

const DESKTOP = { width: 1366, height: 768 };
const MOBILE = { width: 390, height: 844 };

test.describe('Work career timeline', () => {
  test('renders beneath the memorandum on desktop with the real chronology', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/index.html#work');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#work.active-section')).toBeVisible();

    const timeline = page.locator('.work-timeline');
    await expect(timeline).toBeVisible();

    // The five curated milestones, in chronological order.
    const years = await page.locator('.work-timeline-item .work-timeline-year').allTextContents();
    expect(years).toEqual(['2009', '2017', '2019', '2022', '2024']);

    // The present year is the single active node.
    await expect(page.locator('.work-timeline-item--current')).toHaveCount(1);
    await expect(page.locator('.work-timeline-item--current .work-timeline-year')).toHaveText('2024');

    // The closing milestone names the current chapter and personal projects.
    const currentLabel = await page.locator('.work-timeline-item--current .work-timeline-label').textContent();
    expect(currentLabel).toContain('ADP');
    expect(currentLabel).toContain('Talos');
    expect(currentLabel).toContain('True-Rolls');

    // It sits in the memorandum's left column, strictly below it, with a small gap,
    // and stays fully inside the viewport.
    const geo = await page.evaluate(() => {
      const rect = (selector: string) => {
        const el = document.querySelector(selector);
        return el ? el.getBoundingClientRect() : null;
      };
      const memo = rect('.work-memorandum');
      const tl = rect('.work-timeline');
      if (!memo || !tl) return { ok: false } as const;
      return {
        ok: true as const,
        sameColumn: Math.abs(tl.left - memo.left) <= 1,
        below: tl.top >= memo.bottom,
        gap: tl.top - memo.bottom,
        withinViewport: tl.bottom <= window.innerHeight
      };
    });
    expect(geo.ok).toBe(true);
    if (geo.ok) {
      expect(geo.sameColumn).toBe(true);
      expect(geo.below).toBe(true);
      expect(geo.gap).toBeGreaterThan(4);
      expect(geo.gap).toBeLessThan(60);
      expect(geo.withinViewport).toBe(true);
    }
  });

  test('is hidden on mobile, where the globe and auto-writer carry the section', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto('/index.html#work');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#work.active-section')).toBeVisible();

    // Desktop-only specimen plate; the globe stays on mobile per design.
    await expect(page.locator('.work-timeline')).toBeHidden();
    await expect(page.locator('#work-globe-canvas')).toHaveCount(1);
  });
});
