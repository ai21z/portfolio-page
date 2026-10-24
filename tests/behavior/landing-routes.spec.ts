import { chromium, expect, test } from '@playwright/test';

// Hovering or focusing a landing label lights its whole route from the hub, grows the word, and shows
// a one-line preview of the section, which is also the link's description.

const PREVIEWS: Record<string, string> = {
  about: 'Background, values, and what I am building now.',
  skills: 'The stack I trust, and the thinking behind it.',
  work: 'Roles, projects, and credentials on a living globe.',
  blog: 'Field notes, grown in a petri dish.',
  contact: 'A notebook page that reaches me directly.'
};

test('each landing label carries its preview as its description, shown on hover and on focus', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/index.html');
  await expect(page.locator('.network-node-label')).toHaveCount(5);
  for (const [id, text] of Object.entries(PREVIEWS)) {
    const label = page.locator(`.network-node-label[data-node="${id}"]`);
    const preview = label.locator('.node-preview');
    await expect(preview).toHaveText(text);
    await expect(label).toHaveAttribute('aria-describedby', `node-preview-${id}`);
    await expect(label).toHaveAccessibleDescription(text);
  }
  const about = page.locator('.network-node-label[data-node="about"]');
  const opacity = () => about.locator('.node-preview').evaluate((el) => getComputedStyle(el).opacity);
  const word = about.locator('.node-word');
  const scale = () => word.evaluate((el) => getComputedStyle(el).scale);
  const centre = async () => { const b = (await word.boundingBox())!; return { x: b.x + b.width / 2, bottom: b.y + b.height }; };
  const rest = await centre();
  expect(await opacity()).toBe('0');
  await about.hover();
  await expect.poll(opacity).toBe('1');
  await expect.poll(scale).toBe('1.2');
  await page.waitForTimeout(500);
  // It grows from its own foot: centred where it was, its baseline where it was.
  const grown = await centre();
  expect(Math.abs(grown.x - rest.x)).toBeLessThan(1);
  expect(Math.abs(grown.bottom - rest.bottom)).toBeLessThan(1);
  await page.mouse.move(2, 2);
  await expect.poll(opacity).toBe('0');
  // Keyboard parity: the same on focus from the keyboard. WebKit leaves links out of the Tab order,
  // so a key press sets the keyboard modality and the label takes focus directly.
  await page.locator('a.skip').focus();
  await page.keyboard.press('Shift');
  await about.focus();
  await expect(about).toBeFocused();
  await expect.poll(opacity).toBe('1');
});

test('a hovered label keeps its route lit after the travelling spark has gone', async ({ browserName, baseURL }) => {
  // The spark canvas runs outside Quiet only, which needs a real GPU here.
  test.skip(browserName !== 'chromium', 'needs a GPU Chromium');
  test.setTimeout(60_000);
  const gpu = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
  try {
    const context = await gpu.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, hasTouch: false, isMobile: false, baseURL });
    const page = await context.newPage();
    await page.goto('/index.html');
    await page.waitForTimeout(6000);
    const quiet = await page.evaluate(() => document.documentElement.dataset.graphicsEffectiveProfile === 'quiet');
    test.skip(quiet, 'Quiet here, so no spark canvas');
    const lit = () => page.evaluate(() => {
      // The sparks draw on the landing's reveal canvas (js/state.js).
      const canvas = document.getElementById('reveal-canvas') as HTMLCanvasElement;
      const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      let n = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 40) n++;
      return n;
    });
    const label = page.locator('.network-node-label[data-node="skills"]');
    const box = (await label.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(1200);
    expect(await lit()).toBeGreaterThan(300);
    await page.mouse.move(2, 2);
    await expect.poll(lit, { timeout: 3000 }).toBe(0);

    // A clicked label leaves the landing with its route lit. Back on the landing it stays dark.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(400);
    await label.click();
    await expect(page.locator('#skills')).toHaveClass(/active-section/);
    await page.mouse.move(2, 2);
    await page.waitForTimeout(600);
    await page.evaluate(() => { location.hash = ''; });
    await expect(page.locator('#main')).toHaveClass(/active-section/);
    await page.waitForTimeout(120);
    expect(await lit()).toBe(0);
  } finally {
    await gpu.close();
  }
});
