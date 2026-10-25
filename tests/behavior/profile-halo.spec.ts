import { expect, test, type Page } from '@playwright/test';

// The profile links ring the portrait (js/profile-halo.js): centred on the nose tip, the top one straight
// above it, the sides level, the bottom two lower and wider, clear of the name's letters and the bio. A
// click on the portrait draws the AZ sigil in particles and sends each link onto one of its corners.
const NOSE = [0.475, 0.504];
const CORNERS = [[96, 37], [143, 66], [141, 137], [51, 136], [49, 66]];

async function measure(page: Page) {
  return page.evaluate(() => {
    // Layout position, as the halo reads it, so the portrait's entrance scale does not count.
    const layout = (el: HTMLElement) => {
      let x = 0;
      let y = 0;
      for (let node: HTMLElement | null = el; node; node = node.offsetParent as HTMLElement | null) {
        x += node.offsetLeft;
        y += node.offsetTop;
      }
      return { left: x, top: y, width: el.offsetWidth, height: el.offsetHeight };
    };
    const links = [...document.querySelectorAll<HTMLElement>('.living-sigils .sigil-vial')].map((a) => {
      const r = a.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, left: r.left, right: r.right, top: r.top, bottom: r.bottom, corner: a.hasAttribute('data-on-corner') };
    });
    const name = document.querySelector<HTMLElement>('.name')!.getBoundingClientRect();
    return {
      halo: document.querySelector('.living-sigils')!.hasAttribute('data-halo'),
      links,
      portrait: layout(document.querySelector<HTMLElement>('.portrait')!),
      name: { top: name.top, height: name.height },
      bioTop: document.querySelector('.tape')!.getBoundingClientRect().top,
      viewport: { width: innerWidth, height: innerHeight }
    };
  });
}

for (const viewport of [
  { width: 1024, height: 600 }, { width: 1024, height: 768 }, { width: 1280, height: 720 }, { width: 1280, height: 800 },
  { width: 1366, height: 768 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }, { width: 2560, height: 1440 }
]) {
  test(`the profile links ring the portrait round the nose, clear of the name and the bio (${viewport.width}x${viewport.height})`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/index.html');
    await expect(page.locator('html')).toHaveClass(/js-ready/);
    await page.evaluate(() => document.fonts.ready);
    const m = await measure(page);
    expect(m.halo).toBe(true);
    expect(m.links).toHaveLength(5);
    const noseX = m.portrait.left + m.portrait.width * NOSE[0];
    const noseY = m.portrait.top + m.portrait.height * NOSE[1];
    const [top, right, footRight, footLeft, left] = m.links;
    expect(Math.abs(top.x - noseX), 'top link over the nose').toBeLessThan(1.5);
    expect(Math.abs((footLeft.x + footRight.x) / 2 - noseX), 'bottom pair centred on the nose').toBeLessThan(1.5);
    expect(Math.abs(footLeft.y - footRight.y), 'bottom pair level').toBeLessThan(1.5);
    expect(Math.abs(left.y - right.y), 'sides level').toBeLessThan(1.5);
    expect(footLeft.y, 'bottom pair below the nose').toBeGreaterThan(noseY);
    expect(footRight.x - footLeft.x, 'bottom pair narrower than the sides').toBeLessThan(right.x - left.x);
    expect(top.top, 'top link clear of the name\'s letters').toBeGreaterThanOrEqual(m.name.top + m.name.height * 0.72 + 8);
    for (const [i, link] of m.links.entries()) {
      expect(link.bottom, `link ${i} clear of the bio`).toBeLessThanOrEqual(m.bioTop - 12);
      expect(link.left, `link ${i} inside the window`).toBeGreaterThanOrEqual(0);
      expect(link.top, `link ${i} inside the window`).toBeGreaterThanOrEqual(0);
      expect(link.right, `link ${i} inside the window`).toBeLessThanOrEqual(m.viewport.width);
      for (const other of m.links.slice(i + 1)) expect(Math.hypot(link.x - other.x, link.y - other.y)).toBeGreaterThanOrEqual(44);
    }
  });
}

test('a click on the portrait sends the five to the sigil\'s corners, and a second click brings them back', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'The particles that draw the sigil run on the Chromium budget in this rig.');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/index.html');
  await page.waitForFunction(() => (window as any).__portraitParticleStats?.initialized && (window as any).__portraitParticleStats?.particleCount > 0, null, { timeout: 20_000 });
  const rest = (await measure(page)).links;
  const clickPortrait = async () => {
    const box = (await page.locator('.portrait').boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.45);
    await page.mouse.move(4, 4);
  };
  const offCorners = async () => {
    const m = await measure(page);
    return Math.max(...m.links.map((link, i) => Math.hypot(
      link.x - (m.portrait.left + (CORNERS[i][0] / 192) * m.portrait.width),
      link.y - (m.portrait.top + (CORNERS[i][1] / 192) * m.portrait.height))));
  };
  await clickPortrait();
  await expect.poll(offCorners, { timeout: 5000 }).toBeLessThan(2);
  expect((await measure(page)).links.every((link) => link.corner)).toBe(true);
  await clickPortrait();
  await expect.poll(async () => {
    const links = (await measure(page)).links;
    return Math.max(...links.map((link, i) => Math.hypot(link.x - rest[i].x, link.y - rest[i].y)));
  }, { timeout: 5000 }).toBeLessThan(1.5);
  expect((await measure(page)).links.some((link) => link.corner)).toBe(false);
});

test('at rest a spore draws the pentacle: the star from the first link, a lap, then the next star from the next link', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'One browser is enough for a 13 s choreography.');
  test.setTimeout(45_000);
  await page.addInitScript(() => {
    (window as any).__sporeArrivals = [];
    document.addEventListener('DOMContentLoaded', () => {
      const rail = document.querySelector<HTMLElement>('.living-sigils')!;
      new MutationObserver(() => (window as any).__sporeArrivals.push(Number(rail.dataset.sporeAt)))
        .observe(rail, { attributes: true, attributeFilter: ['data-spore-at'] });
    });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/index.html');
  await page.mouse.move(4, 4);
  // The star from link 0 (to 2, 4, 1, 3 and back to 0), the lap to link 1, the next star's first point.
  await expect.poll(() => page.evaluate(() => (window as any).__sporeArrivals.length), { timeout: 30_000 }).toBeGreaterThanOrEqual(7);
  expect((await page.evaluate(() => (window as any).__sporeArrivals)).slice(0, 7)).toEqual([2, 4, 1, 3, 0, 1, 3]);
});

test('the spore rests whenever the halo should be still: under reduced motion, in another view and while the sigil is drawn', async ({ browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'The particles that draw the sigil run on the Chromium budget in this rig.');
  const sporeShows = (page: Page) => page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.halo-spore')].some((dot) => getComputedStyle(dot).opacity !== '0'));
  const reduced = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const still = await reduced.newPage();
  await still.goto('/index.html');
  await still.waitForTimeout(4500);
  expect(await sporeShows(still), 'reduced motion').toBe(false);
  await reduced.close();

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto('/index.html');
  await page.mouse.move(4, 4);
  await expect.poll(() => sporeShows(page), { timeout: 15_000 }).toBe(true);
  await page.evaluate(() => { location.hash = 'about'; });
  await expect(page.locator('#about')).toHaveClass(/active-section/);
  await expect.poll(() => sporeShows(page)).toBe(false);
  await page.evaluate(() => { location.hash = ''; });
  await expect(page.locator('#main')).toHaveClass(/active-section/);
  await expect.poll(() => sporeShows(page), { timeout: 5000 }).toBe(true);
  await page.waitForFunction(() => (window as any).__portraitParticleStats?.initialized && (window as any).__portraitParticleStats?.particleCount > 0, null, { timeout: 20_000 });
  const box = (await page.locator('.portrait').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.45);
  await page.mouse.move(4, 4);
  await expect.poll(() => sporeShows(page)).toBe(false);
  await context.close();
});
