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

  test('is hidden on mobile, where the globe carries the section', async ({ page }) => {
    await gotoWork(page, MOBILE);
    await expect(page.locator('.work-rail')).toBeHidden();
    await expect(page.locator('#work-globe-canvas')).toHaveCount(1);
  });
});
