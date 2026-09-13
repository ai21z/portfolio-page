import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { stubVerification } from '../helpers/contact';

for (const width of [390, 1366]) {
  for (const scope of ['home', 'journey']) {
    test(`browser audit: CSS coverage for ${scope} at ${width}px`, async ({ page, browserName }, testInfo) => {
      test.skip(browserName !== 'chromium', 'CSS coverage uses the Chromium profiler.');
      test.setTimeout(90000);
      await stubVerification(page);
      await page.setViewportSize({ width, height: 844 });
      await page.coverage.startCSSCoverage({ resetOnNavigation: false });
      await page.goto('/index.html');
      await expect(page.locator('html')).toHaveClass(/js-ready/);
      await expect(page.locator('#threshold')).toBeHidden();
      const states = ['home'];
      if (scope === 'journey') {
        for (const section of ['about', 'skills', 'work', 'blog', 'contact']) {
          await page.evaluate(section => { location.hash = section; }, section);
          await expect(page.locator('#' + section)).toHaveClass(/active-section/);
          if (section === 'work') await expect(page.locator('.work-rail')).toBeVisible();
          if (section === 'contact') await expect(page.locator('button[type="submit"]')).toBeEnabled();
          if (width === 1366 && ['about', 'skills'].includes(section)) {
            await page.locator(`#${section} .paper`).first().press('Enter');
            await expect(page.locator('.paper-open')).toBeVisible();
            await page.keyboard.press('Escape');
            await expect(page.locator('.paper-open')).toHaveCount(0);
          }
          states.push(section);
        }
        await page.evaluate(() => { location.hash = 'blog/cosmos/first-year-software-engineer'; });
        await expect(page.locator('#blog-article-content .article-image')).toBeVisible();
        states.push('article-reader');
      }
      const coverage = await page.coverage.stopCSSCoverage();
      const sheets = coverage.filter(sheet => sheet.url).map(sheet => ({
        path: new URL(sheet.url).pathname,
        totalCharacters: sheet.text.length,
        usedCharacters: sheet.ranges.reduce((total, range) => total + range.end - range.start, 0)
      }));
      const report = testInfo.outputPath('style-coverage.json');
      await writeFile(report, JSON.stringify({ width, states, sheets }, null, 2));
      await testInfo.attach('style-coverage.json', { path: report, contentType: 'application/json' });
      expect(sheets.some(sheet => sheet.path === '/styles/main.css' && sheet.usedCharacters > 0)).toBe(true);
    });
  }
}
