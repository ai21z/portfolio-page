// Utility functions
import { getGraphicsBudget } from './graphics-governor.js';

export function isFirefox() {
  return /\bFirefox\//.test(navigator.userAgent);
}

export function isWebKit() {
  return /AppleWebKit/i.test(navigator.userAgent)
    && !/(Chrome|Chromium|Edg|OPR|Firefox)/i.test(navigator.userAgent);
}

export function cappedDpr(max = 1.5, options = {}) {
  const {
    systemName = 'canvas',
    width = window.innerWidth,
    height = window.innerHeight,
    min = 0.5
  } = options;
  const budget = getGraphicsBudget(systemName);
  const dpr = window.devicePixelRatio || 1;
  const browserMax = (isFirefox() || isWebKit()) ? Math.min(max, 1.25) : max;
  let target = Math.min(Math.max(1, dpr), browserMax, budget.dprCap);

  const cssPixels = Math.max(1, width * height);
  if (budget.maxCanvasPixels && cssPixels > 0) {
    target = Math.min(target, Math.sqrt(budget.maxCanvasPixels / cssPixels));
  }

  return Math.max(min, target);
}

export function sizeCanvas(canvas, options = {}) {
  if (!canvas) return;
  const width = options.width ?? window.innerWidth;
  const height = options.height ?? window.innerHeight;
  const dpr = cappedDpr(options.maxDpr ?? 1.5, {
    systemName: options.systemName ?? 'canvas',
    width,
    height,
    min: options.minDpr ?? 0.5
  });
  canvas.width = Math.max(1, Math.floor(width * dpr));
  canvas.height = Math.max(1, Math.floor(height * dpr));
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d');
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  return dpr;
}

// Cumulative arc lengths along polyline
export function cumulativeLengths(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[i - 1][0];
    const dy = pts[i][1] - pts[i - 1][1];
    cum.push(cum[i - 1] + Math.hypot(dx, dy));
  }
  return cum;
}

// Point at arc length position along polyline
export function pointAt(pts, cum, s) {
  const total = cum[cum.length - 1];
  if (s <= 0) return pts[0];
  if (s >= total) return pts[pts.length - 1];

  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] < s) lo = mid + 1; else hi = mid;
  }

  const i = Math.max(1, lo);
  const segStart = cum[i - 1];
  const segLen = cum[i] - segStart;
  const t = segLen ? (s - segStart) / segLen : 0;
  const ax = pts[i - 1][0];
  const ay = pts[i - 1][1];
  const bx = pts[i][0];
  const by = pts[i][1];
  return [ax + (bx - ax) * t, ay + (by - ay) * t];
}

export const throttle = (fn, ms = 125) => {
  let t = 0, raf = 0;
  return (...args) => {
    const now = performance.now();
    if (now - t > ms) {
      t = now;
      fn(...args);
    } else {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        t = performance.now();
        fn(...args);
      });
    }
  };
};

export const viewportSize = () => {
  const vv = window.visualViewport;
  return {
    w: window.innerWidth,
    h: vv ? Math.round(vv.height) : window.innerHeight
  };
};
