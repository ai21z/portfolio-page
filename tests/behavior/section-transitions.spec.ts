import { expect, test, type Page } from '@playwright/test';

// A section switch overlaps the two views: the outgoing section keeps painting while it fades out,
// then fires 'stage:left' so its modules release their canvases.

async function recordLeaves(page: Page) {
  await page.evaluate(() => {
    (window as any).__left = [];
    document.addEventListener('stage:left', (event) => {
      (window as any).__left.push((event.target as HTMLElement).id);
    });
  });
}

async function stageState(page: Page, id: string) {
  return page.locator(`#${id}`).evaluate((el: HTMLElement) => ({
    active: el.classList.contains('active-section'),
    leaving: el.classList.contains('stage-leaving'),
    inert: el.inert,
    contentVisibility: getComputedStyle(el).getPropertyValue('content-visibility') || 'unsupported'
  }));
}

async function clickSectionLink(page: Page, from: string, to: string) {
  await page.locator(`#${from} .section-nav-link[data-section="${to}"]`).first().click();
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
});

test('the outgoing section stays painted while it fades out, then leaves', async ({ page }) => {
  await page.goto('/index.html#about');
  await expect(page.locator('#about')).toHaveClass(/active-section/);
  await recordLeaves(page);

  await clickSectionLink(page, 'about', 'skills');
  const leaving = await stageState(page, 'about');
  expect(leaving.active).toBe(false);
  expect(leaving.leaving).toBe(true);
  expect(leaving.inert).toBe(true);
  if (leaving.contentVisibility !== 'unsupported') expect(leaving.contentVisibility).toBe('visible');

  await expect(page.locator('#about')).not.toHaveClass(/stage-leaving/);
  expect(await page.evaluate(() => (window as any).__left)).toEqual(['about']);
  const left = await stageState(page, 'about');
  if (left.contentVisibility !== 'unsupported') expect(left.contentVisibility).toBe('hidden');
});

test('returning before the fade ends keeps the section and never reports it as left', async ({ page }) => {
  await page.goto('/index.html#about');
  await expect(page.locator('#about')).toHaveClass(/active-section/);
  await recordLeaves(page);

  // Both switches in one task, so the return lands well inside the fade even on a slow engine.
  await page.evaluate(() => {
    document.querySelector<HTMLElement>('#about .section-nav-link[data-section="skills"]')!.click();
    document.querySelector<HTMLElement>('#skills .section-nav-link[data-section="about"]')!.click();
  });
  const about = await stageState(page, 'about');
  expect(about.active).toBe(true);
  expect(about.leaving).toBe(false);

  await expect(page.locator('#skills')).not.toHaveClass(/stage-leaving/);
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => (window as any).__left)).toEqual(['skills']);
});

for (const [from, to] of [['contact', 'about'], ['blog', 'about']]) {
  test(`leaving ${from} sits under ${to} and keeps its fixed nav in place`, async ({ page }) => {
    await page.goto(`/index.html#${from}`);
    await expect(page.locator(`#${from}`)).toHaveClass(/active-section/);
    // Read 100 ms into the fade inside the page, so its own timers order it before the 500 ms leave.
    const state = await page.evaluate(async ([out, into]) => {
      const nav = document.querySelector(`#${out} .section-nav`);
      const top = () => (nav ? Math.round(nav.getBoundingClientRect().top) : 0);
      const before = top();
      document.querySelector<HTMLElement>(`#${out} .section-nav-link[data-section="${into}"]`)!.click();
      await new Promise((resolve) => setTimeout(resolve, 100));
      return {
        leaving: document.getElementById(out)!.classList.contains('stage-leaving'),
        navMoved: top() - before,
        leavingZ: Number(getComputedStyle(document.getElementById(out)!).zIndex),
        incomingZ: Number(getComputedStyle(document.getElementById(into)!).zIndex)
      };
    }, [from, to]);
    expect(state.leaving).toBe(true);
    expect(state.navMoved).toBe(0);
    expect(state.leavingZ).toBeLessThan(state.incomingZ);
  });
}

test('network labels return with the landing instead of popping over the section still fading out', async ({ page }) => {
  await page.goto('/index.html#about');
  await expect(page.locator('#about')).toHaveClass(/active-section/);
  await expect(page.locator('.network-node-label').first()).toBeAttached();
  const opacities = await page.evaluate(async () => {
    document.querySelector<HTMLElement>('#about [data-action="go-intro"]')!.click();
    await new Promise((resolve) => setTimeout(resolve, 30));
    return [...document.querySelectorAll('.network-node-label')].map((el) => Number(getComputedStyle(el).opacity));
  });
  expect(opacities.length).toBeGreaterThan(0);
  for (const opacity of opacities) expect(opacity).toBeLessThan(0.6);
});

test('the sigil Blog covered fades in as Blog leaves instead of popping over it', async ({ page }) => {
  await page.goto('/index.html#blog');
  await expect(page.locator('#blog')).toHaveClass(/active-section/);
  await expect(page.locator('.network-sigil-node')).toBeAttached();
  const opacity = await page.evaluate(async () => {
    document.querySelector<HTMLElement>('#blog .section-nav-link[data-section="about"]')!.click();
    await new Promise((resolve) => setTimeout(resolve, 30));
    return Number(getComputedStyle(document.querySelector('.network-sigil-node')!).opacity);
  });
  expect(opacity).toBeLessThan(0.5);
});

test('leaving a deep-linked Contact keeps the sigil, which Contact never covered, steady', async ({ page }) => {
  await page.goto('/index.html#contact');
  await expect(page.locator('#contact')).toHaveClass(/active-section/);
  await expect(page.locator('.network-sigil-node')).toBeAttached();
  const opacity = await page.evaluate(async () => {
    document.querySelector<HTMLElement>('#contact .section-nav-link[data-section="about"]')!.click();
    await new Promise((resolve) => setTimeout(resolve, 30));
    return Number(getComputedStyle(document.querySelector('.network-sigil-node')!).opacity);
  });
  expect(opacity).toBeGreaterThan(0.5);
});

test('with reduced motion a switch is immediate and the section leaves at once', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/index.html#about');
  await expect(page.locator('#about')).toHaveClass(/active-section/);
  await recordLeaves(page);

  await clickSectionLink(page, 'about', 'skills');
  expect((await stageState(page, 'about')).leaving).toBe(false);
  expect(await page.evaluate(() => (window as any).__left)).toEqual(['about']);
});

test('a deep link does not fade the landing out behind the loading veil', async ({ page }) => {
  await page.goto('/index.html#skills');
  await expect(page.locator('#skills')).toHaveClass(/active-section/);
  expect((await stageState(page, 'main')).leaving).toBe(false);
});

test('the Blog canvas, black until drawn, stays transparent until its first frame', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/index.html#about');
  await expect(page.locator('#about')).toHaveClass(/active-section/);
  // Sample the canvas from the click until it settles: an undrawn canvas must never be opaque.
  await page.evaluate(() => {
    (window as any).__opaqueUndrawn = 0;
    const sample = () => {
      const canvas = document.getElementById('blog-network-canvas');
      if (canvas && canvas.getBoundingClientRect().width > 0 && !canvas.classList.contains('is-drawn')
        && Number(getComputedStyle(canvas).opacity) > 0) {
        (window as any).__opaqueUndrawn++;
      }
      if (performance.now() < (window as any).__sampleUntil) requestAnimationFrame(sample);
    };
    (window as any).__sampleUntil = performance.now() + 2500;
    requestAnimationFrame(sample);
  });
  await clickSectionLink(page, 'about', 'blog');
  await expect(page.locator('#blog')).toHaveClass(/active-section/);
  await page.waitForTimeout(2600);
  expect(await page.evaluate(() => (window as any).__opaqueUndrawn)).toBe(0);

  const fallback = await page.locator('#blog .webgl-fallback-visible').count();
  if (!fallback) {
    // The first visit loads and compiles the scene, which takes seconds in a loaded headless WebKit.
    await expect(page.locator('#blog-network-canvas')).toHaveClass(/is-drawn/, { timeout: 20_000 });
    // Leaving keeps the last frame through the fade, then releases the canvas. Checked inside the
    // page 100 ms after the switch, which its own timers order before the 500 ms leave timer.
    const duringFade = await page.evaluate(async () => {
      document.querySelector<HTMLElement>('#blog .section-nav-link[data-section="contact"]')!.click();
      await new Promise((resolve) => setTimeout(resolve, 100));
      const canvas = document.getElementById('blog-network-canvas') as HTMLCanvasElement;
      return {
        leaving: document.getElementById('blog')!.classList.contains('stage-leaving'),
        drawn: canvas.classList.contains('is-drawn'),
        area: canvas.width * canvas.height
      };
    });
    expect(duringFade.leaving).toBe(true);
    expect(duringFade.drawn).toBe(true);
    expect(duringFade.area).toBeGreaterThan(1);
    await expect(page.locator('#blog')).not.toHaveClass(/stage-leaving/);
    await expect(page.locator('#blog-network-canvas')).not.toHaveClass(/is-drawn/);
    expect(await page.locator('#blog-network-canvas').evaluate((c: HTMLCanvasElement) => c.width * c.height)).toBeLessThanOrEqual(1);
  }
});
