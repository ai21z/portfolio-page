import { expect, test, type Page } from '@playwright/test';

// The profile links stand in a column at the left edge. A click on the portrait draws the AZ sigil in
// particles and sends each link from the column onto one of its corners (js/profile-halo.js), and a
// second click sends them back into the column, where they stood.
const CORNERS = [[96, 37], [143, 66], [141, 137], [51, 136], [49, 66]];

async function measure(page: Page) {
  return page.evaluate(() => {
    // Layout position, as the script reads it, so the portrait's entrance scale does not count.
    const layout = (el: HTMLElement) => {
      let x = 0;
      let y = 0;
      for (let node: HTMLElement | null = el; node; node = node.offsetParent as HTMLElement | null) {
        x += node.offsetLeft;
        y += node.offsetTop;
      }
      return { left: x, top: y, width: el.offsetWidth, height: el.offsetHeight };
    };
    const rail = document.querySelector('.living-sigils')!;
    return {
      travelling: rail.hasAttribute('data-travel'),
      links: [...rail.querySelectorAll<HTMLElement>('.sigil-vial')].map((a) => {
        const r = a.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, corner: a.hasAttribute('data-on-corner') };
      }),
      portrait: layout(document.querySelector<HTMLElement>('.portrait')!)
    };
  });
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }]) {
  test(`a click on the portrait sends the five from the column to the sigil's corners, and a second click brings them back (${viewport.width}x${viewport.height})`, async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'The particles that draw the sigil run on the Chromium budget in this rig.');
    await page.setViewportSize(viewport);
    await page.goto('/index.html');
    await page.waitForFunction(() => (window as any).__portraitParticleStats?.initialized && (window as any).__portraitParticleStats?.particleCount > 0, null, { timeout: 20_000 });
    const rest = await measure(page);
    expect(rest.travelling).toBe(false);
    expect(new Set(rest.links.map((link) => Math.round(link.x))).size, 'one column').toBe(1);
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
    await expect.poll(async () => (await measure(page)).travelling, { timeout: 5000 }).toBe(false);
    const back = await measure(page);
    for (const [i, link] of back.links.entries()) {
      expect(Math.hypot(link.x - rest.links[i].x, link.y - rest.links[i].y), `link ${i} back in its place`).toBeLessThan(1);
      expect(link.corner).toBe(false);
    }
  });
}
