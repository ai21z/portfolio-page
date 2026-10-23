import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { stubVerification } from './helpers/contact';

const token = (body: Buffer) => createHash('sha256').update(body).digest('hex').slice(0, 12);

test('every module and stylesheet is requested with the token of its own bytes, and loads once', async ({ page, baseURL }) => {
  // The build sets each ?v= from the file's content (scripts/build-site.mjs), so a stale copy is
  // never requested under the current address, and no token is kept by hand.
  const checks: Promise<string | null>[] = [];
  const urls: URL[] = [];
  await stubVerification(page);
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.origin !== new URL(baseURL!).origin || !/^\/(js|styles)\//.test(url.pathname)) return;
    urls.push(url);
    checks.push(response.body().then(body => {
      const v = url.searchParams.get('v');
      return v === token(body) ? null : `${url.pathname}: v=${v}, content token ${token(body)}`;
    }, () => null));
  });
  await page.goto('/index.html');
  await expect(page.locator('#threshold')).toBeHidden();
  await page.evaluate(() => { location.hash = 'work'; });
  await expect(page.locator('#work')).toHaveClass(/active-section/);
  await expect(page.getByRole('button', { name: /2024 - present\. ADP/ })).toBeVisible();
  await page.evaluate(() => { location.hash = 'blog'; });
  await expect(page.locator('#blog')).toHaveClass(/active-section/);
  await expect.poll(() => urls.some(url => url.pathname === '/js/blog-network-webgl.js')).toBe(true);
  await page.evaluate(() => { location.hash = 'contact'; });
  await expect(page.locator('#contact')).toHaveClass(/active-section/);
  await expect(page.locator('.contact-email')).toBeVisible();
  expect((await Promise.all(checks)).filter(Boolean)).toEqual([]);
  const perPath = new Map<string, Set<string>>();
  for (const url of urls) perPath.set(url.pathname, (perPath.get(url.pathname) || new Set()).add(url.search));
  for (const [pathname, searches] of perPath) expect(searches.size, pathname).toBe(1);
  for (const pathname of ['/js/contact.js', '/js/navigation.js', '/js/graphics-governor.js',
    '/js/social-icons-animation.js', '/js/hub-to-icons.js', '/js/portrait-particles.js', '/js/work-globe-webgl.js']) {
    expect(urls.filter(url => url.pathname === pathname), pathname).toHaveLength(1);
  }
  expect(urls.some(url => url.pathname === '/js/contact-attempt.js')).toBe(true);
});

test('article pages load the same versioned stylesheet as the app', async ({ page, request }) => {
  const home = await (await request.get('/index.html')).text();
  const appSheet = home.match(/href="\.\/styles\/main\.css\?v=([a-f0-9]{12})"/)?.[1];
  expect(appSheet).toBeTruthy();
  for (const article of ['cosmos/first-year-software-engineer', 'codex/fail-fast-learn-faster']) {
    await page.goto('/blog/' + article);
    await expect(page.locator('link[rel="stylesheet"]')).toHaveAttribute('href', `../../styles/main.css?v=${appSheet}`);
  }
});
