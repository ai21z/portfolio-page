import { test, expect, type Page } from '@playwright/test';

const DESKTOP = { width: 1440, height: 880 };
const MOBILE = { width: 390, height: 844 };

const turnstileStubScript = `
  window.turnstile = {
    render: function (container, options) {
      if (options && typeof options.callback === 'function') {
        options.callback('test-turnstile-token');
      }
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

async function routeTurnstile(page: Page) {
  await page.route('https://challenges.cloudflare.com/**', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: turnstileStubScript
    });
  });
}

async function gotoWork(page, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport);
  await page.goto('/index.html#work');
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#work.active-section')).toBeVisible();
  // Hover tests need a still rail. A late web-font swap or the rail's entrance animation can move a
  // neighbouring node under a stationary pointer, and Firefox then fires mouseenter on it (without
  // a pointer event), so the note shows the wrong entry.
  await page.evaluate(async () => {
    await document.fonts.ready;
    const rail = document.querySelector('.work-rail');
    const finite = rail ? rail.getAnimations({ subtree: true })
      .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity) : [];
    await Promise.all(finite.map((a) => a.finished.catch(() => undefined)));
  });
}

test.describe('Work career rail', () => {
  test.beforeEach(async ({ page }) => {
    await routeTurnstile(page);
    await page.addInitScript(() => {
      (window as any).__railEvents = [];
      for (const type of ['pointerover', 'pointerout', 'click', 'focusin', 'focusout']) {
        document.addEventListener(type, event => {
          const target = event.target instanceof Element ? event.target.closest('.rail-node') : null;
          if (!target) return;
          const rect = target.getBoundingClientRect();
          const events = (window as any).__railEvents;
          events.push({ type, id: target.getAttribute('data-id'), time: performance.now(), rect: rect.toJSON() });
          if (events.length > 64) events.shift();
        }, true);
      }
    });
  });

  test.afterEach(async ({ page }, testInfo) => {
    if (testInfo.status === testInfo.expectedStatus || page.isClosed()) return;
    const diagnostic = await page.evaluate(() => ({
      events: (window as any).__railEvents,
      rail: document.querySelector('.work-rail')?.getBoundingClientRect().toJSON(),
      note: document.querySelector('.work-note')?.getBoundingClientRect().toJSON(),
      noteClass: document.querySelector('.work-note')?.className,
      active: document.activeElement?.outerHTML.slice(0, 500)
    }));
    await testInfo.attach('rail-events.json', { body: JSON.stringify(diagnostic, null, 2), contentType: 'application/json' });
  });

  test('renders the full chronology, newest first, with three node types', async ({ page }) => {
    await gotoWork(page, DESKTOP);
    await expect(page.locator('.work-rail')).toBeVisible();
    await expect(page.locator('.work-rail-title')).toHaveText('Timeline');
    await expect(page.locator('.work-rail-key-row')).toHaveText(['place', 'project', 'credential']);
    await page.waitForSelector('.rail-node');

    const ids = await page.locator('.rail-node').evaluateAll((els) =>
      els.map((e) => (e as HTMLElement).dataset.id));
    expect(ids.length).toBe(16);
    expect(ids[0]).toBe('adp');
    expect(ids[ids.length - 1]).toBe('beng');

    expect(await page.locator('.rail-node--work').count()).toBeGreaterThanOrEqual(3);
    expect(await page.locator('.rail-node--project').count()).toBe(2);
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

    await page.locator('.rail-node[data-id="cert-jee8"] .rail-dot-btn').hover();
    await expect(note.locator('.work-note-title')).toContainText('Java Enterprise Edition 8');
    await expect(note.locator('.work-note-cta')).not.toHaveClass(/work-note-cta--live/);
  });

  test('the field-note closes on mouse-out, even after a click (regression)', async ({ page }) => {
    await gotoWork(page, DESKTOP);
    await page.waitForSelector('.rail-node');
    const note = page.locator('.work-note');
    const adp = page.locator('.rail-node[data-id="adp"] .rail-dot-btn');

    await adp.hover();
    await expect(note).toHaveClass(/is-visible/);

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
    expect(await select('cert-jee8')).toBeNull();

    expect(pageErrors).toEqual([]);
  });

  test('re-sorts by type, then back to year (Year and Type are the only modes)', async ({ page }) => {
    await gotoWork(page, DESKTOP);
    await page.waitForSelector('.rail-node');
    await expect(page.locator('.rail-group')).toHaveCount(0);
    await expect(page.locator('.work-rail-mode')).toHaveText(['Year', 'Type']);

    await page.locator('.work-rail-mode', { hasText: 'Type' }).click();
    await expect(page.locator('.rail-group')).toHaveText(['Roles', 'Projects', 'Credentials']);
    const typeOrder = await page.locator('.rail-node').evaluateAll((els) =>
      els.map((e) => ((e as HTMLElement).className.match(/rail-node--(\w+)/) || [])[1]));
    expect(typeOrder.slice(0, 4).every((t) => t === 'work')).toBe(true);
    expect(typeOrder.slice(4, 6).every((t) => t === 'project')).toBe(true);
    expect(typeOrder.slice(6).every((t) => t === 'cert')).toBe(true);

    await page.locator('.work-rail-mode', { hasText: 'Year' }).click();
    await expect(page.locator('.rail-group')).toHaveCount(0);
  });

  test('compact: timeline by default, tap opens a card, toggle reveals the globe', async ({ page }) => {
    await gotoWork(page, MOBILE);
    await page.waitForSelector('.rail-node');

    await expect(page.locator('.work-view-toggle')).toBeVisible();
    await expect(page.locator('#work')).toHaveClass(/work-view-timeline/);
    await expect(page.locator('.work-rail')).toBeVisible();

    await page.locator('.rail-node[data-id="adp"] .rail-dot-btn').click();
    const card = page.locator('.work-card-backdrop');
    await expect(card).toHaveClass(/is-open/);
    await expect(page.locator('.work-card-title')).toHaveText('ADP');
    await expect(page.locator('.work-card-globe')).toHaveCount(1);
    await page.locator('.work-card-close').click();
    await expect(card).toBeHidden();

    await page.locator('.rail-node[data-id="cert-blockchain"] .rail-dot-btn').click();
    await expect(page.locator('.work-card-title')).toHaveText('Blockchain Specialization');
    await expect(page.locator('.work-card-globe')).toHaveCount(0);
    await page.locator('.work-card-close').click();

    await page.locator('.work-view-btn[data-view="globe"]').click();
    await expect(page.locator('#work')).toHaveClass(/work-view-globe/);
    await expect(page.locator('.work-rail')).toBeHidden();
    // Headless WebGL can fall back to a 1x1 canvas.
    await expect(page.locator('#work-globe-canvas')).toHaveCount(1);
  });

  test('Talos links to its own site from the landing, the work index and its card', async ({ page, browserName }) => {
    await gotoWork(page, MOBILE);
    await page.waitForSelector('.rail-node');
    await expect(page.locator('#main .selected-projects a', { hasText: 'Talos' })).toHaveAttribute('href', 'https://taloslocal.com/');
    await expect(page.locator('#work-index a[href="https://taloslocal.com/"]')).toHaveCount(1);

    await page.locator('.rail-node[data-id="talos"] .rail-dot-btn').click();
    const site = page.locator('.work-card-site');
    await expect(site).toHaveAttribute('href', 'https://taloslocal.com/');
    await expect(site).toHaveAttribute('target', '_blank');
    // The card keeps focus inside it: close, the site, the globe, then close again. Safari, like WebKit
    // here, skips links on Tab unless the reader turns that on, so there Tab goes straight to the globe.
    await expect(page.locator('.work-card-close')).toBeFocused();
    await page.keyboard.press('Tab');
    if (browserName !== 'webkit') {
      await expect(site).toBeFocused();
      await page.keyboard.press('Tab');
    }
    await expect(page.locator('.work-card-globe')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('.work-card-close')).toBeFocused();
    await page.locator('.work-card-close').click();

    // A project without a site of its own gets no site link.
    await page.locator('.rail-node[data-id="true-rolls"] .rail-dot-btn').click();
    await expect(page.locator('.work-card-title')).toHaveText('TrueRolls');
    await expect(page.locator('.work-card-site')).toHaveCount(0);
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

// On touch screens base.css grows every button to a 44px target, so the toggle bar is 52px tall.
// The bar, the close beside it and the legend below must stay apart, also when the page is zoomed
// (206 and 195 are 360 and 390 phones at 175% and 200%, where the toggle takes its own row).
test.describe('Work top bar on a touch screen', () => {
  test.use({ hasTouch: true });

  for (const viewport of [
    MOBILE, { width: 360, height: 780 }, { width: 280, height: 606 }, { width: 206, height: 446 }, { width: 195, height: 422 },
    { width: 844, height: 390 }, { width: 568, height: 320 }, { width: 768, height: 1024 }
  ]) {
    test(`the toggle, the close and the legend keep apart (${viewport.width}x${viewport.height})`, async ({ page, browserName }) => {
      await routeTurnstile(page);
      await gotoWork(page, viewport);
      await page.waitForSelector('.rail-node');
      if (browserName !== 'firefox') expect(await page.evaluate(() => matchMedia('(hover: none)').matches)).toBe(true);
      const boxes = await page.evaluate(() => {
        const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect().toJSON();
        return { toggle: box('.work-view-toggle'), close: box('.work-close'), legend: box('.work-rail-key') };
      });
      const { toggle, close, legend } = boxes;
      expect(toggle.bottom + 8, 'toggle above the legend').toBeLessThanOrEqual(legend.top);
      // The close is a 44px disc: its edge stays at least 4px off the toggle and the legend.
      const cx = close.left + close.width / 2;
      const cy = close.top + close.height / 2;
      for (const [name, rect] of [['toggle', toggle], ['legend', legend]] as const) {
        const gap = Math.hypot(Math.max(rect.left - cx, 0, cx - rect.right), Math.max(rect.top - cy, 0, cy - rect.bottom)) - close.width / 2;
        expect(gap, `close to ${name}`).toBeGreaterThanOrEqual(4);
      }
      // Short landscape phones lay the key in one row where the 90vmin column holds it, so the
      // timeline keeps room for an entry or more.
      if (viewport.height <= 520 && viewport.width > viewport.height) {
        const rows = await page.$$eval('.work-rail-key-row', (els) => new Set(els.map((el) => Math.round(el.getBoundingClientRect().top))).size);
        if (viewport.height * 0.9 >= 340) expect(rows, 'legend rows').toBe(1);
        const entry = (await page.locator('.rail-node').first().boundingBox())!.height;
        expect((await page.locator('.work-rail-viewport').boundingBox())!.height, 'timeline height').toBeGreaterThanOrEqual(entry);
      }
      // The buttons are still full touch targets, and a tap on each reaches it.
      for (const button of await page.locator('.work-view-btn').all()) {
        expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
      await page.locator('.work-view-btn[data-view="globe"]').tap();
      await expect(page.locator('#work')).toHaveClass(/work-view-globe/);
      await page.locator('.work-view-btn[data-view="timeline"]').tap();
      await expect(page.locator('#work')).toHaveClass(/work-view-timeline/);
    });
  }
});
