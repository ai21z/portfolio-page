// Utility functions

export function isFirefox() {
  return /\bFirefox\//.test(navigator.userAgent);
}

export function cappedDpr(max = 1.5) {
  const dpr = window.devicePixelRatio || 1;
  const browserMax = isFirefox() ? Math.min(max, 1.25) : max;
  return Math.min(Math.max(1, dpr), browserMax);
}

export function sizeCanvas(canvas) {
  if (!canvas) return;
  const dpr = cappedDpr(1.5);
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
