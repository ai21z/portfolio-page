// The landing's way into a section. A node's click lights its route through the hub to the node, the
// brightest thing on screen while the rest of the landing dims, and the section opens behind a closed
// lens at once, so it builds while the route grows. Once the section has painted (its scene drawn, or
// two frames for the paper views), the lens opens from the node: a hypha-green margin that wanders like
// a colony's edge, the section inside it, the landing whole outside it. Readable by about 0.5 s, done by
// 0.9 s.
//
// Any other route change while it runs (Back or Forward, a wheel step, a link, a resize) finishes it at
// once, so the page always ends where the router says. Reduced motion and Quiet keep the plain switch,
// and section-to-section moves keep the crossfade.
import { LOCKED_ROUTES } from './state.js';
import { getGraphicsBudget } from './graphics-governor.js';
import { reducedMotion } from './motion.js';

const ROUTE_MS = 280;
const OPEN_EARLIEST = 220;
const OPEN_LATEST = 320;
const OPEN_MS = 400;
const END_MS = 880;
const MAX_ROUTE = 420;    // px of route the comet travels, ending at the node
const DIM = 0.42;

const ease = (t) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const frames = (n) => new Promise((resolve) => { const step = (k) => (k ? requestAnimationFrame(() => step(k - 1)) : resolve()); step(n); });
const center = (el) => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };

const glow = document.createElement('canvas');
glow.width = glow.height = 64;
{
  const g = glow.getContext('2d');
  const gradient = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(230,255,240,1)');
  gradient.addColorStop(0.18, 'rgba(220,255,235,0.8)');
  gradient.addColorStop(0.45, 'rgba(122,174,138,0.35)');
  gradient.addColorStop(1, 'rgba(143,180,255,0)');
  g.fillStyle = gradient;
  g.fillRect(0, 0, 64, 64);
}

let current = null;

export function growTransitionAllowed() {
  return !reducedMotion && !getGraphicsBudget('section-transition').quiet &&
    Boolean(document.querySelector('#main.active-section'));
}

// The lens margin: a circle whose radius wanders with the angle, slowly turning.
function marginPoints(seeds, cx, cy, r, t) {
  const pts = [];
  for (let i = 0; i < 96; i++) {
    const a = (i / 96) * Math.PI * 2;
    let k = 0;
    for (const [f, ph, w] of seeds) k += w * Math.sin(f * a + ph + t * 0.004 * (f % 3 + 1));
    const rr = Math.max(0, r * (1 + 0.035 * k) + (r > 0 ? 6 * k : 0));
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  return pts;
}

// The comet's path: the traced route through the hub to the node, up to MAX_ROUTE px of it, so labels
// beside the hub still get a run the eye can follow.
function routePath(id, node, hub) {
  const P = LOCKED_ROUTES[id]?.projPts;
  if (!P || P.length < 2) return null;
  const near = (p) => {
    let best = 0, bd = Infinity;
    P.forEach((q, i) => { const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < bd) { bd = d; best = i; } });
    return best;
  };
  const b = near(node);
  const a = hub ? near(hub) : 0;
  const dir = a <= b ? 1 : -1;
  const out = [node];
  let length = 0;
  for (let i = b; i >= 0 && i < P.length; i -= dir) {
    const last = out[out.length - 1];
    length += Math.hypot(P[i][0] - last[0], P[i][1] - last[1]);
    out.push(P[i]);
    if (length > MAX_ROUTE && (dir > 0 ? i <= a : i >= a)) break;
  }
  const pts = out.reverse();
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { pts, cum, len: cum[cum.length - 1] };
}

function pointAlong(route, s) {
  const { pts, cum } = route;
  let i = 1;
  while (i < cum.length - 1 && cum[i] < s) i++;
  const k = (s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
  return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k];
}

// The section's first frame: its scene drawn where it has one, and two frames for all.
async function painted(id, stage, started) {
  await frames(2);
  const canvas = id === 'blog' ? stage.querySelector('#blog-network-canvas') : id === 'work' ? stage.querySelector('#work-globe-canvas') : null;
  while (canvas && !canvas.classList.contains('is-drawn') && performance.now() - started < OPEN_LATEST) await frames(1);
}

// Ends a running transition at once: the section as the router left it, the landing as CSS has it.
export function finishGrowTransition() {
  const run = current;
  if (!run) return;
  current = null;
  cancelAnimationFrame(run.raf);
  for (const el of [run.stage, run.main]) {
    if (!el) continue;
    el.style.clipPath = '';
    el.style.opacity = '';
    el.style.contentVisibility = '';
    el.style.transition = 'none';
  }
  run.canvas.remove();
  document.body.classList.remove('grow-transition');
  // The inline transitions stay off for a frame, so nothing fades back from the inline values.
  requestAnimationFrame(() => {
    for (const el of [run.stage, run.main]) if (el) el.style.transition = '';
  });
}

// show() switches to the section the usual way; the lens then reveals it.
export function growInto(label, id, show) {
  finishGrowTransition();
  const stage = document.querySelector(`.stage[data-section="${id}"]`);
  const main = document.getElementById('main');
  if (!stage || !main) { show(); return; }
  const node = center(label);
  const hubEl = document.querySelector('.network-sigil-node');
  const hub = hubEl ? center(hubEl) : null;
  const route = routePath(id, node, hub);
  const [nx, ny] = node;
  const radius = Math.max(...[[0, 0], [innerWidth, 0], [0, innerHeight], [innerWidth, innerHeight]]
    .map(([x, y]) => Math.hypot(x - nx, y - ny))) * 1.12 + 20;
  const seeds = Array.from({ length: 5 }, (_, i) => [2 + i * 3 + Math.round(Math.random() * 2), Math.random() * Math.PI * 2, 0.5 / (i + 1)]);

  const canvas = document.createElement('canvas');
  canvas.className = 'grow-transition-layer';
  canvas.setAttribute('aria-hidden', 'true');
  const dpr = Math.min(getGraphicsBudget('section-transition').dprCap || 1, window.devicePixelRatio || 1);
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
  document.body.append(canvas);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  document.body.classList.add('grow-transition');
  show();
  // The section is open behind a closed lens, so it builds now. The landing stays whole until the lens
  // takes it, laid out past its own leave (0.5 s), since the lens may still be opening then.
  for (const el of [stage, main]) { el.style.transition = 'none'; el.style.opacity = '1'; }
  main.style.contentVisibility = 'visible';
  stage.style.clipPath = 'polygon(0 0, 0 0, 0 0)';

  const started = performance.now();
  const run = { stage, main, canvas, raf: 0 };
  current = run;
  let readyAt = Infinity;
  painted(id, stage, started).then(() => { readyAt = performance.now() - started; });
  let openAt = null;

  const frame = (now) => {
    if (current !== run) return;
    const t = now - started;
    if (openAt == null && t >= OPEN_EARLIEST && (t >= readyAt || t >= OPEN_LATEST)) openAt = t;
    const p = openAt == null ? 0 : Math.min(1, (t - openAt) / OPEN_MS);
    const r = radius * ease(p);
    const edge = openAt == null ? null : marginPoints(seeds, nx, ny, r, t);
    ctx.clearRect(0, 0, innerWidth, innerHeight);

    // The landing dims around the route while it grows, and clears as the lens opens.
    const dim = DIM * Math.min(1, t / 120) * (1 - Math.min(1, p * 1.6));
    if (dim > 0) {
      ctx.save();
      ctx.fillStyle = `rgba(4,7,7,${dim})`;
      if (edge) {
        ctx.beginPath();
        ctx.rect(0, 0, innerWidth, innerHeight);
        edge.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        ctx.clip('evenodd');
      }
      ctx.fillRect(0, 0, innerWidth, innerHeight);
      ctx.restore();
    }

    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // The node flares at once.
    const flare = Math.max(0, 1 - t / 260);
    if (flare > 0) {
      ctx.globalAlpha = flare;
      ctx.drawImage(glow, nx - 30, ny - 30, 60, 60);
      ctx.globalAlpha = 1;
    }
    // The route: a lit hypha under a comet head, fading as the lens opens.
    const routeFade = 1 - Math.min(1, p * 1.8);
    if (route && routeFade > 0) {
      const grown = easeInOut(Math.min(1, t / ROUTE_MS));
      const head = route.len * grown;
      const tip = pointAlong(route, head);
      for (const [rgb, a, w] of [['143,180,255', 0.28, 9], ['122,174,138', 0.8, 3.6], ['230,255,240', 1, 1.6]]) {
        ctx.strokeStyle = `rgba(${rgb},${a * routeFade})`;
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.moveTo(route.pts[0][0], route.pts[0][1]);
        for (let i = 1; i < route.pts.length && route.cum[i] <= head; i++) ctx.lineTo(route.pts[i][0], route.pts[i][1]);
        ctx.lineTo(tip[0], tip[1]);
        ctx.stroke();
      }
      if (grown < 1) {
        ctx.globalAlpha = routeFade;
        ctx.drawImage(glow, tip[0] - 20, tip[1] - 20, 40, 40);
        ctx.globalAlpha = 1;
      }
    }

    if (edge) {
      stage.style.clipPath = `polygon(${edge.map(([x, y]) => `${x.toFixed(1)}px ${y.toFixed(1)}px`).join(',')})`;
      const hole = `M${edge.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L')} Z`;
      main.style.clipPath = `path(evenodd, 'M0 0 H${innerWidth} V${innerHeight} H0 Z ${hole}')`;
      // The margin, hypha green, gone before the lens covers the window.
      const marginAlpha = 0.95 * (1 - Math.min(1, p / 0.8));
      if (marginAlpha > 0.01) {
        for (const [rgb, a, w] of [['143,180,255', 0.18, 7], ['122,174,138', 0.75, 2.6], ['200,240,215', 0.55, 1]]) {
          ctx.strokeStyle = `rgba(${rgb},${a * marginAlpha})`;
          ctx.lineWidth = w;
          ctx.beginPath();
          edge.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
          ctx.closePath();
          ctx.stroke();
        }
      }
    }
    ctx.globalCompositeOperation = 'source-over';

    if ((openAt != null && p >= 1) || t >= END_MS) {
      finishGrowTransition();
      return;
    }
    run.raf = requestAnimationFrame(frame);
  };
  run.raf = requestAnimationFrame(frame);
}

window.addEventListener('resize', finishGrowTransition, { passive: true });
document.addEventListener('visibilitychange', () => { if (document.hidden) finishGrowTransition(); });
