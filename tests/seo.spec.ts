import { test, expect } from '@playwright/test';

const articles = [
  { hub: 'cosmos', id: 'first-year-software-engineer', title: 'My 1st Year as a Software Engineer: Lessons Learned', date: '2023-03-21' },
  { hub: 'codex', id: 'fail-fast-learn-faster', title: 'Fail Fast, Learn Faster - Instinct, on Purpose', date: '2025-10-22' }
];

test('blog fallback keeps article discovery readable', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      if (type === 'webgl' || type === 'webgl2') return null;
      return getContext.call(this, type, ...args);
    } as typeof getContext;
  });
  await page.goto('/index.html#blog');
  const fallback = page.locator('#blog-map .webgl-fallback-visible');
  await expect(fallback).toBeVisible();
  await expect(page.locator('.blog-intro-caption')).toBeHidden();
  await expect(page.locator('.blog-reading-links')).toBeVisible();
  const notice = await fallback.boundingBox();
  const memo = await page.locator('.blog-memorandum').boundingBox();
  expect(notice!.x).toBeGreaterThanOrEqual(memo!.x + memo!.width);
  expect(memo!.y + memo!.height).toBeLessThan(768);
});

test('published articles agree across metadata, discovery links, and the sitemap', async ({ page, request }) => {
  const home = await (await request.get('/')).text();
  const sitemap = await (await request.get('/sitemap.xml')).text();
  const registry = await (await request.get('/blog/articles.json')).json();
  const discovery = await page.evaluate(({ home, sitemap }) => {
    const parser = new DOMParser();
    const html = parser.parseFromString(home, 'text/html');
    const xml = parser.parseFromString(sitemap, 'application/xml');
    return {
      person: JSON.parse(html.querySelector('script[type="application/ld+json"]')!.textContent!),
      links: Array.from(html.querySelectorAll('a[href]'), a => a.getAttribute('href')),
      urls: Array.from(xml.querySelectorAll('loc'), loc => loc.textContent),
      xmlErrors: xml.querySelectorAll('parsererror').length
    };
  }, { home, sitemap });
  expect(discovery.xmlErrors).toBe(0);
  expect(discovery.person.name).toBe('Aris Zounarakis');
  expect(discovery.person['@id']).toBe('https://zounarakis.com/#person');
  const paths = Object.entries(registry).flatMap(([hub, entries]: [string, any]) =>
    entries.map((entry: { id: string }) => `/blog/${hub}/${entry.id}`));
  expect(discovery.urls.sort()).toEqual(['https://zounarakis.com/', ...paths.map(path => `https://zounarakis.com${path}`)].sort());

  for (const article of articles) {
    const path = `/blog/${article.hub}/${article.id}`;
    const canonical = `https://zounarakis.com${path}`;
    expect(discovery.links).toContain(path);
    for (const suffix of ['', '.html']) {
      const response = await request.get(`${path}${suffix}`);
      expect(response.status()).toBe(200);
      const html = await response.text();
      const metadata = await page.evaluate(html => {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const meta = (selector: string) => doc.querySelector(selector)?.getAttribute('content');
        return {
          title: doc.title,
          h1: Array.from(doc.querySelectorAll('h1'), heading => heading.textContent),
          description: meta('meta[name="description"]'),
          author: meta('meta[name="author"]'),
          robots: meta('meta[name="robots"]'),
          canonical: Array.from(doc.querySelectorAll('link[rel="canonical"]'), link => link.getAttribute('href')),
          ogUrl: meta('meta[property="og:url"]'),
          ogTitle: meta('meta[property="og:title"]'),
          ogImage: meta('meta[property="og:image"]'),
          twitterImage: meta('meta[name="twitter:image"]'),
          byline: doc.querySelector('[rel="author"]')?.textContent,
          schema: JSON.parse(doc.querySelector('script[type="application/ld+json"]')!.textContent!),
          styles: doc.querySelectorAll('link[rel="stylesheet"]').length
        };
      }, html);
      expect(metadata.title).toBe(`${article.title} | Aris Zounarakis`);
      expect(metadata.h1).toEqual([article.title]);
      expect(metadata.description!.length).toBeGreaterThan(80);
      expect(metadata.author).toBe('Aris Zounarakis');
      expect(metadata.byline).toBe('Aris Zounarakis');
      expect(metadata.robots).not.toContain('noindex');
      expect(metadata.canonical).toEqual([canonical]);
      expect(metadata.ogUrl).toBe(canonical);
      expect(metadata.ogTitle).toBe(article.title);
      expect(metadata.twitterImage).toBe(metadata.ogImage);
      const image = await request.get(new URL(metadata.ogImage!).pathname);
      expect(image.status()).toBe(200);
      expect(image.headers()['content-type']).toMatch(/^image\//);
      expect(metadata.styles).toBe(1);
      expect(metadata.schema).toMatchObject({
        '@type': 'BlogPosting', headline: article.title, datePublished: article.date,
        mainEntityOfPage: canonical,
        author: { '@type': 'Person', '@id': discovery.person['@id'], name: 'Aris Zounarakis', url: 'https://zounarakis.com/' }
      });
    }
  }
});

for (const article of articles) {
  test(`${article.id} is readable without JavaScript on desktop and phones`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, javaScriptEnabled: false, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      const response = await page.goto(`/blog/${article.hub}/${article.id}`);
      expect(response!.status()).toBe(200);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(article.title);
      await expect(page.getByRole('link', { name: 'Aris Zounarakis', exact: true })).toBeVisible();
      const overflow = await page.evaluate(() => document.body.scrollWidth > window.innerWidth);
      expect(overflow).toBe(false);
      for (const image of await page.locator('.article-content img').all()) {
        await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
      }
      const top = page.getByRole('link', { name: 'Scroll to top' });
      await top.scrollIntoViewIfNeeded();
      await top.click();
      await expect(page.getByRole('heading', { level: 1 })).toBeInViewport();
    }
    expect(errors).toEqual([]);
    await context.close();
  });
}

test('article links retain the reader, normal link actions, and Back/Forward', async ({ page, browserName }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/index.html#blog/cosmos');
  const link = page.locator('.blog-article-item');
  await expect(link).toHaveAttribute('href', '/blog/cosmos/first-year-software-engineer');
  await expect(link).toHaveJSProperty('tagName', 'A');
  const intercepted = await link.evaluate(element => {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true });
    let prevented = false;
    element.addEventListener('click', click => {
      prevented = click.defaultPrevented;
      click.preventDefault();
    }, { once: true });
    element.dispatchEvent(event);
    return prevented;
  });
  expect(intercepted).toBe(false);
  if (browserName !== 'webkit') {
    const popupPromise = page.context().waitForEvent('page');
    await link.click({ button: 'middle' });
    const popup = await popupPromise;
    await expect(popup).toHaveURL(/\/blog\/cosmos\/first-year-software-engineer$/);
    await popup.close();
  }
  await link.focus();
  await link.press('Enter');
  await expect(page.locator('#blog-article-content h1')).toHaveText(articles[0].title);
  await expect(page).toHaveURL(/#blog\/cosmos\/first-year-software-engineer$/);
  await expect(page.locator('#blog-article-content .article-image')).toHaveJSProperty('complete', true);
  await expect(page.locator('#blog-article-content .article-permalink')).toHaveAttribute('href', /\/blog\/cosmos\/first-year-software-engineer$/);
  await page.goBack();
  await expect(page.locator('#blog-category-view')).toBeVisible();
  await expect(page.locator('#blog-article-view')).toBeHidden();
  await page.goForward();
  await expect(page.locator('#blog-article-content h1')).toHaveText(articles[0].title);
  await expect(page.locator('#blog-article-view')).toBeVisible();
});

test('old category URLs and article return links select the correct category', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/index.html#blog?hub=cosmos');
  await expect(page.locator('#blog-category-title')).toHaveText('COSMOS');
  await expect(page.locator('.blog-article-item')).toHaveCount(1);
  await page.goto('/index.html#blog/codex/fail-fast-learn-faster');
  await expect(page.locator('#blog-article-content h1')).toHaveText(articles[1].title);
  await page.locator('#blog-article-content .back-button').click();
  await expect(page).toHaveURL(/#blog\/codex$/);
  await expect(page.locator('#blog-category-title')).toHaveText('CODEX');
  await expect(page.locator('#blog-article-view')).toBeHidden();
  await page.locator('.blog-article-item').click();
  await page.locator('#blog-article-content .go-top-link').click();
  await expect.poll(() => page.locator('#blog-article-view').evaluate(element => element.scrollTop)).toBeLessThan(5);
  await expect(page).toHaveURL(/#blog\/codex\/fail-fast-learn-faster$/);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('#blog-article-view .blog-nav-link[data-hub="cosmos"]').click();
  await expect(page.locator('#blog-category-title')).toHaveText('COSMOS');
  await expect(page.locator('#blog-article-view')).toBeHidden();
});

test('article fetch failures remain recoverable', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route('**/blog/cosmos/first-year-software-engineer', route => route.fulfill({ status: 503, body: 'Unavailable' }));
  await page.goto('/index.html#blog/cosmos/first-year-software-engineer');
  await expect(page.locator('#blog-article-content')).toHaveText('This article could not be loaded. Please try again.');
  await page.locator('#blog-article-view .blog-nav-link[data-hub="cosmos"]').click();
  await expect(page.locator('#blog-category-view')).toBeVisible();
  await page.unroute('**/blog/cosmos/first-year-software-engineer');
  await page.locator('.blog-article-item').click();
  await expect(page.locator('#blog-article-content h1')).toHaveText(articles[0].title);
});
