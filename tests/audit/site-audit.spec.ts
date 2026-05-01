import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type Viewport = { width: number; height: number };

type SectionTarget = {
  name: string;
  hash: string;
  activeId: string;
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const screenshotDir = path.join(repoRoot, 'artifacts', 'audit-screenshots');
const partsDir = path.join(repoRoot, 'artifacts', 'browser-audit-parts');
const sampleDurationMs = Number(process.env.AUDIT_SAMPLE_MS || 5_000);

const viewports: Viewport[] = [
  { width: 320, height: 568 },
  { width: 360, height: 640 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 }
];

const sections: SectionTarget[] = [
  { name: 'hero', hash: '', activeId: 'main' },
  { name: 'about', hash: '#about', activeId: 'about' },
  { name: 'skills', hash: '#skills', activeId: 'skills' },
  { name: 'now', hash: '#now', activeId: 'now' },
  { name: 'blog', hash: '#blog', activeId: 'blog' },
  { name: 'work', hash: '#work', activeId: 'work' },
  { name: 'contact', hash: '#contact', activeId: 'contact' }
];

const timedSections = new Set(['hero', 'blog', 'work', 'contact']);

function sanitize(value: string): string {
  return value.replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
}

function normalizeBaseURL(baseURL: string | undefined): string {
  return baseURL || process.env.BASE_URL || process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:4173';
}

function urlFor(baseURL: string | undefined, section: SectionTarget): string {
  return new URL(`/index.html${section.hash}`, normalizeBaseURL(baseURL)).toString();
}

function relativeArtifactPath(fullPath: string): string {
  return path.relative(repoRoot, fullPath).replace(/\\/g, '/');
}

function profileRank(profile: string): number {
  return ['quiet', 'balanced', 'rich', 'full'].indexOf(profile);
}

function ensureArtifactDirs() {
  fs.mkdirSync(screenshotDir, { recursive: true });
  fs.mkdirSync(partsDir, { recursive: true });
}

function writePart(result: unknown, label: string) {
  ensureArtifactDirs();
  const partPath = path.join(partsDir, `${sanitize(label)}.json`);
  fs.writeFileSync(partPath, JSON.stringify(result, null, 2));
}

function attachHealthListeners(page: Page, origin: string) {
  const consoleErrors: Array<Record<string, string>> = [];
  const pageErrors: string[] = [];
  const failedRequests: Array<Record<string, string | number | boolean>> = [];

  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push({
        type: message.type(),
        text: message.text().slice(0, 500),
        location: JSON.stringify(message.location())
      });
    }
  });

  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  page.on('requestfailed', (request) => {
    failedRequests.push({
      url: request.url(),
      resourceType: request.resourceType(),
      failure: request.failure()?.errorText || '',
      sameOrigin: safeOrigin(request.url()) === origin
    });
  });

  page.on('response', (response) => {
    const status = response.status();
    if (status >= 400) {
      failedRequests.push({
        url: response.url(),
        resourceType: response.request().resourceType(),
        status,
        sameOrigin: safeOrigin(response.url()) === origin
      });
    }
  });

  return {
    consoleErrors,
    pageErrors,
    failedRequests,
    seriousSameOriginFailures() {
      return failedRequests.filter((request) => {
        const status = Number(request.status || 0);
        return request.sameOrigin === true && status >= 400 && !/\/favicon\.ico(?:$|\?)/.test(String(request.url));
      });
    }
  };
}

function safeOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

function isKnownExternalPageError(message: string): boolean {
  return /challenges\.cloudflare\.com/i.test(message)
    || message === 'NetworkError when attempting to fetch resource.'
    || /^[A-Za-z_$][\w$]*\[[A-Za-z_$][\w$]*\(\.\.\.\)\] is not a function$/.test(message);
}

async function waitForSectionReady(page: Page, section: SectionTarget) {
  if (section.name === 'work') {
    await page.waitForFunction(() => {
      const canvas = document.getElementById('work-globe-canvas') as HTMLCanvasElement | null;
      return !canvas || canvas.width > 300 || !!document.querySelector('#work .webgl-fallback-visible');
    }, null, { timeout: 8_000 }).catch(() => undefined);
  }

  if (section.name === 'blog') {
    await page.waitForFunction(() => {
      const mobileGrid = document.querySelector('.blog-mobile');
      const mobileGridVisible = !!mobileGrid && getComputedStyle(mobileGrid).display !== 'none';
      const canvas = document.getElementById('blog-network-canvas') as HTMLCanvasElement | null;
      return mobileGridVisible || !canvas || canvas.width > 300 || !!document.querySelector('#blog .webgl-fallback-visible');
    }, null, { timeout: 8_000 }).catch(() => undefined);
  }
}

async function gotoSection(page: Page, baseURL: string | undefined, section: SectionTarget) {
  await page.goto(urlFor(baseURL, section), { waitUntil: 'domcontentloaded' });
  await waitForActiveSection(page, section);
}

async function switchSection(page: Page, section: SectionTarget) {
  await page.evaluate((hash) => {
    window.location.hash = hash;
  }, section.hash);
  await waitForActiveSection(page, section);
}

async function waitForActiveSection(page: Page, section: SectionTarget) {
  await page.waitForFunction((activeId) => {
    const element = document.getElementById(activeId);
    return !!element && element.classList.contains('active-section');
  }, section.activeId);
  await waitForSectionReady(page, section);
  await page.waitForTimeout(250);
}

async function collectSectionHealth(page: Page, section: SectionTarget) {
  return await page.evaluate((target) => {
    function cssPath(element: Element): string {
      if (element.id) return `#${CSS.escape(element.id)}`;

      const className = typeof element.className === 'string'
        ? element.className.split(/\s+/).filter(Boolean).slice(0, 4).map((item) => `.${CSS.escape(item)}`).join('')
        : '';
      const own = `${element.tagName.toLowerCase()}${className}`;
      const parent = element.parentElement;

      if (!parent || parent === document.body) return own;
      if (parent.id) return `#${CSS.escape(parent.id)} > ${own}`;

      return own;
    }

    function isVisible(element: Element): boolean {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    }

    const probe = document.createElement('canvas');
    const webgl2Available = !!probe.getContext('webgl2');
    const active = document.getElementById(target.activeId);
    const activeRect = active?.getBoundingClientRect();
    const viewportPixels = window.innerWidth * window.innerHeight;

    const canvases = Array.from(document.querySelectorAll('canvas')).map((canvas) => {
      const rect = canvas.getBoundingClientRect();
      const backingPixels = canvas.width * canvas.height;
      const cssPixels = Math.max(1, rect.width * rect.height);
      const backingToCssRatio = Math.sqrt(backingPixels / cssPixels);

      return {
        selector: cssPath(canvas),
        id: canvas.id || '',
        className: canvas.className || '',
        cssWidth: Math.round(rect.width),
        cssHeight: Math.round(rect.height),
        backingWidth: canvas.width,
        backingHeight: canvas.height,
        backingPixels,
        backingToCssRatio: Number(backingToCssRatio.toFixed(2)),
        dangerouslyLarge: backingPixels > Math.max(8_000_000, viewportPixels * 6) || canvas.width > 4096 || canvas.height > 4096
      };
    });

    const fallbackRoot = active || document;
    const fallbackMessages = Array.from(fallbackRoot.querySelectorAll('.webgl-fallback, [data-webgl-fallback], .fallback-message'))
      .filter((element) => !element.closest('canvas'))
      .filter(isVisible)
      .map((element) => ({
        selector: cssPath(element),
        text: (element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 200)
      }))
      .filter((entry) => /webgl|canvas|fallback/i.test(entry.text));

    const scrollWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
    const overflowX = scrollWidth - window.innerWidth;
    const offenders = Array.from(document.querySelectorAll('body *'))
      .filter(isVisible)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          selector: cssPath(element),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
          text: (element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 100)
        };
      })
      .filter((entry) => entry.left < -2 || entry.right > window.innerWidth + 2)
      .sort((a, b) => b.width - a.width)
      .slice(0, 20);

    return {
      name: target.name,
      url: location.href,
      activeSectionId: active?.id || '',
      activeSectionVisible: !!active && isVisible(active),
      activeSectionRect: activeRect ? {
        top: Math.round(activeRect.top),
        left: Math.round(activeRect.left),
        width: Math.round(activeRect.width),
        height: Math.round(activeRect.height),
        bottom: Math.round(activeRect.bottom)
      } : null,
      devicePixelRatio: window.devicePixelRatio || 1,
      webgl2Available,
      fallbackMessages,
      canvases,
      horizontalOverflow: {
        scrollWidth,
        innerWidth: window.innerWidth,
        overflowX,
        offenders
      },
      reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches
    };
  }, section);
}

async function sampleFrames(page: Page, label: string, durationMs = sampleDurationMs) {
  return await page.evaluate(async ({ label: metricLabel, durationMs: metricDurationMs }) => {
    return await new Promise((resolve) => {
      const deltas: number[] = [];
      let start = 0;
      let last = 0;
      let lastTimestamp = 0;

      function finish() {
        const elapsed = Math.max(1, lastTimestamp - start);
        const total = deltas.reduce((sum, value) => sum + value, 0);
        const average = deltas.length ? total / deltas.length : 0;
        const sorted = [...deltas].sort((a, b) => a - b);
        const percentile = (p: number) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0;

        resolve({
          label: metricLabel,
          durationMs: metricDurationMs,
          observedElapsedMs: Number(elapsed.toFixed(1)),
          frameCount: deltas.length,
          averageFrameDeltaMs: Number(average.toFixed(2)),
          approximateFps: Number((deltas.length / (elapsed / 1000)).toFixed(1)),
          p95FrameDeltaMs: Number(percentile(0.95).toFixed(2)),
          maxFrameDeltaMs: Number((Math.max(0, ...deltas)).toFixed(2)),
          framesOver50ms: deltas.filter((value) => value > 50).length,
          framesOver100ms: deltas.filter((value) => value > 100).length
        });
      }

      function tick(timestamp: number) {
        if (!start) {
          start = timestamp;
          last = timestamp;
        } else {
          deltas.push(timestamp - last);
          last = timestamp;
        }

        lastTimestamp = timestamp;

        if (timestamp - start >= metricDurationMs) {
          finish();
          return;
        }

        requestAnimationFrame(tick);
      }

      requestAnimationFrame(tick);
    });
  }, { label, durationMs });
}

async function sampleScrollJank(page: Page, durationMs = sampleDurationMs) {
  return await page.evaluate(async (metricDurationMs) => {
    return await new Promise((resolve) => {
      const deltas: number[] = [];
      let start = 0;
      let last = 0;
      let lastTimestamp = 0;
      let direction = 1;

      const scroller = window.setInterval(() => {
        const maxScrollY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
        if (maxScrollY <= 0) return;
        if (window.scrollY >= maxScrollY) direction = -1;
        if (window.scrollY <= 0) direction = 1;
        window.scrollBy(0, direction * 120);
      }, 80);

      function finish() {
        window.clearInterval(scroller);
        const elapsed = Math.max(1, lastTimestamp - start);
        const total = deltas.reduce((sum, value) => sum + value, 0);
        const average = deltas.length ? total / deltas.length : 0;
        resolve({
          label: 'scroll',
          durationMs: metricDurationMs,
          observedElapsedMs: Number(elapsed.toFixed(1)),
          frameCount: deltas.length,
          averageFrameDeltaMs: Number(average.toFixed(2)),
          approximateFps: Number((deltas.length / (elapsed / 1000)).toFixed(1)),
          maxFrameDeltaMs: Number((Math.max(0, ...deltas)).toFixed(2)),
          framesOver50ms: deltas.filter((value) => value > 50).length,
          framesOver100ms: deltas.filter((value) => value > 100).length,
          scrollHeight: document.documentElement.scrollHeight,
          maxScrollY: Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
        });
      }

      function tick(timestamp: number) {
        if (!start) {
          start = timestamp;
          last = timestamp;
        } else {
          deltas.push(timestamp - last);
          last = timestamp;
        }

        lastTimestamp = timestamp;

        if (timestamp - start >= metricDurationMs) {
          finish();
          return;
        }

        requestAnimationFrame(tick);
      }

      requestAnimationFrame(tick);
    });
  }, durationMs);
}

async function collectCanvasSnapshot(page: Page) {
  return await page.evaluate(() => {
    return Array.from(document.querySelectorAll('canvas')).map((canvas) => {
      const rect = canvas.getBoundingClientRect();
      return {
        id: canvas.id || '',
        className: canvas.className || '',
        cssWidth: Math.round(rect.width),
        cssHeight: Math.round(rect.height),
        backingWidth: canvas.width,
        backingHeight: canvas.height
      };
    });
  });
}

async function collectOffscreenBehavior(page: Page, baseURL: string | undefined) {
  const work = sections.find((section) => section.name === 'work')!;
  const blog = sections.find((section) => section.name === 'blog')!;
  const contact = sections.find((section) => section.name === 'contact')!;

  await gotoSection(page, baseURL, work);
  const workActive = await collectCanvasSnapshot(page);
  await switchSection(page, contact);
  const workAfterContact = await collectCanvasSnapshot(page);

  await switchSection(page, blog);
  const blogActive = await collectCanvasSnapshot(page);
  await switchSection(page, contact);
  const blogAfterContact = await collectCanvasSnapshot(page);

  return {
    workActive,
    workAfterContact,
    blogActive,
    blogAfterContact,
    hiddenDocumentSimulation: 'not measured; Playwright cannot reliably simulate real tab backgrounding across all projects'
  };
}

async function collectGraphicsGovernorState(page: Page) {
  return await page.evaluate(async () => {
    const governor = await import('/js/graphics-governor.js');
    return governor.getGraphicsState();
  });
}

async function collectPortraitParticleStats(page: Page) {
  return await page.evaluate(async () => {
    const module = await import('/js/portrait-particles.js');
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    const instance = module.portraitParticles;
    const canvas = instance.canvas as HTMLCanvasElement | null;
    return {
      initialized: instance.initialized,
      running: instance.running,
      renderMode: instance.renderMode,
      particleCount: instance.particles.length,
      backingWidth: canvas?.width ?? 0,
      backingHeight: canvas?.height ?? 0,
      globalStats: window.__portraitParticleStats ?? null
    };
  });
}

async function runAuditPass(page: Page, baseURL: string | undefined, browserName: string, viewport: Viewport, kind: string) {
  await page.setViewportSize(viewport);

  const origin = new URL(normalizeBaseURL(baseURL)).origin;
  const health = attachHealthListeners(page, origin);
  const result: Record<string, unknown> = {
    kind,
    browser: browserName,
    viewport,
    baseURL: normalizeBaseURL(baseURL),
    sampleDurationMs,
    generatedAt: new Date().toISOString(),
    consoleErrors: health.consoleErrors,
    pageErrors: health.pageErrors,
    reportablePageErrors: [],
    failedRequests: health.failedRequests,
    sections: [],
    frameTimings: {},
    scrollJank: null,
    offscreenAnimation: null
  };

  for (const section of sections) {
    await gotoSection(page, baseURL, section);
    const sectionHealth = await collectSectionHealth(page, section);
    const screenshotPath = path.join(
      screenshotDir,
      `${sanitize(browserName)}-${viewport.width}x${viewport.height}-${sanitize(kind)}-${section.name}.png`
    );
    await page.screenshot({ path: screenshotPath, fullPage: false });

    (result.sections as unknown[]).push({
      ...sectionHealth,
      screenshotPath: relativeArtifactPath(screenshotPath)
    });

    if (timedSections.has(section.name)) {
      (result.frameTimings as Record<string, unknown>)[section.name] = await sampleFrames(page, section.name);
    }
  }

  await gotoSection(page, baseURL, sections[0]);
  result.scrollJank = await sampleScrollJank(page);
  result.offscreenAnimation = await collectOffscreenBehavior(page, baseURL);
  result.reportablePageErrors = health.pageErrors.filter((message) => !isKnownExternalPageError(message));

  writePart(result, `${browserName}-${viewport.width}x${viewport.height}-${kind}`);

  expect(
    result.reportablePageErrors,
    `${browserName} ${viewport.width}x${viewport.height} first-party page errors`
  ).toEqual([]);
  expect(
    health.seriousSameOriginFailures(),
    `${browserName} ${viewport.width}x${viewport.height} same-origin failed requests`
  ).toEqual([]);
}

test.describe('browser audit', () => {
  test('graphics profile setting persists and updates the document state', async ({ page, baseURL }) => {
    test.setTimeout(60_000);
    await page.goto(urlFor(baseURL, sections[0]), { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-graphics-control]')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-graphics-profile', /^(quiet|balanced|rich|full)$/);
    await expect(page.locator('.graphics-control__toggle')).toContainText('Graphics:');

    await page.locator('.graphics-control__toggle').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#graphics-profile-menu')).toBeVisible();
    await page.locator('[data-graphics-profile="quiet"]').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('data-graphics-profile', 'quiet');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('html')).toHaveAttribute('data-graphics-profile', 'quiet');

    await page.locator('.graphics-control__toggle').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#graphics-profile-menu')).toBeVisible();
    await page.locator('[data-graphics-profile="balanced"]').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('data-graphics-profile', 'balanced');
  });

  test('quiet graphics profile applies low-cost budgets to visual systems', async ({ page, baseURL }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.addInitScript(() => {
      window.localStorage.setItem('vissarion.graphicsProfile', 'quiet');
      Object.defineProperty(window, 'devicePixelRatio', {
        configurable: true,
        get: () => 2
      });
    });

    await page.goto(urlFor(baseURL, sections[0]), { waitUntil: 'domcontentloaded' });
    await expect(page.locator('html')).toHaveAttribute('data-graphics-effective-profile', 'quiet');
    await page.waitForTimeout(750);
    await expect(page.locator('.portrait-particles-canvas')).toHaveCount(0);

    const work = sections.find((section) => section.name === 'work')!;
    await switchSection(page, work);

    const workCanvas = await page.evaluate(() => {
      const canvas = document.getElementById('work-globe-canvas') as HTMLCanvasElement | null;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      return {
        backingWidth: canvas.width,
        backingHeight: canvas.height,
        cssWidth: rect.width,
        cssHeight: rect.height,
        devicePixelRatio: window.devicePixelRatio
      };
    });

    expect(workCanvas).not.toBeNull();
    expect(workCanvas!.devicePixelRatio).toBe(2);
    expect(workCanvas!.backingWidth).toBeLessThanOrEqual(Math.ceil(workCanvas!.cssWidth * 1.05));
    expect(workCanvas!.backingHeight).toBeLessThanOrEqual(Math.ceil(workCanvas!.cssHeight * 1.05));
  });

  test('graphics governor tracks active section and temporary movement regression', async ({ page, baseURL }) => {
    test.setTimeout(60_000);
    await page.addInitScript(() => {
      window.localStorage.setItem('vissarion.graphicsProfile', 'rich');
    });

    await page.goto(urlFor(baseURL, sections[0]), { waitUntil: 'domcontentloaded' });
    await expect(page.locator('html')).toHaveAttribute('data-graphics-section', 'intro');

    const work = sections.find((section) => section.name === 'work')!;
    await switchSection(page, work);
    await expect(page.locator('html')).toHaveAttribute('data-graphics-section', 'work');

    const before = await collectGraphicsGovernorState(page);
    await page.mouse.move(480, 320);
    await page.mouse.wheel(0, 420);

    await expect.poll(async () => {
      const state = await collectGraphicsGovernorState(page);
      return state.movementRegression;
    }).toBe(true);

    const during = await collectGraphicsGovernorState(page);
    expect(profileRank(during.effectiveProfile)).toBeLessThanOrEqual(profileRank(before.effectiveProfile));

    await expect.poll(async () => {
      const state = await collectGraphicsGovernorState(page);
      return state.movementRegression;
    }, { timeout: 2_500 }).toBe(false);
  });

  test('portrait particles use adaptive renderer and release inactive buffers', async ({ page, baseURL, browserName }) => {
    test.setTimeout(75_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
      window.localStorage.setItem('vissarion.graphicsProfile', 'balanced');
    });

    await page.goto(urlFor(baseURL, sections[0]), { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.portrait-particles-canvas')).toHaveCount(1);

    await expect.poll(async () => {
      const stats = await collectPortraitParticleStats(page);
      return stats.backingWidth * stats.backingHeight;
    }, { timeout: 6_000 }).toBeGreaterThan(1);

    const activeStats = await collectPortraitParticleStats(page);
    expect(activeStats.initialized).toBe(true);
    expect(activeStats.particleCount).toBeGreaterThan(0);
    expect(activeStats.globalStats).not.toBeNull();

    if (browserName === 'firefox' || browserName === 'webkit') {
      expect(activeStats.renderMode).toBe('fillrect');
    } else {
      expect(activeStats.renderMode).toBe('imagedata');
    }

    const contact = sections.find((section) => section.name === 'contact')!;
    await switchSection(page, contact);

    await expect.poll(async () => {
      const stats = await collectPortraitParticleStats(page);
      return stats.backingWidth * stats.backingHeight;
    }).toBeLessThanOrEqual(1);

    const inactiveStats = await collectPortraitParticleStats(page);
    expect(inactiveStats.running).toBe(false);
  });

  test('constrained engines apply stricter heavy-graphics budgets', async ({ page, baseURL, browserName }) => {
    test.setTimeout(60_000);
    test.skip(browserName === 'chromium', 'Chromium keeps the standard balanced budget.');

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
      window.localStorage.setItem('vissarion.graphicsProfile', 'balanced');
    });
    await page.goto(urlFor(baseURL, sections[0]), { waitUntil: 'domcontentloaded' });
    await expect(page.locator('html')).toHaveAttribute('data-graphics-profile', 'balanced');
    await expect.poll(async () => {
      const state = await collectGraphicsGovernorState(page);
      return state.movementRegression;
    }).toBe(false);

    const budgets = await page.evaluate(async () => {
      const governor = await import('/js/graphics-governor.js');
      return {
        portrait: governor.getGraphicsBudget('portrait-particles'),
        spores: governor.getGraphicsBudget('intro-spores'),
        work: governor.getGraphicsBudget('work-globe')
      };
    });

    expect(budgets.portrait.dprCap).toBeLessThanOrEqual(1);
    expect(budgets.portrait.maxCanvasPixels).toBeLessThanOrEqual(900_000);
    expect(budgets.portrait.particleScale).toBeLessThanOrEqual(0.35);
    expect(budgets.spores.particleScale).toBeLessThanOrEqual(0.35);
    expect(budgets.work.dprCap).toBeLessThanOrEqual(1);
    expect(budgets.work.maxCanvasPixels).toBeLessThanOrEqual(1_200_000);
    expect(budgets.work.geometryScale).toBeLessThanOrEqual(0.55);
    expect(budgets.work.effectsScale).toBeLessThanOrEqual(0.45);

    await page.setViewportSize({ width: 1920, height: 1080 });
    const largeViewportBudgets = await page.evaluate(async () => {
      const governor = await import('/js/graphics-governor.js');
      return {
        portrait: governor.getGraphicsBudget('portrait-particles'),
        work: governor.getGraphicsBudget('work-globe')
      };
    });

    expect(largeViewportBudgets.portrait.maxCanvasPixels).toBeLessThanOrEqual(500_000);
    expect(largeViewportBudgets.portrait.particleScale).toBeLessThanOrEqual(0.25);
    expect(largeViewportBudgets.work.maxCanvasPixels).toBeLessThanOrEqual(550_000);
    expect(largeViewportBudgets.work.particleScale).toBeLessThanOrEqual(0.25);
    expect(largeViewportBudgets.work.geometryScale).toBeLessThanOrEqual(0.45);
    expect(largeViewportBudgets.work.effectsScale).toBeLessThanOrEqual(0.35);
    expect(largeViewportBudgets.work.heavyConstrained).toBe(true);
  });

  for (const viewport of viewports) {
    test(`performance and compatibility evidence at ${viewport.width}x${viewport.height}`, async ({ page, baseURL, browserName }) => {
      test.setTimeout(Math.max(150_000, sampleDurationMs * 8));
      await runAuditPass(page, baseURL, browserName, viewport, 'standard');
    });
  }

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1440, height: 900 }
  ]) {
    test(`reduced motion evidence at ${viewport.width}x${viewport.height}`, async ({ page, baseURL, browserName }) => {
      test.setTimeout(Math.max(120_000, sampleDurationMs * 8));
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await runAuditPass(page, baseURL, browserName, viewport, 'reduced-motion');
    });
  }
});
