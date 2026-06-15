import { test, expect } from '@playwright/test';

const DESKTOP = { width: 1440, height: 880 };
const MOBILE = { width: 390, height: 844 };

async function gotoWork(page, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport);
  await page.goto('/index.html#work');
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#work.active-section')).toBeVisible();
}

test.describe('Work career rail', () => {
  test('renders the full chronology, newest first, with three node types', async ({ page }) => {
    await gotoWork(page, DESKTOP);
    await expect(page.locator('.work-rail')).toBeVisible();
    await expect(page.locator('.work-rail-title')).toHaveText('Timeline');
    // the legend lives in the boxed panel
    await expect(page.locator('.work-rail-key-row')).toHaveText(['place', 'project', 'credential']);
    await page.waitForSelector('.rail-node');

    const ids = await page.locator('.rail-node').evaluateAll((els) =>
      els.map((e) => (e as HTMLElement).dataset.id));
    expect(ids.length).toBe(18);
    expect(ids[0]).toBe('adp'); // present sits at the surface
    expect(ids[ids.length - 1]).toBe('beng'); // bedrock

    expect(await page.locator('.rail-node--work').count()).toBeGreaterThanOrEqual(3);
    expect(await page.locator('.rail-node--project').count()).toBe(2);
    // credentials are the majority, shown as the lighter stratum
    expect(await page.locator('.rail-node--cert').count()).toBeGreaterThanOrEqual(8);
  });

  test('hover reveals a field-note; places invite a globe action, credentials do not', async ({ page }) => {
    await gotoWork(page, DESKTOP);
    await page.waitForSelector('.rail-node');
    const note = page.locator('.work-note');

    await page.locator('.rail-node[data-id="adp"] .rail-dot-btn').hover();
    await expect(note).toBeVisible();
    await expect(note.locator('.work-note-title')).toHaveText('ADP');
    await expect(note).toContainText('Lyric HCM');
    await expect(note.locator('.work-note-cta')).toHaveClass(/work-note-cta--live/);

    await page.locator('.rail-node[data-id="cert-oci-foundations"] .rail-dot-btn').hover();
    await expect(note.locator('.work-note-title')).toContainText('Oracle Cloud Infrastructure');
    await expect(note.locator('.work-note-cta')).not.toHaveClass(/work-note-cta--live/);
  });

  test('the field-note closes on mouse-out, even after a click (regression)', async ({ page }) => {
    await gotoWork(page, DESKTOP);
    await page.waitForSelector('.rail-node');
    const note = page.locator('.work-note');
    const adp = page.locator('.rail-node[data-id="adp"] .rail-dot-btn');

    await adp.hover();
    await expect(note).toHaveClass(/is-visible/);

    // A click drives the globe and keeps the dot highlighted, but must NOT pin the note open.
    await adp.click();
    await page.mouse.move(1240, 760);
    await expect(note).not.toHaveClass(/is-visible/);
    await expect(page.locator('.rail-node[data-id="adp"].is-selected')).toHaveCount(1);
  });

  test('clicking a place or project drives the globe; a credential does not', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    await gotoWork(page, DESKTOP);
    await page.waitForSelector('.rail-node');

    const select = (id: string) => page.evaluate((nodeId) => new Promise((res) => {
      let got: unknown = null;
      const handler = (e: Event) => { got = (e as CustomEvent).detail; };
      document.addEventListener('work-timeline:select', handler, { once: true });
      (document.querySelector(`.rail-node[data-id="${nodeId}"] .rail-dot-btn`) as HTMLElement).click();
      setTimeout(() => { document.removeEventListener('work-timeline:select', handler); res(got); }, 120);
    }), id);

    expect(await select('adp')).toEqual({ id: 'adp', target: { kind: 'location', id: 'spain' } });
    expect(await select('netcompany')).toEqual({ id: 'netcompany', target: { kind: 'location', id: 'greece' } });
    expect(await select('talos')).toEqual({ id: 'talos', target: { kind: 'moon', id: 'talos-cli' } });
    expect(await select('true-rolls')).toEqual({ id: 'true-rolls', target: { kind: 'moon', id: 'true-rolls' } });
    // a credential is note-only: no globe event fires
    expect(await select('cert-oci-foundations')).toBeNull();

    expect(pageErrors).toEqual([]);
  });

  test('re-sorts by type and by place, then back to year', async ({ page }) => {
    await gotoWork(page, DESKTOP);
    await page.waitForSelector('.rail-node');
    // default "year" layout is a flat chronology, no cluster labels
    await expect(page.locator('.rail-group')).toHaveCount(0);

    await page.locator('.work-rail-mode', { hasText: 'Type' }).click();
    await expect(page.locator('.rail-group')).toHaveText(['Roles', 'Projects', 'Credentials']);
    const typeOrder = await page.locator('.rail-node').evaluateAll((els) =>
      els.map((e) => ((e as HTMLElement).className.match(/rail-node--(\w+)/) || [])[1]));
    expect(typeOrder.slice(0, 4).every((t) => t === 'work')).toBe(true);
    expect(typeOrder.slice(4, 6).every((t) => t === 'project')).toBe(true);
    expect(typeOrder.slice(6).every((t) => t === 'cert')).toBe(true);

    await page.locator('.work-rail-mode', { hasText: 'Place' }).click();
    await expect(page.locator('.rail-group')).toHaveText(['Spain', 'Greece', 'Online']);

    await page.locator('.work-rail-mode', { hasText: 'Year' }).click();
    await expect(page.locator('.rail-group')).toHaveCount(0);
  });

  test('compact: timeline by default, tap opens a card, toggle reveals the globe', async ({ page }) => {
    await gotoWork(page, MOBILE);
    await page.waitForSelector('.rail-node');

    await expect(page.locator('.work-view-toggle')).toBeVisible();
    await expect(page.locator('#work')).toHaveClass(/work-view-timeline/);
    await expect(page.locator('.work-rail')).toBeVisible();

    // tap a place -> centered card with an X and a "see on the globe" action
    await page.locator('.rail-node[data-id="adp"] .rail-dot-btn').click();
    const card = page.locator('.work-card-backdrop');
    await expect(card).toHaveClass(/is-open/);
    await expect(page.locator('.work-card-title')).toHaveText('ADP');
    await expect(page.locator('.work-card-globe')).toHaveCount(1);
    await page.locator('.work-card-close').click();
    await expect(card).toBeHidden();

    // a credential card carries no globe action
    await page.locator('.rail-node[data-id="cert-blockchain"] .rail-dot-btn').click();
    await expect(page.locator('.work-card-title')).toHaveText('Blockchain Specialization');
    await expect(page.locator('.work-card-globe')).toHaveCount(0);
    await page.locator('.work-card-close').click();

    // toggle to the globe: rail hides, the canvas carries the section
    await page.locator('.work-view-btn[data-view="globe"]').click();
    await expect(page.locator('#work')).toHaveClass(/work-view-globe/);
    await expect(page.locator('.work-rail')).toBeHidden();
    // canvas carries the section now (it renders under real WebGL; headless falls back to 1x1)
    await expect(page.locator('#work-globe-canvas')).toHaveCount(1);
  });

  test('desktop: no toggle, and hover shows the side note rather than the card', async ({ page }) => {
    await gotoWork(page, DESKTOP);
    await page.waitForSelector('.rail-node');
    await expect(page.locator('.work-view-toggle')).toBeHidden();
    await page.locator('.rail-node[data-id="adp"] .rail-dot-btn').hover();
    await expect(page.locator('.work-note')).toHaveClass(/is-visible/);
    await expect(page.locator('.work-card-backdrop')).toBeHidden();
  });
});
