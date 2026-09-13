import { expect, test } from '@playwright/test';
import { stubVerification } from './helpers/contact';

test('release pages avoid stale scripts and styles and share one governor', async ({ page }) => {
  const changed = new Set([
    '/styles/main.css', '/js/app.js', '/js/contact.js', '/js/navigation.js',
    '/js/graphics-governor.js', '/js/work-timeline.js',
    '/js/work-globe-webgl.js', '/js/work-globe/work-index.js'
  ]);
  const requests: URL[] = [];
  const stale: string[] = [];
  await stubVerification(page);
  await page.route(url => changed.has(url.pathname) && url.searchParams.get('v') !== '20260913', route => {
    stale.push(route.request().url());
    return route.fulfill({ contentType: 'application/javascript', body: 'throw new Error("Stale release asset");' });
  });
  page.on('request', request => requests.push(new URL(request.url())));
  await page.goto('/index.html');
  await expect(page.locator('#threshold')).toBeHidden();
  await page.evaluate(() => { location.hash = 'work'; });
  await expect(page.locator('#work')).toHaveClass(/active-section/);
  await expect(page.getByRole('button', { name: /2024 - present\. ADP/ })).toBeVisible();
  await expect.poll(() => requests.some(url => url.pathname === '/js/work-timeline.js')).toBe(true);
  await page.evaluate(() => { location.hash = 'contact'; });
  await expect(page.locator('#contact')).toHaveClass(/active-section/);
  await expect(page.locator('.contact-email')).toBeVisible();
  for (const pathname of ['/js/contact.js', '/js/navigation.js', '/js/graphics-governor.js']) {
    expect(requests.filter(url => url.pathname === pathname)).toHaveLength(1);
  }
  expect(requests.some(url => url.pathname === '/js/contact-attempt.js')).toBe(true);
  for (const article of ['cosmos/first-year-software-engineer', 'codex/fail-fast-learn-faster']) {
    await page.goto('/blog/' + article);
    await expect(page.locator('link[rel="stylesheet"]')).toHaveAttribute('href', '../../styles/main.css?v=20260913');
  }
  expect(stale).toEqual([]);
});
