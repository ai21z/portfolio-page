import { expect, test, type Page } from '@playwright/test';

// A landing node's click flies into its branch and opens the section through a lens (js/grow-transition.js). It
// must always end where the router says: cleanly when left alone, at once when any other route change
// comes mid-way, and never at all under reduced motion or Quiet.
const leftovers = (page: Page) => page.evaluate(() => ({
  layer: document.querySelectorAll('.grow-transition-layer, .grow-transition-flight').length,
  backdrop: document.getElementById('bg')!.style.opacity,
  growing: document.body.classList.contains('grow-transition'),
  inline: [...document.querySelectorAll<HTMLElement>('.stage')]
    .filter((s) => s.style.clipPath || s.style.opacity || s.style.contentVisibility).map((s) => s.id)
}));

// The pieces of a section building in as the front reaches them, started through Element.animate.
const arrivals = (page: Page, section: string) => page.evaluate((id) => document.getAnimations()
  .filter((a) => a.constructor === Animation && document.getElementById(id)!.contains((a.effect as KeyframeEffect).target)).length, section);

async function landing(page: Page, profile = 'balanced') {
  await page.addInitScript((p) => localStorage.setItem('aris.graphicsProfile', p), profile);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/index.html');
  await expect(page.locator('html')).toHaveClass(/js-ready/);
  await expect(page.locator('#threshold')).toHaveClass(/threshold--lifted/);
  await page.mouse.move(5, 5);
}

test.describe('the landing transition', () => {
  // Headless Firefox and WebKit render in software, which the governor keeps on Quiet: the plain switch.
  test.skip(({ browserName }) => browserName !== 'chromium', 'Only Chromium reaches Balanced here');

  test('a node grows into its section and leaves nothing behind', async ({ page }) => {
    await landing(page);
    const before = await page.evaluate(() => history.length);
    await page.locator('.network-node-label[data-node="about"]').click();
    // Mid-way: the layer is up, the section is already the active one, behind its lens.
    await expect(page.locator('.grow-transition-layer')).toHaveCount(1);
    await expect(page.locator('#about')).toHaveClass(/active-section/);
    expect(await page.locator('#about').evaluate((el) => el.style.clipPath)).toMatch(/polygon/);
    // The cards and the ring build in as the front reaches them, and settle.
    await expect.poll(() => arrivals(page, 'about')).toBeGreaterThanOrEqual(5);
    // Done well inside 0.9 s of motion, with nothing left over.
    await expect.poll(() => leftovers(page), { timeout: 2000 }).toEqual({ layer: 0, backdrop: '', growing: false, inline: [] });
    await expect.poll(() => arrivals(page, 'about'), { timeout: 3000 }).toBe(0);
    await expect(page).toHaveURL(/#about$/);
    expect(await page.evaluate(() => history.length)).toBe(before + 1);
    expect(await page.evaluate(() => document.getElementById('about')!.contains(document.activeElement))).toBe(true);
    await expect.poll(() => page.locator('#main').evaluate((el) => getComputedStyle(el).opacity)).toBe('0');
  });

  test('Back mid-way ends it at once on the landing', async ({ page }) => {
    await landing(page);
    await page.locator('.network-node-label[data-node="work"]').click();
    await expect(page.locator('.grow-transition-layer')).toHaveCount(1);
    await page.goBack();
    await expect(page.locator('#main')).toHaveClass(/active-section/);
    expect(await leftovers(page)).toEqual({ layer: 0, backdrop: '', growing: false, inline: [] });
    await expect.poll(() => page.locator('#main').evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    await expect.poll(() => page.locator('#work').evaluate((el) => getComputedStyle(el).opacity)).toBe('0');
  });

  test('another route mid-way ends it at once where that route goes', async ({ page }) => {
    await landing(page);
    await page.locator('.network-node-label[data-node="about"]').click();
    await expect(page.locator('.grow-transition-layer')).toHaveCount(1);
    await page.evaluate(() => { location.hash = 'contact'; });
    await expect(page.locator('#contact')).toHaveClass(/active-section/);
    expect(await leftovers(page)).toEqual({ layer: 0, backdrop: '', growing: false, inline: [] });
    await expect.poll(() => page.locator('#about').evaluate((el) => getComputedStyle(el).opacity)).toBe('0');
  });

  test('a move between two sections spreads in from the press and leaves nothing behind', async ({ page }) => {
    await landing(page);
    await page.locator('.network-node-label[data-node="about"]').click();
    await expect.poll(() => leftovers(page), { timeout: 4000 }).toEqual({ layer: 0, backdrop: '', growing: false, inline: [] });
    await page.locator('#about .section-nav-link[data-section="skills"]').click();
    await expect(page.locator('#skills')).toHaveClass(/active-section/);
    await expect(page.locator('.grow-transition-layer')).toHaveCount(1);
    expect(await page.locator('#skills').evaluate((el) => el.style.clipPath)).toMatch(/polygon/);
    expect(await arrivals(page, 'skills')).toBeGreaterThanOrEqual(5);
    // Software rendering with four workers can hold either move past 2 s. What is checked here is that it ends.
    await expect.poll(() => leftovers(page), { timeout: 4000 }).toEqual({ layer: 0, backdrop: '', growing: false, inline: [] });
    await expect(page).toHaveURL(/#skills$/);
  });

  test('the first landing grows the network out of the hub, once a visit', async ({ page }) => {
    const layers = () => page.evaluate(() => ['bg', 'reveal-canvas'].map((id) => document.getElementById(id)!.style.clipPath));
    // The section labels are never clipped, so the way on stands from the first frame.
    const nav = () => page.evaluate(() => document.getElementById('network-nav')!.style.clipPath);
    await landing(page);
    const spores = () => page.evaluate(() => { const s = document.getElementById('spore-canvas')!.style; return [s.visibility, s.opacity, s.transition]; });
    await expect.poll(async () => (await layers()).every((clip) => /polygon/.test(clip))).toBe(true);
    // The spores wait out of sight while it grows, then fade in and leave no inline style behind.
    expect((await spores())[0]).toBe('hidden');
    expect(await nav()).toBe('');
    // The words stand at full contrast and take their glow one by one as the front reaches them, then the
    // marks are cleared.
    const label = page.locator('.network-node-label[data-node="contact"]');
    const glow = () => label.locator('.node-label').evaluate((el) => getComputedStyle(el).textShadow);
    expect(await glow()).toBe('none');
    // Past their own fade in on load, not held back for the growth.
    await expect.poll(() => label.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    await expect(page.locator('#network-nav .is-awake').first()).toBeAttached({ timeout: 4000 });
    await expect.poll(layers, { timeout: 6000 }).toEqual(['', '']);
    await expect(page.locator('.grow-transition-layer')).toHaveCount(0);
    await expect.poll(spores, { timeout: 2000 }).toEqual(['', '', '']);
    await expect(page.locator('#network-nav .is-awake')).toHaveCount(0);
    await expect(page.locator('body')).not.toHaveClass(/is-inoculating/);
    await expect.poll(glow).not.toBe('none');
    await page.reload();
    await expect(page.locator('#threshold')).toHaveClass(/threshold--lifted/);
    expect(await layers()).toEqual(['', '']);
  });

  for (const [name, setup] of [
    ['reduced motion', async (page: Page) => { await page.emulateMedia({ reducedMotion: 'reduce' }); await landing(page); }],
    ['Quiet', async (page: Page) => landing(page, 'quiet')]
  ] as const) {
    test(`${name} keeps the plain switch`, async ({ page }) => {
      await setup(page);
      await page.evaluate(() => {
        (window as any).__layers = 0;
        new MutationObserver(() => { if (document.querySelector('.grow-transition-layer')) (window as any).__layers++; })
          .observe(document.body, { childList: true });
      });
      await page.locator('.network-node-label[data-node="skills"]').click();
      await expect(page.locator('#skills')).toHaveClass(/active-section/);
      await page.waitForTimeout(900);
      expect(await page.evaluate(() => (window as any).__layers)).toBe(0);
      expect(await leftovers(page)).toEqual({ layer: 0, backdrop: '', growing: false, inline: [] });
    });
  }
});
