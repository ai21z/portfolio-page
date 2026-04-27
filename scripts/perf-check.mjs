import { chromium, firefox } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';

const PORT = Number(process.env.PERF_PORT || 4173);
const BASE_URL = process.env.PERF_URL || `http://127.0.0.1:${PORT}`;
const ENTRY_URL = `${BASE_URL}/index.html`;
const START_SERVER = process.env.PERF_NO_SERVER !== '1';
const BROWSERS = (process.env.PERF_BROWSERS || 'chromium,firefox')
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean);
const SAMPLE_MS = Number(process.env.PERF_SAMPLE_MS || 1_500);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(url, timeoutMs = 20_000) {
  const started = Date.now();
  let lastError;

  while (Date.now() - started < timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2_000);

    try {
      const response = await fetch(url, { signal: controller.signal });
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
    await sleep(250);
  }

  throw new Error(`Timed out waiting for ${url}: ${lastError?.message || 'unknown error'}`);
}

function startServer() {
  const child = spawn('npm', ['run', 'preview'], {
    cwd: process.cwd(),
    env: process.env,
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe']
  });

  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});

  return child;
}

function stopServer(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill();
  }
}

async function sampleFrames(page, label, durationMs = SAMPLE_MS) {
  return page.evaluate(
    ({ label: sampleLabel, duration }) =>
      new Promise((resolve) => {
        const start = performance.now();
        let frames = 0;
        let maxGap = 0;
        let last = start;
        let done = false;

        const finish = (now, timedOut = false) => {
          if (done) return;
          done = true;
          const elapsed = Math.max(now - start, 1);
          resolve({
            label: sampleLabel,
            frames,
            durationMs: Math.round(elapsed),
            fps: Math.round((frames * 1000) / elapsed),
            maxFrameGapMs: Math.round(maxGap),
            timedOut
          });
        };

        setTimeout(() => finish(performance.now(), true), duration + 1_000);

        function tick(now) {
          if (done) return;
          frames += 1;
          maxGap = Math.max(maxGap, now - last);
          last = now;

          if (now - start >= duration) {
            finish(now);
            return;
          }

          requestAnimationFrame(tick);
        }

        requestAnimationFrame(tick);
      }),
    { label, duration: durationMs }
  );
}

async function gotoSection(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  let loadTimedOut = false;
  await page.waitForLoadState('load', { timeout: 10_000 }).catch(() => {
    loadTimedOut = true;
  });
  return { loadTimedOut };
}

async function runBrowser(name, browserType) {
  console.error(`[perf] launching ${name}`);
  const browser = await browserType.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });

  const consoleMessages = [];
  const requestFailures = [];
  const pageErrors = [];

  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) {
      consoleMessages.push({
        type: message.type(),
        text: message.text().slice(0, 500)
      });
    }
  });
  page.on('requestfailed', (request) => {
    requestFailures.push({
      url: request.url(),
      failure: request.failure()?.errorText || 'unknown'
    });
  });
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  await page.addInitScript(() => {
    window.__perfProbe = {
      longTasks: [],
      contexts: [],
      rafCallbacks: 0,
      rafScheduled: 0
    };

    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__perfProbe.longTasks.push({
            startTime: Math.round(entry.startTime),
            duration: Math.round(entry.duration)
          });
        }
      });
      observer.observe({ type: 'longtask', buffered: true });
    } catch {
      window.__perfProbe.longTasksUnsupported = true;
    }

    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function patchedGetContext(type, ...args) {
      const started = performance.now();
      const context = originalGetContext.call(this, type, ...args);
      const duration = performance.now() - started;

      if (String(type).includes('webgl') || type === '2d') {
        window.__perfProbe.contexts.push({
          id: this.id || this.className || '(anonymous canvas)',
          type,
          durationMs: Number(duration.toFixed(2)),
          cssWidth: this.clientWidth,
          cssHeight: this.clientHeight,
          bufferWidth: this.width,
          bufferHeight: this.height
        });
      }

      return context;
    };

    const originalRaf = window.requestAnimationFrame;
    window.requestAnimationFrame = function patchedRaf(callback) {
      window.__perfProbe.rafScheduled += 1;
      return originalRaf.call(window, (timestamp) => {
        window.__perfProbe.rafCallbacks += 1;
        callback(timestamp);
      });
    };
  });

  await page.route('https://challenges.cloudflare.com/**', (route) => {
    route.fulfill({
      status: 204,
      contentType: 'application/javascript',
      body: ''
    });
  });

  const started = Date.now();
  console.error(`[perf] ${name}: intro`);
  const introLoad = await gotoSection(page, ENTRY_URL);
  const gotoWallMs = Date.now() - started;
  await page.waitForTimeout(500);

  const introFrames = await sampleFrames(page, 'intro');

  console.error(`[perf] ${name}: work`);
  const workLoad = await gotoSection(page, `${ENTRY_URL}#work`);
  await page.waitForTimeout(500);
  const workFrames = await sampleFrames(page, 'work');

  console.error(`[perf] ${name}: blog`);
  const blogLoad = await gotoSection(page, `${ENTRY_URL}#blog`);
  await page.waitForTimeout(500);
  const blogFrames = await sampleFrames(page, 'blog');

  const metrics = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0]?.toJSON?.() || {};
    const paints = performance.getEntriesByType('paint').map((entry) => ({
      name: entry.name,
      startTime: Math.round(entry.startTime)
    }));
    const resources = performance
      .getEntriesByType('resource')
      .map((entry) => ({
        name: entry.name.replace(location.origin + '/', ''),
        duration: Math.round(entry.duration),
        transferSize: entry.transferSize || 0,
        encodedBodySize: entry.encodedBodySize || 0
      }))
      .sort((a, b) => b.encodedBodySize - a.encodedBodySize)
      .slice(0, 12);

    return {
      userAgent: navigator.userAgent,
      domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd || 0),
      loadEventMs: Math.round(nav.loadEventEnd || 0),
      paints,
      resources,
      perfProbe: window.__perfProbe
    };
  });

  console.error(`[perf] closing ${name}`);
  await browser.close();

  return {
    browser: name,
    gotoWallMs,
    consoleMessages,
    requestFailures,
    pageErrors,
    frames: [introFrames, workFrames, blogFrames],
    loadWaits: { intro: introLoad, work: workLoad, blog: blogLoad },
    ...metrics
  };
}

async function main() {
  let server;
  try {
    if (START_SERVER) server = startServer();
    await waitForServer(`${BASE_URL}/index.html`);

    const results = [];
    const availableBrowsers = new Map([
      ['chromium', chromium],
      ['firefox', firefox]
    ]);

    for (const name of BROWSERS) {
      const browserType = availableBrowsers.get(name);
      if (!browserType) {
        results.push({
          browser: name,
          error: `Unknown browser "${name}"`
        });
        continue;
      }

      try {
        results.push(await runBrowser(name, browserType));
      } catch (error) {
        results.push({
          browser: name,
          error: error.message
        });
      }
    }

    console.log(JSON.stringify(results, null, 2));
  } finally {
    if (server) {
      stopServer(server);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
