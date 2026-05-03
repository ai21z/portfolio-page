import { expect, test, type Page } from '@playwright/test';

const successTurnstileStub = `
  window.turnstile = {
    render: function (container, options) {
      setTimeout(function () {
        if (options && typeof options.callback === 'function') {
          options.callback('test-turnstile-token');
        }
      }, 10);
      return 'stub-widget';
    },
    execute: function () {},
    reset: function () {},
    remove: function () {}
  };
  if (typeof window.__turnstileOnLoad === 'function') {
    window.__turnstileOnLoad();
  } else {
    document.dispatchEvent(new CustomEvent('turnstile-loaded'));
  }
`;

const unavailableTurnstileStub = `
  if (typeof window.__turnstileOnLoad === 'function') {
    window.__turnstileOnLoad();
  } else {
    document.dispatchEvent(new CustomEvent('turnstile-loaded'));
  }
`;

const pendingTurnstileStub = `
  window.__releaseTurnstileToken = null;
  window.turnstile = {
    render: function (container, options) {
      window.__releaseTurnstileToken = function () {
        if (options && typeof options.callback === 'function') {
          options.callback('test-turnstile-token');
        }
      };
      return 'stub-widget';
    },
    execute: function () {},
    reset: function () {},
    remove: function () {}
  };
  if (typeof window.__turnstileOnLoad === 'function') {
    window.__turnstileOnLoad();
  } else {
    document.dispatchEvent(new CustomEvent('turnstile-loaded'));
  }
`;

async function routeTurnstile(page: Page, body = successTurnstileStub) {
  await page.unroute('https://challenges.cloudflare.com/**').catch(() => undefined);
  await page.route('https://challenges.cloudflare.com/**', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body
    });
  });
}

async function waitForActiveSection(page: Page, id: string) {
  await page.waitForFunction((sectionId) => {
    const section = document.getElementById(sectionId);
    return !!section && section.classList.contains('active-section');
  }, id);
}

async function controlsOverlap(page: Page, firstSelector: string, secondSelector: string) {
  return page.evaluate(({ firstSelector, secondSelector }) => {
    const first = document.querySelector(firstSelector);
    const second = document.querySelector(secondSelector);
    if (!first || !second) return false;
    const firstRect = first.getBoundingClientRect();
    const secondRect = second.getBoundingClientRect();
    return !(
      firstRect.right <= secondRect.left ||
      firstRect.left >= secondRect.right ||
      firstRect.bottom <= secondRect.top ||
      firstRect.top >= secondRect.bottom
    );
  }, { firstSelector, secondSelector });
}

async function textOnlyCloseStyle(page: Page, selector: string) {
  return page.locator(selector).evaluate((button) => {
    const style = getComputedStyle(button);
    const rect = button.getBoundingClientRect();
    return {
      backgroundColor: style.backgroundColor,
      borderTopStyle: style.borderTopStyle,
      borderTopWidth: style.borderTopWidth,
      borderRadius: style.borderRadius,
      color: style.color,
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    };
  });
}

async function openBlogHub(page: Page, hubId: string) {
  const rimButton = page.locator(`.arc-btn[data-hub="${hubId}"]`);
  if (await rimButton.count()) {
    await rimButton.press('Enter');
  } else {
    await page.locator(`.blog-memo-item[data-hub="${hubId}"]`).press('Enter');
  }
}

test.beforeEach(async ({ page }) => {
  await routeTurnstile(page);
});

test('Blog category and article modes keep a visible top-level close button', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/index.html#blog');
  await page.waitForLoadState('domcontentloaded');
  await waitForActiveSection(page, 'blog');

  await openBlogHub(page, 'cosmos');
  await expect(page).toHaveURL(/#blog\/cosmos$/);
  await expect(page.locator('#blog-category-view')).toBeVisible();
  await expect(page.locator('#blog .blog-close')).toBeVisible();

  const firstArticle = page.locator('#blog-category-view .blog-article-item').first();
  await expect(firstArticle).toBeVisible();
  await firstArticle.click();
  await expect(page).toHaveURL(/#blog\/cosmos\/.+/);
  await expect(page.locator('#blog-article-view')).toBeVisible();
  await expect(page.locator('#blog .blog-close')).toBeVisible();

  await page.locator('#blog .blog-close').click();
  await waitForActiveSection(page, 'main');
  await expect.poll(() => new URL(page.url()).hash).toBe('');
});

test('Blog mobile deep-view controls do not overlap', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/index.html#blog');
  await page.waitForLoadState('domcontentloaded');
  await waitForActiveSection(page, 'blog');

  await page.locator('.slide-cosmos').click();
  await expect(page).toHaveURL(/#blog\/cosmos$/);
  await expect(page.locator('#blog-category-view')).toBeVisible();
  await expect(page.locator('#blog .blog-close')).toBeVisible();
  await expect(page.locator('#btn-map-category')).toBeVisible();
  await expect(await controlsOverlap(page, '#blog .blog-close', '#btn-map-category')).toBe(false);

  const firstArticle = page.locator('#blog-category-view .blog-article-item').first();
  await expect(firstArticle).toBeVisible();
  await firstArticle.click();
  await expect(page).toHaveURL(/#blog\/cosmos\/.+/);
  await expect(page.locator('#blog-article-view')).toBeVisible();
  await expect(page.locator('#blog .blog-close')).toBeVisible();
  await expect(page.locator('#btn-map-article')).toBeVisible();
  await expect(await controlsOverlap(page, '#blog .blog-close', '#btn-map-article')).toBe(false);
});

test('Blog mobile article typography uses a compact reading scale', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/index.html#blog');
  await page.waitForLoadState('domcontentloaded');
  await waitForActiveSection(page, 'blog');

  await page.locator('.slide-cosmos').click();
  await expect(page).toHaveURL(/#blog\/cosmos$/);
  await page.locator('#blog-category-view .blog-article-item').first().click();
  await expect(page).toHaveURL(/#blog\/cosmos\/.+/);
  await expect(page.locator('#blog-article-view')).toBeVisible();

  const titleMetrics = await page.locator('#blog-article-content h1').evaluate((title) => {
    const style = getComputedStyle(title);
    const rect = title.getBoundingClientRect();
    return {
      fontSize: parseFloat(style.fontSize),
      lineHeight: parseFloat(style.lineHeight),
      height: Math.round(rect.height)
    };
  });

  const paragraphLineHeight = await page.locator('#blog-article-content p').first().evaluate((paragraph) => {
    return parseFloat(getComputedStyle(paragraph).lineHeight);
  });

  expect(titleMetrics.fontSize).toBeLessThanOrEqual(34);
  expect(titleMetrics.lineHeight).toBeLessThanOrEqual(42);
  expect(titleMetrics.height).toBeLessThanOrEqual(230);
  expect(paragraphLineHeight).toBeLessThanOrEqual(28);
  await expect(await controlsOverlap(page, '.graphics-control', '#blog-article-content p')).toBe(false);
});

test('mobile intro sigil has a visible menu affordance and clean accessible name', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/index.html');
  await page.waitForLoadState('domcontentloaded');
  await waitForActiveSection(page, 'main');

  const sigil = page.locator('#myco-sigil-btn');
  await expect(sigil).toBeVisible();
  await expect(sigil).toHaveAttribute('aria-label', 'Open menu');
  await expect(sigil.locator('img')).toHaveAttribute('alt', '');
  await expect(sigil.locator('.myco-sigil-label')).toHaveText('MENU');
  await expect(sigil.locator('.myco-sigil-label')).toBeVisible();
  await expect(sigil.locator('.myco-sigil-label textPath')).toHaveText('MENU');
  await expect(await controlsOverlap(page, '.graphics-control', '.foot')).toBe(false);

  await sigil.click();
  await expect(sigil).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#necro-menu')).toBeVisible();
  await page.locator('#necro-menu [data-close]').click();
  await expect(sigil).toHaveAttribute('aria-expanded', 'false');
});

test('narrow mobile intro keeps visible hero elements inside the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/index.html');
  await page.waitForLoadState('domcontentloaded');
  await waitForActiveSection(page, 'main');

  const overflow = await page.evaluate(() => {
    const selectors = ['.living-sigils', '.myco-strip', '.name', '.portrait-wrap'];
    return selectors
      .map((selector) => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        const visible = rect.width > 0
          && rect.height > 0
          && style.display !== 'none'
          && style.visibility !== 'hidden'
          && Number(style.opacity || '1') > 0.05;
        return {
          selector,
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          visible
        };
      })
      .filter((rect): rect is NonNullable<typeof rect> => Boolean(rect?.visible))
      .filter((rect) => rect.left < -1 || rect.right > window.innerWidth + 1);
  });

  expect(overflow).toEqual([]);
});

test('mobile touch controls expose comfortable hit targets', async ({ browser, browserName }) => {
  test.skip(browserName === 'firefox', 'Firefox Playwright does not support isMobile contexts.');

  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true
  });
  const page = await context.newPage();
  await routeTurnstile(page);

  await page.goto('/index.html');
  await page.waitForLoadState('domcontentloaded');
  await waitForActiveSection(page, 'main');

  const undersizedTargets = await page.evaluate(() => {
    const selectors = [
      '.graphics-control__info',
      '.graphics-control__toggle',
      '.foot a[href^="mailto:"]'
    ];
    return selectors
      .map((selector) => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          selector,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          visible: rect.width > 0
            && rect.height > 0
            && style.display !== 'none'
            && style.visibility !== 'hidden'
        };
      })
      .filter((target): target is NonNullable<typeof target> => Boolean(target?.visible))
      .filter((target) => target.width < 44 || target.height < 44);
  });

  expect(undersizedTargets).toEqual([]);
  await context.close();
});

test('tablet section navigation stays fully inside the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/index.html#about');
  await page.waitForLoadState('domcontentloaded');
  await waitForActiveSection(page, 'about');

  const navRect = await page.locator('#about .section-nav').evaluate((nav) => {
    const rect = nav.getBoundingClientRect();
    return {
      top: Math.round(rect.top),
      bottom: Math.round(rect.bottom),
      height: Math.round(rect.height)
    };
  });

  expect(navRect.top).toBeGreaterThanOrEqual(16);
  expect(navRect.bottom).toBeLessThanOrEqual(768 - 16);
});

test('Now card dialogs expose an X button while preserving re-click close', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/index.html#now');
  await page.waitForLoadState('domcontentloaded');
  await waitForActiveSection(page, 'now');

  const firstCard = page.locator('#now-card-grid .now-card').first();
  const firstFront = firstCard.locator('.now-card-front');
  await expect(firstFront).toBeVisible();

  await firstFront.click();
  await expect(firstCard).toHaveClass(/active/);
  await expect(firstCard.locator('.now-card-close')).toBeVisible();
  const closeStyle = await textOnlyCloseStyle(page, '#now-card-grid .now-card.active .now-card-close');
  expect(closeStyle.backgroundColor).toBe('rgba(0, 0, 0, 0)');
  expect(closeStyle.borderTopStyle).toBe('none');
  expect(closeStyle.borderTopWidth).toBe('0px');
  expect(closeStyle.borderRadius).toBe('0px');
  expect(closeStyle.width).toBeLessThanOrEqual(30);
  expect(closeStyle.height).toBeLessThanOrEqual(30);

  await firstCard.locator('.now-card-close').click();
  await expect(firstCard).not.toHaveClass(/active/);

  await firstFront.click();
  await expect(firstCard).toHaveClass(/active/);
  await firstFront.click({ force: true });
  await expect(firstCard).not.toHaveClass(/active/);
});

test('paper cards expose text-only X buttons and keep re-click close', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/index.html#about');
  await page.waitForLoadState('domcontentloaded');
  await waitForActiveSection(page, 'about');

  const firstPaper = page.locator('#about .paper').first();
  await expect(firstPaper).toBeVisible();
  await firstPaper.click();
  await expect(page.locator('body > .paper.paper-open')).toBeVisible();
  await expect(page.locator('body > .paper.paper-open .paper-card-close')).toBeVisible();

  const closeStyle = await textOnlyCloseStyle(page, 'body > .paper.paper-open .paper-card-close');
  expect(closeStyle.backgroundColor).toBe('rgba(0, 0, 0, 0)');
  expect(closeStyle.borderTopStyle).toBe('none');
  expect(closeStyle.borderTopWidth).toBe('0px');
  expect(closeStyle.borderRadius).toBe('0px');
  expect(closeStyle.width).toBeLessThanOrEqual(30);
  expect(closeStyle.height).toBeLessThanOrEqual(30);

  await page.locator('body > .paper.paper-open .paper-card-close').click();
  await expect(page.locator('body > .paper.paper-open')).toHaveCount(0);

  await page.locator('#about .paper').first().click();
  await expect(page.locator('body > .paper.paper-open')).toBeVisible();
  await page.locator('body > .paper.paper-open').click({ force: true });
  await expect(page.locator('body > .paper.paper-open')).toHaveCount(0);
});

test('page close and section navigation close child overlays', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/index.html#now');
  await page.waitForLoadState('domcontentloaded');
  await waitForActiveSection(page, 'now');

  const firstNowCard = page.locator('#now-card-grid .now-card').first();
  await firstNowCard.locator('.now-card-front').click();
  await expect(firstNowCard).toHaveClass(/active/);
  await page.locator('#now [data-action="go-intro"]').click();
  await waitForActiveSection(page, 'main');
  await expect(firstNowCard).not.toHaveClass(/active/);

  await page.locator('.network-node-label[data-node="about"]').click();
  await waitForActiveSection(page, 'about');
  await page.locator('#about .paper').first().click();
  await expect(page.locator('body > .paper.paper-open')).toBeVisible();
  await page.locator('#about .section-nav-link[data-section="skills"]').click();
  await waitForActiveSection(page, 'skills');
  await expect(page.locator('body > .paper.paper-open')).toHaveCount(0);
  await expect(page.locator('body')).not.toHaveClass(/has-paper-open-global/);

  await page.evaluate(() => {
    const locationInfo = document.createElement('div');
    locationInfo.className = 'work-location-info visible';
    document.body.appendChild(locationInfo);
    const projectPanel = document.createElement('div');
    projectPanel.className = 'project-panel visible';
    document.body.appendChild(projectPanel);
  });

  await page.locator('#skills .section-nav-link[data-section="contact"]').click();
  await waitForActiveSection(page, 'contact');
  await expect(page.locator('.work-location-info.visible')).toHaveCount(0);
  await expect(page.locator('.project-panel.visible')).toHaveCount(0);
});

test('visible Now card actions are not placeholder hash links', async ({ page }) => {
  await page.goto('/index.html#now');
  await page.waitForLoadState('domcontentloaded');
  await waitForActiveSection(page, 'now');

  const cardCount = await page.locator('#now-card-grid .now-card').count();
  for (let index = 0; index < cardCount; index += 1) {
    const card = page.locator('#now-card-grid .now-card').nth(index);
    await card.locator('.now-card-front').click();

    const links = await card.locator('.now-card-link').evaluateAll((anchors) => {
      return anchors
        .filter((anchor) => {
          const rect = anchor.getBoundingClientRect();
          const style = getComputedStyle(anchor);
          return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
        })
        .map((anchor) => ({
          text: anchor.textContent?.trim() || '',
          href: (anchor as HTMLAnchorElement).getAttribute('href') || ''
        }));
    });

    expect(links, `card ${index} links`).not.toContainEqual(expect.objectContaining({ href: '#' }));
    await page.keyboard.press('Escape');
    await expect(card).not.toHaveClass(/active/);
  }
});

test('Contact disables submit until required verification is ready', async ({ page }) => {
  await routeTurnstile(page, pendingTurnstileStub);

  await page.goto('/index.html#contact');
  await page.waitForLoadState('domcontentloaded');
  await waitForActiveSection(page, 'contact');

  const submit = page.getByRole('button', { name: /send message/i });
  await expect(submit).toBeDisabled();

  await page.evaluate(() => {
    (window as Window & { __releaseTurnstileToken?: () => void }).__releaseTurnstileToken?.();
  });

  await expect(submit).toBeEnabled();
});

test('Contact shows an actionable unavailable state when Turnstile cannot mount', async ({ page }) => {
  await routeTurnstile(page, unavailableTurnstileStub);

  await page.goto('/index.html#contact');
  await page.waitForLoadState('domcontentloaded');
  await waitForActiveSection(page, 'contact');
  await page.evaluate(() => {
    document.dispatchEvent(new CustomEvent('turnstile-loaded'));
  });

  await expect(page.locator('[data-status]')).toHaveText(/verification .*unavailable/i);
  await expect(page.getByRole('button', { name: /send message/i })).toBeDisabled();
});

test('inactive intro canvas buffers are released outside the intro section and restored on return', async ({ page }) => {
  await page.goto('/index.html');
  await page.waitForLoadState('domcontentloaded');
  await waitForActiveSection(page, 'main');

  await expect.poll(() => page.locator('#reveal-canvas').evaluate((canvas: HTMLCanvasElement) => canvas.width)).toBeGreaterThan(100);
  await expect.poll(() => page.locator('#spore-canvas').evaluate((canvas: HTMLCanvasElement) => canvas.width)).toBeGreaterThan(100);

  await page.locator('.network-node-label[data-node="contact"]').click();
  await waitForActiveSection(page, 'contact');

  await expect.poll(() => page.locator('#reveal-canvas').evaluate((canvas: HTMLCanvasElement) => canvas.width)).toBeLessThanOrEqual(1);
  await expect.poll(() => page.locator('#spore-canvas').evaluate((canvas: HTMLCanvasElement) => canvas.width)).toBeLessThanOrEqual(1);

  await page.locator('#contact [data-action="go-intro"]').click();
  await waitForActiveSection(page, 'main');

  await expect.poll(() => page.locator('#reveal-canvas').evaluate((canvas: HTMLCanvasElement) => canvas.width)).toBeGreaterThan(100);
  await expect.poll(() => page.locator('#spore-canvas').evaluate((canvas: HTMLCanvasElement) => canvas.width)).toBeGreaterThan(100);
});

test('quiet graphics profile releases intro spore buffers and balanced restores them', async ({ page }) => {
  await page.goto('/index.html');
  await page.waitForLoadState('domcontentloaded');
  await waitForActiveSection(page, 'main');

  await expect.poll(() => page.locator('#spore-canvas').evaluate((canvas: HTMLCanvasElement) => canvas.width)).toBeGreaterThan(100);

  await page.evaluate(async () => {
    const governor = await import('/js/graphics-governor.js');
    governor.setGraphicsProfile('quiet', { persist: false });
  });
  await expect(page.locator('html')).toHaveAttribute('data-graphics-effective-profile', 'quiet');
  await expect.poll(() => page.locator('#spore-canvas').evaluate((canvas: HTMLCanvasElement) => canvas.width)).toBeLessThanOrEqual(1);

  await page.evaluate(async () => {
    const governor = await import('/js/graphics-governor.js');
    governor.setGraphicsProfile('balanced', { persist: false });
  });
  await expect(page.locator('html')).toHaveAttribute('data-graphics-profile', 'balanced');
  const effectiveProfile = await page.locator('html').getAttribute('data-graphics-effective-profile');
  if (effectiveProfile === 'quiet') {
    await expect.poll(() => page.locator('#spore-canvas').evaluate((canvas: HTMLCanvasElement) => canvas.width)).toBeLessThanOrEqual(1);
  } else {
    await expect.poll(() => page.locator('#spore-canvas').evaluate((canvas: HTMLCanvasElement) => canvas.width)).toBeGreaterThan(100);
  }
});

test('section navigation creates browser history entries for back and forward traversal', async ({ page }) => {
  await page.goto('/index.html#about');
  await page.waitForLoadState('domcontentloaded');
  await waitForActiveSection(page, 'about');

  await page.locator('#about .section-nav-link[data-section="skills"]').click();
  await waitForActiveSection(page, 'skills');
  await expect(page).toHaveURL(/#skills$/);

  await page.locator('#skills .section-nav-link[data-section="work"]').click();
  await waitForActiveSection(page, 'work');
  await expect(page).toHaveURL(/#work$/);

  await page.goBack();
  await waitForActiveSection(page, 'skills');
  await expect(page).toHaveURL(/#skills$/);

  await page.goBack();
  await waitForActiveSection(page, 'about');
  await expect(page).toHaveURL(/#about$/);

  await page.goForward();
  await waitForActiveSection(page, 'skills');
  await expect(page).toHaveURL(/#skills$/);
});
