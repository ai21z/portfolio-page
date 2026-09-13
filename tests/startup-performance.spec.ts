import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 412, height: 915 }, hasTouch: true, deviceScaleFactor: 2.625 });

test('mobile startup skips WebGL probes and contact verification', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', request => requests.push(request.url()));
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    (window as any).__webglRequests = 0;
    HTMLCanvasElement.prototype.getContext = function (...args: any[]) {
      if (String(args[0]).startsWith('webgl')) (window as any).__webglRequests++;
      return getContext.apply(this, args as any);
    } as typeof getContext;
  });
  await page.goto('/index.html');
  await expect(page.locator('html')).toHaveAttribute('data-graphics-effective-profile', /balanced|quiet/);
  await expect(page.locator('#threshold')).toBeHidden();
  expect(await page.evaluate(() => (window as any).__webglRequests)).toBe(0);
  expect(requests.filter(url => url.includes('challenges.cloudflare.com'))).toEqual([]);
  const portraits = requests.filter(url => url.includes('myOminousGreenPortrait'));
  expect(portraits).toHaveLength(1);
  expect(portraits[0]).toContain('myOminousGreenPortrait-800.webp');
  expect(requests.some(url => url.includes('/sigil/AZ-01.'))).toBe(false);

  await page.evaluate(() => { location.hash = 'work'; });
  await expect(page.locator('#work')).toHaveClass(/active-section/);
  await expect.poll(() => page.evaluate(() => (window as any).__webglRequests)).toBeGreaterThan(0);
});

test('contact loads and mounts verification once after opening', async ({ page }) => {
  let loads = 0;
  await page.route('https://challenges.cloudflare.com/**', route => {
    loads++;
    return route.fulfill({ contentType: 'application/javascript', body: `
      window.__verificationMounts = 0;
      window.turnstile = {
        render(container, options) {
          window.__verificationMounts++;
          options.callback('test-token');
          return 'test-widget';
        }
      };
      window.__turnstileOnLoad();
    ` });
  });
  await page.goto('/index.html');
  await expect(page.locator('#threshold')).toBeHidden();
  expect(loads).toBe(0);
  await page.evaluate(() => { location.hash = 'contact'; });
  await expect(page.getByRole('button', { name: /send message/i })).toBeEnabled();
  await page.getByLabel('Your Name').fill('Test Visitor');
  await page.evaluate(() => { location.hash = 'about'; });
  await expect(page.locator('#about')).toHaveClass(/active-section/);
  await page.evaluate(() => { location.hash = 'contact'; });
  await expect(page.getByLabel('Your Name')).toHaveValue('Test Visitor');
  expect(loads).toBe(1);
  expect(await page.evaluate(() => (window as any).__verificationMounts)).toBe(1);
});

test('a blocked verification script leaves direct email available', async ({ page }) => {
  await page.route('https://challenges.cloudflare.com/**', route => route.abort());
  await page.goto('/index.html#contact');
  await expect(page.locator('[data-status]')).toHaveText(/verification service unavailable/i);
  await expect(page.locator('[data-status] a')).toHaveAttribute('href', 'mailto:aris@zounarakis.com');
  await expect(page.getByRole('button', { name: /send message/i })).toBeDisabled();
});

test('the production stylesheet has no nested stylesheet requests', async ({ page }) => {
  const styles: string[] = [];
  page.on('request', request => {
    if (request.resourceType() === 'stylesheet') styles.push(new URL(request.url()).pathname);
  });
  await page.goto('/index.html');
  expect(styles.sort()).toEqual(['/styles/graphics-controls.css', '/styles/main.css']);
  const importedRules = await page.evaluate(() => Array.from(document.styleSheets)
    .filter(sheet => sheet.href?.includes('/styles/main.css'))
    .flatMap(sheet => Array.from(sheet.cssRules))
    .filter(rule => rule.type === CSSRule.IMPORT_RULE).length);
  expect(importedRules).toBe(0);
});

test('explicit desktop quality still checks graphics capability', async ({ browser, browserName }) => {
  test.skip(browserName === 'firefox', 'Firefox only offers Quiet and Balanced.');
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, hasTouch: false });
  try {
    await page.goto('/index.html');
    await expect(page.locator('#threshold')).toBeHidden();
    const capability = await page.evaluate(async () => {
      const governor = await import('/js/graphics-governor.js');
      const before = governor.getGraphicsState().capability.webgl2;
      governor.setGraphicsProfile('full', { persist: false });
      return { before, after: governor.getGraphicsState().capability.webgl2 };
    });
    expect(capability.before).toBeNull();
    expect(typeof capability.after).toBe('boolean');
  } finally {
    await page.close();
  }
});
