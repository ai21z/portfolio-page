/**
 * Pure utility functions for geometry, canvas, and animation helpers
 * Extracted from script.js with ZERO changes to signatures or behavior
 */

/**
 * Size a canvas to match viewport with device pixel ratio
 */
export function sizeCanvas(canvas) {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/**
 * Compute cumulative arc lengths along a polyline
 * @param {Array} pts - Array of [x, y] points
 * @returns {Array} Cumulative lengths
 */
export function cumulativeLengths(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[i - 1][0];
    const dy = pts[i][1] - pts[i - 1][1];
    cum.push(cum[i - 1] + Math.hypot(dx, dy));
  }
  return cum;
}

/**
 * Get point at arc-length position along a polyline
 * @param {Array} pts - Array of [x, y] points
 * @param {Array} cum - Cumulative lengths
 * @param {number} s - Arc-length position
 * @returns {Array} [x, y] point
 */
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

/**
 * Throttle function with requestAnimationFrame fallback
 * @param {Function} fn - Function to throttle
 * @param {number} ms - Minimum time between calls in milliseconds (default: 125)
 * @returns {Function} Throttled function
 */
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

/**
 * Get viewport size using visualViewport API when available
 * Provides more accurate viewport dimensions on mobile devices
 * @returns {{w: number, h: number}} Viewport width and height
 */
export const viewportSize = () => {
  const vv = window.visualViewport;
  return {
    w: window.innerWidth,
    h: vv ? Math.round(vv.height) : window.innerHeight
  };
};
