import { expect, test, type Page } from '@playwright/test';

// The landing's nutrient pulses (js/landing-pulses.js) run once the network graph exists, on Rich and
// Balanced only, and give their canvas back whenever the landing is not on screen.
const canvasState = (page: Page) => page.evaluate(() => {
  const canvas = document.getElementById('pulse-canvas') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let lit = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 8) lit++;
  return { width: canvas.width, height: canvas.height, lit };
});

async function openLanding(page: Page, profile: string) {
  await page.addInitScript((p) => localStorage.setItem('aris.graphicsProfile', p), profile);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/index.html');
  await expect(page.locator('html')).toHaveClass(/js-ready/);
}

test('pulses flow on the landing once the graph is built, leave with it and come back with it', async ({ page, browserName }) => {
  // Headless Firefox and WebKit render in software, which the governor keeps on Quiet whatever is chosen.
  test.skip(browserName !== 'chromium', 'The pulses need Balanced or Rich, which only Chromium reaches here');
  test.setTimeout(45_000);
  await openLanding(page, 'balanced');
  await expect.poll(async () => (await canvasState(page)).lit, { timeout: 20_000 }).toBeGreaterThan(20);
  expect((await canvasState(page)).width).toBeGreaterThan(100);

  await page.evaluate(() => { location.hash = 'about'; });
  await expect(page.locator('#about')).toHaveClass(/active-section/);
  await expect.poll(async () => (await canvasState(page)).width).toBe(1);

  await page.evaluate(() => { location.hash = ''; });
  await expect(page.locator('#main')).toHaveClass(/active-section/);
  await expect.poll(async () => (await canvasState(page)).lit, { timeout: 10_000 }).toBeGreaterThan(20);
});

for (const [name, setup] of [
  ['Quiet', async (page: Page) => openLanding(page, 'quiet')],
  ['reduced motion', async (page: Page) => { await page.emulateMedia({ reducedMotion: 'reduce' }); await openLanding(page, 'balanced'); }]
] as const) {
  test(`no pulses under ${name}`, async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Only Chromium reaches Balanced here, so only there would the pulses run');
    test.setTimeout(30_000);
    await setup(page);
    // Quiet and reduced motion skip the idle warm-up, so a hover is what would build the graph (Quiet
    // builds it then, reduced motion never needs it). Past the warm-up's start, still no pulse.
    await page.locator('.network-node-label[data-node="about"]').hover();
    await page.waitForTimeout(7000);
    expect(await canvasState(page)).toMatchObject({ width: 1, height: 1, lit: 0 });
  });
}
