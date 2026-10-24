// The nav-route debugging overlay, opened with ?hud on the development tree. It draws each label's
// anchor, its locked route and where the label really sits, and warns when a label drifts off its
// route. Production never ships this file: scripts/public-files.json leaves it out and the build
// turns ?hud off (js/state.js).

import { NAV_COORDS } from './config.js';
import { LOCKED_ROUTES } from './state.js';
import { toViewport } from './viewport.js';

let hudCanvas = null;
let hudCtx = null;

function ensureCanvas() {
  if (!hudCanvas) {
    hudCanvas = document.createElement('canvas');
    hudCanvas.id = 'hud-canvas';
    hudCanvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9999;';
    document.body.appendChild(hudCanvas);
    hudCtx = hudCanvas.getContext('2d');
  }
  if (hudCanvas.width !== window.innerWidth) hudCanvas.width = window.innerWidth;
  if (hudCanvas.height !== window.innerHeight) hudCanvas.height = window.innerHeight;
}

export function renderHUD() {
  ensureCanvas();

  hudCtx.clearRect(0, 0, hudCanvas.width, hudCanvas.height);

  for (const [id, pt] of Object.entries(NAV_COORDS)) {
    const [tx, ty] = toViewport(pt.x, pt.y);

    hudCtx.fillStyle = '#fff';
    hudCtx.beginPath();
    hudCtx.arc(tx, ty, 4, 0, Math.PI * 2);
    hudCtx.fill();

    hudCtx.fillStyle = '#fff';
    hudCtx.font = '10px monospace';
    hudCtx.fillText(`${id} anchor`, tx + 8, ty - 8);

    const route = LOCKED_ROUTES[id];
    if (route && route.projPts.length > 1) {
      hudCtx.strokeStyle = 'rgba(0,255,255,.4)';
      hudCtx.lineWidth = 1;
      hudCtx.beginPath();
      hudCtx.moveTo(route.projPts[0][0], route.projPts[0][1]);
      for (let i = 1; i < route.projPts.length; i++) {
        hudCtx.lineTo(route.projPts[i][0], route.projPts[i][1]);
      }
      hudCtx.stroke();
      hudCtx.lineWidth = 1;
    }

    const el = document.querySelector(`[data-node="${id}"]`);
    if (el) {
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;

      hudCtx.fillStyle = '#0f0';
      hudCtx.beginPath();
      hudCtx.arc(cx, cy, 3, 0, Math.PI * 2);
      hudCtx.fill();

      hudCtx.fillStyle = '#0f0';
      hudCtx.fillText(`live (${Math.round(cx)},${Math.round(cy)})`, cx + 8, cy + 16);

      if (route && route.projPts.length > 1) {
        let minDist = Infinity;
        for (let i = 1; i < route.projPts.length; i++) {
          const [x0, y0] = route.projPts[i - 1];
          const [x1, y1] = route.projPts[i];
          const dx = x1 - x0;
          const dy = y1 - y0;
          const len = Math.hypot(dx, dy);
          if (len < 1e-6) continue;

          const t = Math.max(0, Math.min(1, ((cx - x0) * dx + (cy - y0) * dy) / (len * len)));
          const projX = x0 + t * dx;
          const projY = y0 + t * dy;
          const dist = Math.hypot(cx - projX, cy - projY);
          minDist = Math.min(minDist, dist);
        }

        if (minDist > 8) {
          console.warn(`[LOCKED-ROUTE] HUD: ${id} label is ${minDist.toFixed(1)}px off its route (should be <8px)`);
        }
      }
    }
  }
}
