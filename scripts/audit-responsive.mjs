import { chromium, firefox } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const port = Number(process.env.AUDIT_PORT || 4180);
const baseURL = `http://127.0.0.1:${port}`;
const outRoot = path.join(root, 'artifacts', 'audit-screenshots');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(outRoot, stamp);

const viewports = [
  [320, 568],
  [360, 640],
  [375, 667],
  [390, 844],
  [414, 896],
  [430, 932],
  [768, 1024],
  [820, 1180],
  [1024, 768],
  [1280, 720],
  [1366, 768],
  [1440, 900],
  [1536, 864],
  [1920, 1080],
  [2560, 1440]
];

const sections = ['intro', 'about', 'skills', 'now', 'blog', 'work', 'contact'];
const browsers = [
  ['chromium', chromium],
  ['firefox', firefox]
];

async function waitForServer() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseURL}/index.html`);
      if (response.ok) return;
    } catch {
      // keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${baseURL}`);
}

function startServer() {
  const child = spawn('npx', ['http-server', '.', '-p', String(port), '-a', '127.0.0.1', '-c-1'], {
    cwd: root,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', (chunk) => process.stderr.write(`[server] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[server] ${chunk}`));
  return child;
}

async function stopServer(child) {
  if (!child || child.killed) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}

async function collectMetrics(page, section) {
  return await page.evaluate((sectionName) => {
    const active = document.querySelector(`.stage.active-section[data-section="${sectionName}"]`)
      || document.querySelector('.stage.active-section');
    const activeRect = active?.getBoundingClientRect();
    const visibleElements = Array.from(document.querySelectorAll('body *')).filter((el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    });
    const overflowElements = visibleElements
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          tag: el.tagName.toLowerCase(),
          id: el.id || '',
          className: typeof el.className === 'string' ? el.className : '',
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
          text: (el.textContent || '').trim().slice(0, 70)
        };
      })
      .filter((item) => item.left < -2 || item.right > window.innerWidth + 2)
      .slice(0, 15);

    const tapTargets = Array.from(document.querySelectorAll('a,button,input,select,textarea,[role="button"],[tabindex]:not([tabindex="-1"])'))
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      })
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          tag: el.tagName.toLowerCase(),
          id: el.id || '',
          className: typeof el.className === 'string' ? el.className : '',
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 60)
        };
      });

    const smallTapTargets = tapTargets
      .filter((target) => target.width < 44 || target.height < 44)
      .slice(0, 15);

    const canvases = Array.from(document.querySelectorAll('canvas')).map((canvas) => {
      const rect = canvas.getBoundingClientRect();
      return {
        id: canvas.id || '',
        className: canvas.className || '',
        cssWidth: Math.round(rect.width),
        cssHeight: Math.round(rect.height),
        bufferWidth: canvas.width,
        bufferHeight: canvas.height
      };
    });

    return {
      url: location.href,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      documentScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      overflowX: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
      activeSection: active?.getAttribute('data-section') || '',
      activeRect: activeRect ? {
        top: Math.round(activeRect.top),
        left: Math.round(activeRect.left),
        width: Math.round(activeRect.width),
        height: Math.round(activeRect.height),
        bottom: Math.round(activeRect.bottom)
      } : null,
      activeScrollHeight: active?.scrollHeight || 0,
      activeClientHeight: active?.clientHeight || 0,
      overflowElements,
      tapTargetCount: tapTargets.length,
      smallTapTargets,
      canvases
    };
  }, section);
}

await fs.mkdir(outDir, { recursive: true });
const server = startServer();
const results = [];

try {
  await waitForServer();
  for (const [browserName, launcher] of browsers) {
    const browser = await launcher.launch();
    for (const [width, height] of viewports) {
      const context = await browser.newContext({ viewport: { width, height } });
      const page = await context.newPage();
      const consoleMessages = [];
      const pageErrors = [];
      const requestFailures = [];
      page.on('console', (message) => {
        if (message.type() === 'error' || message.type() === 'warning') {
          consoleMessages.push({ type: message.type(), text: message.text().slice(0, 240) });
        }
      });
      page.on('pageerror', (error) => pageErrors.push(error.message));
      page.on('requestfailed', (request) => {
        const url = request.url();
        if (url.startsWith(baseURL)) {
          requestFailures.push({ url, failure: request.failure()?.errorText || '' });
        }
      });

      for (const section of sections) {
        const hash = section === 'intro' ? '' : `#${section}`;
        await page.goto(`${baseURL}/index.html${hash}`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(section === 'work' || section === 'blog' ? 1000 : 500);
        const metrics = await collectMetrics(page, section);
        const screenshotName = `${browserName}-${width}x${height}-${section}.png`;
        await page.screenshot({ path: path.join(outDir, screenshotName), fullPage: false });
        results.push({
          browser: browserName,
          viewport: `${width}x${height}`,
          section,
          screenshot: screenshotName,
          consoleMessages: [...consoleMessages],
          pageErrors: [...pageErrors],
          requestFailures: [...requestFailures],
          metrics
        });
        consoleMessages.length = 0;
        pageErrors.length = 0;
        requestFailures.length = 0;
      }
      await context.close();
    }
    await browser.close();
  }
} finally {
  await stopServer(server);
}

const summaryPath = path.join(outDir, 'audit-summary.json');
await fs.writeFile(summaryPath, JSON.stringify({ outDir, results }, null, 2));
console.log(summaryPath);
