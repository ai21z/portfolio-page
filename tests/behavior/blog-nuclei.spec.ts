import { expect, test, type Page } from '@playwright/test';

// Every post is a nucleus inside its culture's hub: a link named for the post, its title shown on hover
// and focus, opened by click or Enter, and kept on its hub through zoom. The how-to line stays up until
// the dish is first explored.

async function openDish(page: Page) {
  // Headless browsers draw on a software renderer, which keeps the reduced fallback and no dish.
  await page.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext as any;
    HTMLCanvasElement.prototype.getContext = function (type: string, attrs: any) {
      if (type === 'webgl2') return orig.call(this, type, { ...(attrs || {}), failIfMajorPerformanceCaveat: false });
      return orig.call(this, type, attrs);
    };
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/index.html#blog');
  await expect(page.locator('#blog-network-canvas')).toHaveClass(/is-drawn/);
}

test('each post is a named link in its culture', async ({ page }) => {
  await openDish(page);
  const registry = await (await page.request.get('/blog/articles.json')).json();
  const posts = Object.entries(registry).flatMap(([hub, entries]: [string, any]) =>
    entries.map((post: { id: string, title: string }) => ({ hub, href: `/blog/${hub}/${post.id}`, label: `Read ${post.title}` })));
  const nuclei = page.locator('#dish-nuclei .dish-nucleus');
  await expect(nuclei).toHaveCount(posts.length);
  const items = await nuclei.evaluateAll((links) => links.map((link) => ({
    hub: link.getAttribute('data-hub'), href: link.getAttribute('href'), label: link.getAttribute('aria-label')
  })));
  expect(items).toEqual(expect.arrayContaining(posts));
  expect(items).toEqual(expect.arrayContaining([
    { hub: 'cosmos', href: '/blog/cosmos/first-year-software-engineer', label: 'Read My 1st Year as a Software Engineer, Lessons Learned' },
    { hub: 'codex', href: '/blog/codex/fail-fast-learn-faster', label: 'Read Fail Fast, Learn Faster. Instinct, on Purpose' }
  ]));
});

// Two posts in one culture sat 7 px apart, their 28 px targets on top of each other.
test('the nuclei of one culture keep their targets apart, also when the dish zooms', async ({ page }) => {
  await openDish(page);
  const centres = () => page.locator('#dish-nuclei .dish-nucleus-hit').evaluateAll((hits) => hits.map((hit) => {
    const box = hit.getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2, r: box.width / 2 };
  }));
  const closest = (points: { x: number, y: number, r: number }[]) => Math.min(...points.flatMap((a, i) =>
    points.slice(i + 1).map((b) => Math.hypot(a.x - b.x, a.y - b.y) - a.r - b.r)));
  expect(closest(await centres())).toBeGreaterThanOrEqual(0);
  const canvas = (await page.locator('#blog-network-canvas').boundingBox())!;
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  await page.mouse.wheel(0, -480);
  await page.waitForTimeout(600);
  expect(closest(await centres())).toBeGreaterThanOrEqual(0);
});

test('a nucleus names its post on hover, and Enter opens it with focus in the article', async ({ page }) => {
  await openDish(page);
  const codex = page.locator('.dish-nucleus[data-article="fail-fast-learn-faster"]');
  const title = codex.locator('.dish-nucleus-title');
  expect(await title.evaluate((el) => getComputedStyle(el).opacity)).toBe('0');
  await codex.locator('.dish-nucleus-hit').hover();
  await expect.poll(() => title.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
  await page.mouse.move(2, 2);

  await codex.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#blog-article-view')).toBeVisible();
  await expect(page.locator('#blog-article-content .article-title')).toHaveText('Fail Fast, Learn Faster. Instinct, on Purpose');
  await expect(page.locator('#blog-article-content')).toBeFocused();
  await expect(page.locator('#dish-nuclei')).toBeHidden();
});

test('a nucleus stays on its hub when the dish zooms', async ({ page }) => {
  await openDish(page);
  const hit = page.locator('.dish-nucleus[data-article="first-year-software-engineer"] .dish-nucleus-hit');
  const before = (await hit.boundingBox())!;
  const canvas = (await page.locator('#blog-network-canvas').boundingBox())!;
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  await page.mouse.wheel(0, -120);
  await expect.poll(async () => (await hit.boundingBox())!.x).not.toBe(before.x);
  // Zooming in moves a hub on the right further right.
  expect((await hit.boundingBox())!.x).toBeGreaterThan(before.x);
});

test('the how-to line stays over the drawn dish until the dish is first explored', async ({ page }) => {
  await openDish(page);
  const caption = page.locator('.blog-intro-caption');
  const opacity = () => caption.evaluate((el) => getComputedStyle(el).opacity);
  await page.waitForTimeout(1500);
  expect(await opacity()).toBe('1');
  expect(Number(await caption.evaluate((el) => getComputedStyle(el).zIndex))).toBeGreaterThan(20);
  // A pointer only crossing the dish, away from every hub and label, is not exploring.
  await page.mouse.move(600, 700);
  await page.mouse.move(610, 690);
  await page.waitForTimeout(500);
  expect(await opacity()).toBe('1');
  await page.locator('#dish-labels .arc-btn[data-hub="cosmos"]').dispatchEvent('mouseover');
  await expect.poll(opacity).toBe('0');
});

// Leaving through a nucleus cleared the dish's hover but left its rim label lit.
test('a rim label lit through a nucleus goes dark when the pointer leaves', async ({ page }) => {
  await openDish(page);
  const nucleus = page.locator('.dish-nucleus[data-article="first-year-software-engineer"] .dish-nucleus-hit');
  const rim = page.locator('#dish-labels .arc-btn[data-hub="cosmos"]');
  await nucleus.hover();
  await expect(rim).toHaveClass(/hovered/);
  await page.mouse.move(600, 700);
  await expect(rim).not.toHaveClass(/hovered/);
});

// A restored WebGL context ran the dish setup again and left a second, stale layer of nuclei.
test('a lost and restored context leaves one layer of nuclei', async ({ page }) => {
  await openDish(page);
  await page.evaluate(async () => {
    const canvas = document.getElementById('blog-network-canvas') as HTMLCanvasElement;
    const ext = canvas.getContext('webgl2')!.getExtension('WEBGL_lose_context')!;
    ext.loseContext();
    await new Promise((resolve) => setTimeout(resolve, 200));
    ext.restoreContext();
  });
  await expect(page.locator('#blog-network-canvas')).toHaveClass(/is-drawn/);
  await expect(page.locator('#dish-nuclei')).toHaveCount(1);
  const registry = await (await page.request.get('/blog/articles.json')).json();
  await expect(page.locator('.dish-nucleus')).toHaveCount(Object.values(registry).flat().length);
});
