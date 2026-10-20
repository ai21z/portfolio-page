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
const constrainedReportDir = path.join(repoRoot, 'artifacts', 'constrained-audit');
const constrainedScreenshotDir = path.join(repoRoot, 'artifacts', 'constrained-audit-screenshots');
const sampleDurationMs = Number(process.env.AUDIT_SAMPLE_MS || 5_000);

const constrainedLaptopViewports: Viewport[] = [
  { width: 1366, height: 768 },
  { width: 1366, height: 650 },
  { width: 1280, height: 650 },
  { width: 1024, height: 600 }
];

const viewports: Viewport[] = [
  { width: 320, height: 568 },
  { width: 360, height: 640 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 768, height: 1024 },
  constrainedLaptopViewports[3],
  { width: 1024, height: 768 },
  constrainedLaptopViewports[2],
  { width: 1280, height: 720 },
  constrainedLaptopViewports[1],
  constrainedLaptopViewports[0],
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 }
];

const sections: SectionTarget[] = [
  { name: 'hero', hash: '', activeId: 'main' },
  { name: 'about', hash: '#about', activeId: 'about' },
  { name: 'skills', hash: '#skills', activeId: 'skills' },
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
  fs.mkdirSync(constrainedReportDir, { recursive: true });
  fs.mkdirSync(constrainedScreenshotDir, { recursive: true });
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
    const fallbackMessages = Array.from(fallbackRoot.querySelectorAll('.webgl-fallback, .webgl-fallback-visible, [data-webgl-fallback], .fallback-message'))
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

async function installLongTaskObserver(page: Page) {
  await page.addInitScript(() => {
    window.__auditLongTasks = [];
    window.__auditLongTaskUnsupported = false;

    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__auditLongTasks.push({
            name: entry.name,
            duration: Number(entry.duration.toFixed(2)),
            startTime: Number(entry.startTime.toFixed(2))
          });
        }
      });
      observer.observe({ entryTypes: ['longtask'] });
      window.__auditLongTaskObserver = observer;
    } catch {
      window.__auditLongTaskUnsupported = true;
    }
  });
}

async function collectLongTaskSummary(page: Page) {
  return await page.evaluate(() => {
    const tasks = window.__auditLongTasks || [];
    const durations = tasks.map((task: { duration: number }) => task.duration);
    const totalDurationMs = durations.reduce((sum: number, duration: number) => sum + duration, 0);
    const sorted = [...tasks].sort((a: { duration: number }, b: { duration: number }) => b.duration - a.duration);

    return {
      supported: !window.__auditLongTaskUnsupported,
      count: tasks.length,
      totalDurationMs: Number(totalDurationMs.toFixed(2)),
      maxDurationMs: Number(Math.max(0, ...durations).toFixed(2)),
      over100ms: durations.filter((duration: number) => duration > 100).length,
      top: sorted.slice(0, 10)
    };
  });
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

async function mockStrongWebGLCapability(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', {
      configurable: true,
      get: () => 8
    });
    Object.defineProperty(Navigator.prototype, 'deviceMemory', {
      configurable: true,
      get: () => 8
    });
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (contextId: string, options?: unknown) {
      if (contextId === 'webgl2') {
        return {
          getExtension: () => null,
          getParameter: () => 'NVIDIA GeForce RTX'
        } as unknown as WebGL2RenderingContext;
      }
      return originalGetContext.call(this, contextId, options);
    };
  });
}

async function mockRendererCapability(page: Page, renderer: string) {
  await page.addInitScript((rendererName) => {
    Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', { configurable: true, get: () => 8 });
    Object.defineProperty(Navigator.prototype, 'deviceMemory', { configurable: true, get: () => 8 });
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (contextId: string, options?: unknown) {
      if (contextId === 'webgl2') {
        return {
          getExtension: () => null,
          getParameter: () => rendererName
        } as unknown as WebGL2RenderingContext;
      }
      return originalGetContext.call(this, contextId, options);
    };
  }, renderer);
}

async function mockIntegratedWebGLCapability(page: Page) {
  await mockRendererCapability(page, 'Intel(R) UHD Graphics 620');
}

async function mockUnavailableWebGL2(page: Page) {
  await page.addInitScript(() => {
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (contextId: string, options?: unknown) {
      if (contextId === 'webgl2') return null;
      return originalGetContext.call(this, contextId, options);
    };
  });
}

async function recordWebGLContextRequests(page: Page) {
  await page.addInitScript(() => {
    window.__webglContextRequests = [];
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (contextId: string, options?: unknown) {
      if (contextId === 'webgl2') {
        window.__webglContextRequests.push({
          canvasId: this.id || '',
          failIfMajorPerformanceCaveat: Boolean((options as { failIfMajorPerformanceCaveat?: boolean } | undefined)?.failIfMajorPerformanceCaveat)
        });
      }
      return originalGetContext.call(this, contextId, options);
    };
  });
}

async function waitForGraphicsMovementStable(page: Page) {
  await expect.poll(async () => {
    const state = await collectGraphicsGovernorState(page);
    return state.movementRegression;
  }, { timeout: 4_000 }).toBe(false);
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

async function triggerPortraitParticleStream(page: Page) {
  return await page.evaluate(async () => {
    const governor = await import('/js/graphics-governor.js');
    const module = await import('/js/portrait-particles.js');

    module.portraitParticles.setStreamTargetVp(window.innerWidth - 48, 48);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    const target = module.portraitParticles.streamTarget;
    const budget = governor.getGraphicsBudget('portrait-particles');
    const state = governor.getGraphicsState();
    return {
      profile: budget.profile,
      effectiveProfile: budget.effectiveProfile,
      allowPortraitStreaming: budget.allowPortraitStreaming,
      quiet: budget.quiet,
      movementRegression: budget.movementRegression,
      particleScale: budget.particleScale,
      currentSection: state.currentSection,
      downgradeSteps: state.downgradeSteps,
      streamTarget: target ? {
        x: Math.round(target.x),
        y: Math.round(target.y)
      } : null
    };
  });
}

function expectRichProfileStreamPolicy(result: Awaited<ReturnType<typeof triggerPortraitParticleStream>>, profile: 'rich' | 'full') {
  expect(result.profile).toBe(profile);

  if (result.allowPortraitStreaming) {
    expect(result.streamTarget).not.toBeNull();
    return;
  }

  expect(result.streamTarget).toBeNull();
  expect(
    result.quiet
    || result.movementRegression
    || result.particleScale <= 0
    || result.currentSection !== 'intro'
    || result.downgradeSteps > 0
  ).toBe(true);
}

function profilesForConstrainedMatrix(browserName: string): Array<'quiet' | 'balanced' | 'rich' | 'full'> {
  if (browserName === 'chromium') return ['quiet', 'balanced', 'rich', 'full'];
  if (browserName === 'firefox') return ['quiet', 'balanced'];
  return ['balanced'];
}

async function setGraphicsProfileForAudit(page: Page, profile: 'quiet' | 'balanced' | 'rich' | 'full') {
  await page.evaluate(async (nextProfile) => {
    const governor = await import('/js/graphics-governor.js');
    governor.setGraphicsProfile(nextProfile, { persist: false });
  }, profile);

  await expect(page.locator('html')).toHaveAttribute('data-graphics-profile', profile);
  await waitForGraphicsMovementStable(page);
}

async function elementSnapshot(page: Page, selector: string) {
  return await page.locator(selector).first().evaluate((element, snapshotSelector) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const visible = rect.width > 0
      && rect.height > 0
      && style.display !== 'none'
      && style.visibility !== 'hidden';

    return {
      selector: snapshotSelector,
      visible,
      top: Number(rect.top.toFixed(1)),
      left: Number(rect.left.toFixed(1)),
      right: Number(rect.right.toFixed(1)),
      bottom: Number(rect.bottom.toFixed(1)),
      width: Number(rect.width.toFixed(1)),
      height: Number(rect.height.toFixed(1))
    };
  }, selector);
}

function expectRectInsideViewport(
  rect: Awaited<ReturnType<typeof elementSnapshot>>,
  viewport: Viewport,
  label: string,
  allowance = 2
) {
  expect(rect.visible, `${label} visible`).toBe(true);
  expect(rect.left, `${label} left edge`).toBeGreaterThanOrEqual(-allowance);
  expect(rect.top, `${label} top edge`).toBeGreaterThanOrEqual(-allowance);
  expect(rect.right, `${label} right edge`).toBeLessThanOrEqual(viewport.width + allowance);
  expect(rect.bottom, `${label} bottom edge`).toBeLessThanOrEqual(viewport.height + allowance);
}

function visibleAreaRatio(rect: Awaited<ReturnType<typeof elementSnapshot>>, viewport: Viewport) {
  const visibleWidth = Math.max(0, Math.min(rect.right, viewport.width) - Math.max(rect.left, 0));
  const visibleHeight = Math.max(0, Math.min(rect.bottom, viewport.height) - Math.max(rect.top, 0));
  const area = Math.max(1, rect.width * rect.height);
  return (visibleWidth * visibleHeight) / area;
}

async function runAuditPass(page: Page, baseURL: string | undefined, browserName: string, viewport: Viewport, kind: string) {
  await page.setViewportSize(viewport);
  await installLongTaskObserver(page);

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
    longTasks: null,
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
  result.longTasks = await collectLongTaskSummary(page);
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

  test('graphics help explains profiles and stays inside constrained viewports', async ({ page, baseURL }) => {
    test.setTimeout(90_000);
    const constrainedViewports = [
      { width: 1366, height: 650 },
      { width: 390, height: 844 },
      { width: 320, height: 568 }
    ];

    for (const viewport of constrainedViewports) {
      await page.setViewportSize(viewport);
      await page.goto(urlFor(baseURL, sections[0]), { waitUntil: 'domcontentloaded' });

      const infoButton = page.getByRole('button', { name: /graphics performance help/i });
      const helpPanel = page.locator('#graphics-help-panel');

      if (viewport.width <= 700) {
        await expect(page.locator('[data-graphics-control]')).toBeHidden();
        await expect(page.locator('html')).toHaveAttribute('data-graphics-profile', /^(quiet|balanced|rich|full)$/);
        await expect(page.locator('html')).toHaveAttribute('data-graphics-effective-profile', /^(quiet|balanced|rich|full)$/);
        continue;
      }

      await expect(infoButton, `${viewport.width}x${viewport.height} info button`).toBeVisible();
      await infoButton.click();
      await expect(helpPanel, `${viewport.width}x${viewport.height} help panel`).toBeVisible();
      await expect(helpPanel).toContainText(/Chrome, Edge, or Brave/i);
      await expect(helpPanel).toContainText(/Quiet or Balanced/i);
      await expect(helpPanel).toContainText(/Rich and Full/i);
      await expect(page.locator('[data-graphics-help-status]')).toContainText(/Current recommendation:/i);

      const helpRect = await helpPanel.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
          top: rect.top,
          left: rect.left,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight
        };
      });

      expect(helpRect.left, `${viewport.width}x${viewport.height} help left`).toBeGreaterThanOrEqual(0);
      expect(helpRect.top, `${viewport.width}x${viewport.height} help top`).toBeGreaterThanOrEqual(0);
      expect(helpRect.right, `${viewport.width}x${viewport.height} help right`).toBeLessThanOrEqual(helpRect.viewportWidth);
      expect(helpRect.bottom, `${viewport.width}x${viewport.height} help bottom`).toBeLessThanOrEqual(helpRect.viewportHeight);

      await page.keyboard.press('Escape');
      await expect(helpPanel).toBeHidden();

      await page.locator('.graphics-control__toggle').click();
      await expect(page.locator('#graphics-profile-menu')).toBeVisible();
      await page.locator('#graphics-profile-menu [data-graphics-profile="quiet"]').click();
      await expect(page.locator('html')).toHaveAttribute('data-graphics-profile', 'quiet');
    }
  });

  test('constrained laptop profile matrix keeps hero and graphics controls usable', async ({ page, baseURL, browserName }) => {
    test.setTimeout(browserName === 'chromium' ? 210_000 : 150_000);
    ensureArtifactDirs();

    const profileModes = profilesForConstrainedMatrix(browserName);
    const matrixResults: unknown[] = [];
    const hero = sections[0];

    for (const viewport of constrainedLaptopViewports) {
      for (const profile of profileModes) {
        await page.setViewportSize(viewport);
        await page.goto(urlFor(baseURL, hero), { waitUntil: 'domcontentloaded' });
        await waitForActiveSection(page, hero);
        await setGraphicsProfileForAudit(page, profile);
        await page.waitForTimeout(250);

        const sectionHealth = await collectSectionHealth(page, hero);
        const title = await elementSnapshot(page, '.name.glitch-text');
        const portrait = await elementSnapshot(page, '.portrait-wrap');
        const graphicsControl = await elementSnapshot(page, '[data-graphics-control]');

        await page.locator('.graphics-control__toggle').click();
        await expect(page.locator('#graphics-profile-menu')).toBeVisible();
        const menu = await elementSnapshot(page, '#graphics-profile-menu');
        await page.keyboard.press('Escape');
        await expect(page.locator('#graphics-profile-menu')).toBeHidden();

        await page.getByRole('button', { name: /graphics performance help/i }).click();
        await expect(page.locator('#graphics-help-panel')).toBeVisible();
        const help = await elementSnapshot(page, '#graphics-help-panel');
        await page.keyboard.press('Escape');

        const state = await collectGraphicsGovernorState(page);
        const screenshotPath = path.join(
          constrainedScreenshotDir,
          `${sanitize(browserName)}-${viewport.width}x${viewport.height}-${profile}.png`
        );
        await page.screenshot({ path: screenshotPath, fullPage: false });

        const result = {
          browser: browserName,
          viewport,
          selectedProfile: state.profile,
          effectiveProfile: state.effectiveProfile,
          recommendedProfile: state.capability?.recommendedProfile,
          hardwareClass: state.capability?.hardwareClass,
          capabilityReasons: state.capability?.reasons || [],
          title,
          portrait,
          graphicsControl,
          menu,
          help,
          horizontalOverflow: sectionHealth.horizontalOverflow,
          screenshotPath: relativeArtifactPath(screenshotPath)
        };
        matrixResults.push(result);

        expect(sectionHealth.horizontalOverflow.overflowX, `${browserName} ${viewport.width}x${viewport.height} ${profile} horizontal overflow`).toBeLessThanOrEqual(2);
        expectRectInsideViewport(title, viewport, `${browserName} ${viewport.width}x${viewport.height} ${profile} title`, 4);
        expect(portrait.visible, `${browserName} ${viewport.width}x${viewport.height} ${profile} portrait visible`).toBe(true);
        expect(visibleAreaRatio(portrait, viewport), `${browserName} ${viewport.width}x${viewport.height} ${profile} portrait visible area`).toBeGreaterThanOrEqual(0.55);
        expectRectInsideViewport(graphicsControl, viewport, `${browserName} ${viewport.width}x${viewport.height} ${profile} graphics control`, 4);
        expectRectInsideViewport(menu, viewport, `${browserName} ${viewport.width}x${viewport.height} ${profile} graphics menu`, 4);
        expectRectInsideViewport(help, viewport, `${browserName} ${viewport.width}x${viewport.height} ${profile} graphics help`, 4);

        if (browserName === 'firefox' && profile === 'full') {
          expect(state.profile).toBe('balanced');
          expect(profileRank(state.effectiveProfile)).toBeLessThanOrEqual(profileRank('balanced'));
          expect(state.capability.reasons).toContain('firefox-conservative');
        }
      }
    }

    const reportPath = path.join(constrainedReportDir, `${sanitize(browserName)}-constrained-profile-matrix.json`);
    fs.writeFileSync(reportPath, JSON.stringify({
      generatedAt: new Date().toISOString(),
      browser: browserName,
      baseURL: normalizeBaseURL(baseURL),
      results: matrixResults
    }, null, 2));
  });

  test('graphics governor recommends Quiet for save-data or reduced-motion users', async ({ page, baseURL }) => {
    test.setTimeout(60_000);
    await page.addInitScript(() => {
      window.localStorage.removeItem('aris.graphicsProfile');
      Object.defineProperty(Navigator.prototype, 'connection', {
        configurable: true,
        get: () => ({ saveData: true })
      });
    });
    // Real emulation, not a matchMedia fake: a spread MediaQueryList has no addEventListener,
    // so modules that listen for changes threw at load and app.js never started.
    await page.emulateMedia({ reducedMotion: 'reduce' });

    await page.goto(urlFor(baseURL, sections[0]), { waitUntil: 'domcontentloaded' });
    await waitForGraphicsMovementStable(page);
    const state = await collectGraphicsGovernorState(page);

    expect(state.capability.recommendedProfile).toBe('quiet');
    expect(state.capability.reasons).toEqual(expect.arrayContaining(['reduced-motion', 'save-data']));
    await expect(page.locator('html')).toHaveAttribute('data-graphics-recommended-profile', 'quiet');
    await expect(page.locator('html')).toHaveAttribute('data-graphics-effective-profile', 'quiet');
  });

  test('graphics governor caps weak WebGL capability while rejecting unavailable Firefox Full selection', async ({ page, baseURL, browserName }) => {
    test.setTimeout(60_000);
    await page.addInitScript(() => {
      window.localStorage.setItem('aris.graphicsProfile', 'full');
      Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', {
        configurable: true,
        get: () => 2
      });
      Object.defineProperty(Navigator.prototype, 'deviceMemory', {
        configurable: true,
        get: () => 2
      });
      const originalGetContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (contextId: string, options?: unknown) {
        if (contextId === 'webgl2') {
          if ((options as { failIfMajorPerformanceCaveat?: boolean } | undefined)?.failIfMajorPerformanceCaveat) {
            return null;
          }
          return {
            getExtension: () => null,
            getParameter: () => 'SwiftShader'
          } as unknown as WebGL2RenderingContext;
        }
        return originalGetContext.call(this, contextId, options);
      };
    });

    await page.goto(urlFor(baseURL, sections[0]), { waitUntil: 'domcontentloaded' });
    await waitForGraphicsMovementStable(page);
    let state = await collectGraphicsGovernorState(page);

    if (browserName === 'firefox') {
      // Firefox rejects Full, so with no explicit quality choice the landing page defers the
      // WebGL probe and the software renderer is only seen once a 3D section opens.
      expect(state.profile).toBe('balanced');
      expect(state.capability.reasons).not.toContain('software-renderer');
      state = await page.evaluate(async () => {
        const governor = await import('/js/graphics-governor.js');
        governor.setGraphicsSection('work');
        return governor.getGraphicsState();
      });
    } else {
      // An explicit Full choice probes the GPU immediately, even on the landing page.
      expect(state.profile).toBe('full');
    }
    expect(state.capability.recommendedProfile).toBe('quiet');
    expect(state.capability.reasons).toEqual(expect.arrayContaining([
      'major-performance-caveat',
      'low-hardware-concurrency',
      'low-device-memory',
      'software-renderer'
    ]));
    if (browserName === 'firefox') {
      await expect(page.locator('html')).toHaveAttribute('data-graphics-profile', 'balanced');
    } else {
      await expect(page.locator('html')).toHaveAttribute('data-graphics-profile', 'full');
    }
    await expect(page.locator('html')).toHaveAttribute('data-graphics-effective-profile', 'quiet');
  });

  test('Firefox disables hero portrait particles and Rich or Full profile controls', async ({ page, baseURL, browserName }) => {
    test.skip(browserName !== 'firefox', 'Firefox-specific graphics safety policy.');
    test.setTimeout(75_000);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.addInitScript(() => {
      window.localStorage.setItem('aris.graphicsProfile', 'full');
    });

    await page.goto(urlFor(baseURL, sections[0]), { waitUntil: 'domcontentloaded' });
    await waitForGraphicsMovementStable(page);

    await expect(page.locator('html')).toHaveAttribute('data-graphics-profile', 'balanced');
    await expect(page.locator('.portrait-particles-canvas')).toHaveCount(0);
    await expect(page.locator('.portrait')).toBeVisible();

    await page.locator('.graphics-control__toggle').click();
    await expect(page.locator('[data-graphics-profile="rich"]')).toBeDisabled();
    await expect(page.locator('[data-graphics-profile="full"]')).toBeDisabled();

    await page.locator('.graphics-control__info').click();
    await expect(page.locator('#graphics-help-panel')).toContainText(/Chrome/i);
    await expect(page.locator('#graphics-help-panel')).toContainText(/Edge/i);
    await expect(page.locator('#graphics-help-panel')).toContainText(/Brave/i);
    await expect(page.locator('#graphics-help-panel')).toContainText(/Firefox/i);

    const state = await collectGraphicsGovernorState(page);
    expect(state.profile).toBe('balanced');
    expect(profileRank(state.effectiveProfile)).toBeLessThanOrEqual(profileRank('balanced'));
    expect(state.capability.reasons).toContain('firefox-conservative');
  });

  test('graphics governor defaults capable Chromium desktops to Rich and confirms it once a 3D section probes the GPU', async ({ page, baseURL, browserName }) => {
    test.skip(browserName !== 'chromium', 'The strong capability expectation is Chromium-specific.');
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
      window.localStorage.removeItem('aris.graphicsProfile');
    });
    await mockStrongWebGLCapability(page);

    await page.goto(urlFor(baseURL, sections[0]), { waitUntil: 'domcontentloaded' });
    await waitForGraphicsMovementStable(page);
    const landing = await collectGraphicsGovernorState(page);

    // The landing page defers the WebGL probe to keep startup light, so only CPU and memory are known.
    expect(landing.profileSource).toBe('auto');
    expect(landing.capability.webgl2).toBeNull();
    expect(landing.capability.hardwareClass).toBe('capable');
    expect(landing.capability.recommendedProfile).toBe('rich');
    expect(landing.profile).toBe('rich');
    expect(landing.effectiveProfile).toBe('rich');
    await expect(page.locator('.graphics-control__toggle')).toHaveText('Graphics: Rich');

    // Entering a 3D section runs the deferred probe and confirms the recommendation.
    const state = await page.evaluate(async () => {
      const governor = await import('/js/graphics-governor.js');
      governor.setGraphicsSection('work');
      return governor.getGraphicsState();
    });

    expect(state.capability.recommendedProfile).toBe('rich');
    expect(state.capability.hardwareClass).toBe('strong');
    expect(state.effectiveProfile).toBe('rich');
  });

  test('graphics governor keeps Rich after the probe only for discrete or Apple silicon GPUs', async ({ page, baseURL, browserName }) => {
    test.skip(browserName !== 'chromium', 'Rich is a Chromium recommendation.');
    test.setTimeout(150_000);
    const renderers: Array<[string, string, 'rich' | 'balanced']> = [
      ['ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 (0x00002786) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'discrete', 'rich'],
      ['ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)', 'apple', 'rich'],
      ['ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics (0x000056A0) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'discrete', 'rich'],
      ['ANGLE (Intel, Intel(R) Arc(TM) A370M Graphics (0x00005693) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'discrete', 'rich'],
      ['ANGLE (AMD, Radeon (TM) RX 480 Graphics (0x000067DF) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'discrete', 'rich'],
      ['ANGLE (Intel, Intel(R) Arc(TM) A310 LP Graphics (0x000056A6) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'discrete', 'rich'],
      ['ANGLE (Intel, Intel(R) Arc(TM) A750E Graphics (0x000056B3) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'discrete', 'rich'],
      ['ANGLE (Intel, Intel(R) Arc(TM) Pro A40/A50 Graphics (0x000056B1) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'discrete', 'rich'],
      ['ANGLE (AMD, AMD Radeon(TM) RX Vega 11 Graphics (0x000015DD) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'integrated', 'balanced'],
      ['ANGLE (Intel, Intel(R) Arc(TM) Graphics (0x00007D55) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'integrated', 'balanced'],
      ['ANGLE (Intel, Intel(R) Arc(TM) 140V GPU (16GB) (0x000064A0) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'integrated', 'balanced'],
      ['ANGLE (Intel, Intel(R) Arc(TM) 140T GPU (16GB) (0x00007D51) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'integrated', 'balanced'],
      ['ANGLE (Intel, Mesa Intel(R) Graphics (ADL GT2), OpenGL 4.6)', 'integrated', 'balanced'],
      ['ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'integrated', 'balanced'],
      ['ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001638) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'integrated', 'balanced'],
      ['AMD Radeon(TM) Vega 8 Graphics', 'integrated', 'balanced'],
      ['AMD Radeon 780M Graphics', 'integrated', 'balanced'],
      ['WebKit WebGL', 'unknown', 'balanced']
    ];

    for (const [renderer, category, profile] of renderers) {
      const probePage = await page.context().newPage();
      await probePage.setViewportSize({ width: 1440, height: 900 });
      await probePage.addInitScript(() => window.localStorage.removeItem('aris.graphicsProfile'));
      await mockRendererCapability(probePage, renderer);
      await probePage.goto(urlFor(baseURL, sections[0]), { waitUntil: 'domcontentloaded' });
      await waitForGraphicsMovementStable(probePage);
      const state = await probePage.evaluate(async () => {
        const governor = await import('/js/graphics-governor.js');
        const landing = governor.getGraphicsState().effectiveProfile;
        governor.setGraphicsSection('work');
        return { landing, ...governor.getGraphicsState() };
      });
      await probePage.close();

      // The unprobed landing starts every capable desktop on Rich.
      expect(state.landing, renderer).toBe('rich');
      expect(state.capability.rendererCategory, renderer).toBe(category);
      expect(state.capability.recommendedProfile, renderer).toBe(profile);
      expect(state.effectiveProfile, renderer).toBe(profile);
    }
  });

  test('graphics control honours an explicit Rich choice, shows overrides, and returns to Auto', async ({ page, baseURL, browserName }) => {
    test.skip(browserName === 'firefox', 'Firefox only offers Quiet and Balanced.');
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
      // Seed the choice once, so the reload after picking Auto shows what Auto stored.
      if (!window.sessionStorage.getItem('seeded')) {
        window.sessionStorage.setItem('seeded', '1');
        window.localStorage.setItem('aris.graphicsProfile', 'rich');
      }
    });
    // Integrated graphics recommend Balanced, which must not cap an explicit choice.
    await mockIntegratedWebGLCapability(page);

    await page.goto(urlFor(baseURL, sections[0]), { waitUntil: 'domcontentloaded' });
    await waitForGraphicsMovementStable(page);
    let state = await collectGraphicsGovernorState(page);
    expect(state.profileSource).toBe('user');
    expect(state.capability.recommendedProfile).toBe('balanced');
    if (browserName === 'chromium') {
      expect(state.effectiveProfile).toBe('rich');
      await expect(page.locator('.graphics-control__toggle')).toHaveText('Graphics: Rich');
    } else {
      // WebKit keeps its conservative cap and says so on the control.
      expect(state.effectiveProfile).toBe('balanced');
      await expect(page.locator('.graphics-control__toggle')).toHaveText('Graphics: Balanced (auto)');
    }

    await page.locator('.graphics-control__toggle').click();
    await expect(page.locator('#graphics-profile-menu [data-graphics-profile="rich"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#graphics-profile-menu [data-graphics-profile="auto"]')).toHaveAttribute('aria-pressed', 'false');
    const reloaded = page.waitForEvent('framenavigated');
    await page.locator('#graphics-profile-menu [data-graphics-profile="auto"]').click();
    await reloaded;
    await page.waitForLoadState('domcontentloaded');
    expect(await page.evaluate(() => window.localStorage.getItem('aris.graphicsProfile'))).toBeNull();
    state = await collectGraphicsGovernorState(page);
    expect(state.profileSource).toBe('auto');
    // Auto leaves the GPU unprobed on the landing: Chromium starts on Rich, WebKit on its Balanced cap.
    const autoTier = browserName === 'chromium' ? 'rich' : 'balanced';
    expect(state.effectiveProfile).toBe(autoTier);
    await expect(page.locator('.graphics-control__toggle')).toHaveText(`Graphics: ${autoTier === 'rich' ? 'Rich' : 'Balanced'}`);
    await expect(page.locator('#graphics-profile-menu [data-graphics-profile="auto"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#graphics-profile-menu [data-graphics-profile="rich"]')).toHaveAttribute('aria-pressed', 'false');
  });

  test('Firefox offers Auto as an enabled, pressed default that runs Balanced', async ({ page, baseURL, browserName }) => {
    test.skip(browserName !== 'firefox', 'Firefox-specific graphics policy.');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => window.localStorage.removeItem('aris.graphicsProfile'));
    await page.goto(urlFor(baseURL, sections[0]), { waitUntil: 'domcontentloaded' });
    await waitForGraphicsMovementStable(page);
    const state = await collectGraphicsGovernorState(page);
    expect(state.profileSource).toBe('auto');
    expect(state.effectiveProfile).toBe('balanced');
    await expect(page.locator('.graphics-control__toggle')).toHaveText('Graphics: Balanced');
    const auto = page.locator('#graphics-profile-menu [data-graphics-profile="auto"]');
    await expect(auto).toHaveAttribute('aria-pressed', 'true');
    await expect(auto).toBeEnabled();
  });

  test('WebGL-heavy sections request protected contexts before starting scenes', async ({ page, baseURL }) => {
    test.setTimeout(75_000);
    await recordWebGLContextRequests(page);

    await page.goto(urlFor(baseURL, sections.find((section) => section.name === 'blog')!), { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#blog')).toHaveClass(/active-section/);
    await page.waitForFunction(() => window.__webglContextRequests.some((request) => {
      return request.canvasId === 'blog-network-canvas' && request.failIfMajorPerformanceCaveat;
    }));

    const work = sections.find((section) => section.name === 'work')!;
    await switchSection(page, work);
    await page.waitForFunction(() => window.__webglContextRequests.some((request) => {
      return request.canvasId === 'work-globe-canvas' && request.failIfMajorPerformanceCaveat;
    }));

    const requests = await page.evaluate(() => window.__webglContextRequests);
    expect(requests).toEqual(expect.arrayContaining([
      expect.objectContaining({
        canvasId: 'blog-network-canvas',
        failIfMajorPerformanceCaveat: true
      }),
      expect.objectContaining({
        canvasId: 'work-globe-canvas',
        failIfMajorPerformanceCaveat: true
      })
    ]));
  });

  test('WebGL-heavy sections show intentional reduced-graphics fallback when WebGL2 is unavailable', async ({ page, baseURL }) => {
    test.setTimeout(75_000);
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text());
      }
    });
    await mockUnavailableWebGL2(page);

    await page.goto(urlFor(baseURL, sections.find((section) => section.name === 'blog')!), { waitUntil: 'domcontentloaded' });
    const blogFallback = page.locator('#blog .webgl-fallback-visible').first();
    await expect(blogFallback).toBeVisible();
    await expect(blogFallback).toContainText(/Graphics are reduced/i);

    const work = sections.find((section) => section.name === 'work')!;
    await switchSection(page, work);
    const workFallback = page.locator('#work .webgl-fallback-visible').first();
    await expect(workFallback).toBeVisible();
    await expect(workFallback).toContainText(/Graphics are reduced/i);

    expect(consoleErrors.filter((error) => /WebGL2|webgl/i.test(error))).toEqual([]);
  });

  test('quiet graphics profile applies low-cost budgets to visual systems', async ({ page, baseURL }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.addInitScript(() => {
      window.localStorage.setItem('aris.graphicsProfile', 'quiet');
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
      const fallback = document.querySelector('#work .webgl-fallback-visible');
      return {
        backingWidth: canvas.width,
        backingHeight: canvas.height,
        cssWidth: rect.width,
        cssHeight: rect.height,
        devicePixelRatio: window.devicePixelRatio,
        fallbackVisible: Boolean(fallback && getComputedStyle(fallback).display !== 'none')
      };
    });

    expect(workCanvas).not.toBeNull();
    expect(workCanvas!.devicePixelRatio).toBe(2);
    if (workCanvas!.fallbackVisible) {
      expect(workCanvas!.backingWidth).toBeLessThanOrEqual(1);
      expect(workCanvas!.backingHeight).toBeLessThanOrEqual(1);
      await expect(page.locator('#work .webgl-fallback-visible')).toContainText(/Graphics are reduced/i);
    } else {
      expect(workCanvas!.backingWidth).toBeLessThanOrEqual(Math.ceil(workCanvas!.cssWidth * 1.05));
      expect(workCanvas!.backingHeight).toBeLessThanOrEqual(Math.ceil(workCanvas!.cssHeight * 1.05));
    }
  });

  test('portrait stream targets are reserved for rich and full graphics profiles', async ({ page, baseURL, browserName }) => {
    test.setTimeout(75_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    if (browserName === 'chromium') {
      await mockStrongWebGLCapability(page);
    }
    await page.addInitScript(() => {
      window.localStorage.setItem('aris.graphicsProfile', 'balanced');
    });

    await page.goto(urlFor(baseURL, sections[0]), { waitUntil: 'domcontentloaded' });
    if (browserName === 'firefox') {
      await expect(page.locator('.portrait-particles-canvas')).toHaveCount(0);
      return;
    }

    await expect(page.locator('.portrait-particles-canvas')).toHaveCount(1);
    await expect.poll(async () => {
      const stats = await collectPortraitParticleStats(page);
      return stats.backingWidth * stats.backingHeight;
    }, { timeout: 6_000 }).toBeGreaterThan(1);

    const balanced = await triggerPortraitParticleStream(page);
    expect(balanced.profile).toBe('balanced');
    expect(balanced.allowPortraitStreaming).toBe(false);
    expect(balanced.streamTarget).toBeNull();

    await page.evaluate(async () => {
      const governor = await import('/js/graphics-governor.js');
      const module = await import('/js/portrait-particles.js');
      module.portraitParticles.clearStream();
      governor.setGraphicsProfile('rich', { persist: false });
    });
    await waitForGraphicsMovementStable(page);

    const rich = await triggerPortraitParticleStream(page);
    expectRichProfileStreamPolicy(rich, 'rich');

    await page.goto(urlFor(baseURL, sections[0]), { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.portrait-particles-canvas')).toHaveCount(1);
    await expect.poll(async () => {
      const stats = await collectPortraitParticleStats(page);
      return stats.backingWidth * stats.backingHeight;
    }, { timeout: 6_000 }).toBeGreaterThan(1);

    await page.evaluate(async () => {
      const governor = await import('/js/graphics-governor.js');
      governor.setGraphicsProfile('full', { persist: false });
    });
    await waitForGraphicsMovementStable(page);

    const full = await triggerPortraitParticleStream(page);
    expectRichProfileStreamPolicy(full, 'full');

    const reverted = await page.evaluate(async () => {
      const governor = await import('/js/graphics-governor.js');
      const module = await import('/js/portrait-particles.js');
      governor.setGraphicsProfile('balanced', { persist: false });
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const target = module.portraitParticles.streamTarget;
      const budget = governor.getGraphicsBudget('portrait-particles');
      return {
        profile: budget.profile,
        allowPortraitStreaming: budget.allowPortraitStreaming,
        streamTarget: target ? { x: Math.round(target.x), y: Math.round(target.y) } : null
      };
    });

    expect(reverted.profile).toBe('balanced');
    expect(reverted.allowPortraitStreaming).toBe(false);
    expect(reverted.streamTarget).toBeNull();
  });

  test('graphics governor tracks active section and temporary movement regression', async ({ page, baseURL }) => {
    test.setTimeout(60_000);
    await page.addInitScript(() => {
      window.localStorage.setItem('aris.graphicsProfile', 'rich');
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
    if (browserName === 'chromium') {
      await mockStrongWebGLCapability(page);
    }
    await page.addInitScript(() => {
      window.localStorage.setItem('aris.graphicsProfile', 'balanced');
    });

    await page.goto(urlFor(baseURL, sections[0]), { waitUntil: 'domcontentloaded' });
    if (browserName === 'firefox') {
      await expect(page.locator('.portrait-particles-canvas')).toHaveCount(0);
      const stats = await collectPortraitParticleStats(page);
      expect(stats.initialized).toBe(false);
      return;
    }

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
    // While particles draw the portrait, the photo underneath is dimmed inline.
    await expect.poll(() => page.locator('.portrait').evaluate((img: HTMLImageElement) => img.style.opacity)).not.toBe('');

    const contact = sections.find((section) => section.name === 'contact')!;
    await switchSection(page, contact);

    await expect.poll(async () => {
      const stats = await collectPortraitParticleStats(page);
      return stats.backingWidth * stats.backingHeight;
    }).toBeLessThanOrEqual(1);

    const inactiveStats = await collectPortraitParticleStats(page);
    expect(inactiveStats.running).toBe(false);
    // A released canvas draws nothing, so the photo returns to its stylesheet opacity.
    expect(await page.locator('.portrait').evaluate((img: HTMLImageElement) => img.style.opacity)).toBe('');
  });

  test('constrained engines apply stricter heavy-graphics budgets', async ({ page, baseURL, browserName }) => {
    test.setTimeout(60_000);
    test.skip(browserName === 'chromium', 'Chromium keeps the standard balanced budget.');

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
      window.localStorage.setItem('aris.graphicsProfile', 'balanced');
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
