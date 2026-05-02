import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const partsDir = path.join(repoRoot, 'artifacts', 'browser-audit-parts');
const reportPath = path.join(repoRoot, 'artifacts', 'browser-audit-report.json');

function readParts() {
  if (!fs.existsSync(partsDir)) return [];

  return fs.readdirSync(partsDir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => {
      const fullPath = path.join(partsDir, file);
      return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    })
    .sort((a, b) => {
      const browser = String(a.browser).localeCompare(String(b.browser));
      if (browser !== 0) return browser;
      const av = `${a.viewport?.width || 0}x${a.viewport?.height || 0}`;
      const bv = `${b.viewport?.width || 0}x${b.viewport?.height || 0}`;
      const viewport = av.localeCompare(bv, undefined, { numeric: true });
      if (viewport !== 0) return viewport;
      return String(a.kind || '').localeCompare(String(b.kind || ''));
    });
}

function flattenTimings(result) {
  const entries = [];
  for (const [section, timing] of Object.entries(result.frameTimings || {})) {
    entries.push({ result, section, timing });
  }
  if (result.scrollJank) {
    entries.push({ result, section: 'scroll', timing: result.scrollJank });
  }
  return entries;
}

function isKnownExternalPageError(message) {
  return /challenges\.cloudflare\.com/i.test(message)
    || message === 'NetworkError when attempting to fetch resource.'
    || /^[A-Za-z_$][\w$]*\[[A-Za-z_$][\w$]*\(\.\.\.\)\] is not a function$/.test(message);
}

function buildSummary(results) {
  const pageErrors = [];
  const knownExternalPageErrors = [];
  const reportablePageErrors = [];
  const consoleErrors = [];
  const failedRequests = [];
  const horizontalOverflow = [];
  const dangerousCanvases = [];
  const missingWebGL2 = [];
  const slowTimings = [];
  const longTaskHotspots = [];

  for (const result of results) {
    const label = `${result.browser} ${result.viewport?.width}x${result.viewport?.height} ${result.kind || 'standard'}`;
    result.reportablePageErrors = [];

    for (const error of result.pageErrors || []) {
      pageErrors.push({ label, error });
      if (isKnownExternalPageError(error)) {
        knownExternalPageErrors.push({ label, error });
      } else {
        result.reportablePageErrors.push(error);
        reportablePageErrors.push({ label, error });
      }
    }

    for (const error of result.consoleErrors || []) {
      consoleErrors.push({ label, error });
    }

    for (const request of result.failedRequests || []) {
      if (request.sameOrigin && request.status >= 400 && !/\/favicon\.ico(?:$|\?)/.test(request.url)) {
        failedRequests.push({ label, request });
      }
    }

    for (const section of result.sections || []) {
      if ((section.horizontalOverflow?.overflowX || 0) > 2) {
        horizontalOverflow.push({
          label,
          section: section.name,
          overflowX: section.horizontalOverflow.overflowX,
          offenders: section.horizontalOverflow.offenders
        });
      }

      if (section.webgl2Available === false) {
        missingWebGL2.push({ label, section: section.name });
      }

      for (const canvas of section.canvases || []) {
        if (canvas.dangerouslyLarge) {
          dangerousCanvases.push({ label, section: section.name, canvas });
        }
      }
    }

    for (const entry of flattenTimings(result)) {
      if ((entry.timing.framesOver100ms || 0) > 0 || (entry.timing.framesOver50ms || 0) > 3) {
        slowTimings.push({
          label,
          section: entry.section,
          approximateFps: entry.timing.approximateFps,
          averageFrameDeltaMs: entry.timing.averageFrameDeltaMs,
          maxFrameDeltaMs: entry.timing.maxFrameDeltaMs,
          framesOver50ms: entry.timing.framesOver50ms,
          framesOver100ms: entry.timing.framesOver100ms
        });
      }
    }

    if ((result.longTasks?.count || 0) > 0) {
      longTaskHotspots.push({
        label,
        count: result.longTasks.count,
        totalDurationMs: result.longTasks.totalDurationMs,
        maxDurationMs: result.longTasks.maxDurationMs,
        over100ms: result.longTasks.over100ms,
        top: result.longTasks.top
      });
    }
  }

  slowTimings.sort((a, b) => {
    const byLongFrames = (b.framesOver100ms || 0) - (a.framesOver100ms || 0);
    if (byLongFrames !== 0) return byLongFrames;
    return (b.maxFrameDeltaMs || 0) - (a.maxFrameDeltaMs || 0);
  });

  longTaskHotspots.sort((a, b) => {
    const byTotal = (b.totalDurationMs || 0) - (a.totalDurationMs || 0);
    if (byTotal !== 0) return byTotal;
    return (b.maxDurationMs || 0) - (a.maxDurationMs || 0);
  });

  return {
    resultCount: results.length,
    pageErrorCount: pageErrors.length,
    knownExternalPageErrorCount: knownExternalPageErrors.length,
    reportablePageErrorCount: reportablePageErrors.length,
    consoleErrorCount: consoleErrors.length,
    failedSameOriginRequestCount: failedRequests.length,
    horizontalOverflowCount: horizontalOverflow.length,
    dangerousCanvasCount: dangerousCanvases.length,
    missingWebGL2Count: missingWebGL2.length,
    slowTimingCount: slowTimings.length,
    longTaskHotspotCount: longTaskHotspots.length,
    pageErrors,
    knownExternalPageErrors,
    reportablePageErrors,
    failedRequests,
    horizontalOverflow,
    dangerousCanvases,
    missingWebGL2,
    slowTimings: slowTimings.slice(0, 40),
    longTaskHotspots: longTaskHotspots.slice(0, 40)
  };
}

const results = readParts();
const report = {
  generatedAt: new Date().toISOString(),
  summary: buildSummary(results),
  results
};

fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(`Wrote ${path.relative(repoRoot, reportPath)} with ${results.length} result entries.`);
