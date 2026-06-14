// "Living Culture" — the altar lens as a scrying petri dish (Skills).
//
// A small 2D-canvas colony of spore-points lives UNDER the glass of the Skills
// examining lens. At rest it drifts and breathes; hover a specimen card and the
// colony crystallises into THAT card's constellation — a different lit figure
// per card, the same dots reorganising (never a swap/fade):
//   Systems Thinking   -> a hub with six spokes (architecture)
//   User Interface     -> a connected ring/mesh (surfaces, links)
//   Scientific Rigor   -> a branching tree (hypothesis -> results)
//   The rest of my life-> a loose scattered cluster with a few ties
//
// Progressive enhancement, house rules: decorative + aria-hidden (cards stay
// the screen-reader truth), governor system 'altar-culture' (NOT an owner
// section -> self-stops offscreen/hidden/paper-open/not-visible/<=900px),
// reduced-motion/quiet -> one static frame, desktop only.

import { getGraphicsBudget, reportFrameSample } from './graphics-governor.js';
import { sizeCanvas } from './utils.js';

const prefersReducedMotion =
  window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Shared pre-rendered glow sprite (avoids per-frame shadowBlur)
const GLOW_SIZE = 32;
const GLOW = document.createElement('canvas');
GLOW.width = GLOW.height = GLOW_SIZE;
{
  const g = GLOW.getContext('2d');
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(214,255,230,1)');
  grad.addColorStop(0.3, 'rgba(92,202,168,0.55)');
  grad.addColorStop(0.65, 'rgba(60,150,128,0.18)');
  grad.addColorStop(1, 'rgba(45,140,120,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, GLOW_SIZE, GLOW_SIZE);
}

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// One constellation for every card (the hub-and-spokes the owner liked): nodes
// in normalised coords (-1..1, y down) scaled by the formation radius; edges are
// node-index pairs drawn as struts. The whole figure's centre is pulled toward
// the hovered card (the "gravity").
const CONSTELLATION = {
  nodes: [[0, 0], [0, -1], [0.87, -0.5], [0.87, 0.5], [0, 1], [-0.87, 0.5], [-0.87, -0.5]],
  edges: [[0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6]],
};

function initAltarCulture(sectionId) {
  const section = document.getElementById(sectionId);
  if (!section) return;
  const lens = section.querySelector('.altar-lens');
  if (!lens || lens.__culture) return;
  lens.__culture = true;

  let canvas = null, ctx = null, rafId = null;
  let points = [];
  let cssW = 0, cssH = 0, cx = 0, cy = 0, R = 0;
  let lastTs = 0;

  let mode = 'idle';                 // 'idle' | 'crystallise'
  const activeConst = CONSTELLATION;
  let hoveredCard = null;
  let reachX = 0, reachY = 0, reachTX = 0, reachTY = 0;
  let intensity = 0;                 // eased 0 idle -> 1 engaged
  let crystal = 0;                   // eased 0 -> 1 lattice/struts
  let nodeWorld = [];                // live node positions (for struts)

  const sectionActive = () => section.classList.contains('active-section');
  const lensVisible = () =>
    window.innerWidth > 900 && lens.offsetParent !== null && lens.clientWidth > 1;
  const paperOpen = () => document.body.classList.contains('has-paper-open-global');
  const hasWork = () => {
    const b = getGraphicsBudget('altar-culture');
    return !prefersReducedMotion && !b.quiet && b.particleScale > 0;
  };

  function ensureCanvas() {
    if (canvas) return;
    canvas = document.createElement('canvas');
    canvas.className = 'lens-scry';
    canvas.setAttribute('aria-hidden', 'true');
    lens.insertBefore(canvas, lens.firstChild);
    ctx = canvas.getContext('2d');
  }

  function layout() {
    const w = Math.max(1, Math.round(lens.clientWidth));
    const h = Math.max(1, Math.round(lens.clientHeight));
    cssW = w; cssH = h; cx = w / 2; cy = h / 2; R = Math.min(w, h) / 2;
    sizeCanvas(canvas, { width: w, height: h, systemName: 'altar-culture', maxDpr: 2, minDpr: 1 });
  }

  function makePoints() {
    const b = getGraphicsBudget('altar-culture');
    const n = Math.max(24, Math.round(38 * (b.particleScale || 0.6)));
    points = new Array(n).fill(0).map(() => {
      const ang = Math.random() * Math.PI * 2;
      const rad = Math.sqrt(Math.random()) * R * 0.8;
      const hx = cx + Math.cos(ang) * rad;
      const hy = cy + Math.sin(ang) * rad;
      return {
        hx, hy, x: hx, y: hy,
        hvx: (Math.random() - 0.5) * 0.18,
        hvy: (Math.random() - 0.5) * 0.18,
        r: 0.7 + Math.random() * 1.4,
        a: 0.12 + Math.random() * 0.26,
        ph: Math.random() * Math.PI * 2,
        edgeT: 0.24 + Math.random() * 0.68,
        jx: (Math.random() - 0.5) * 6,
        jy: (Math.random() - 0.5) * 6,
      };
    });
  }

  function step(ts) {
    intensity += ((mode === 'idle' ? 0 : 1) - intensity) * 0.08;
    crystal += ((mode === 'crystallise' ? 1 : 0) - crystal) * 0.08;
    reachX += (reachTX - reachX) * 0.08;
    reachY += (reachTY - reachY) * 0.08;

    const fx = cx + reachX * R * 0.34;   // pull the whole figure toward the card
    const fy = cy + reachY * R * 0.34;
    const formR = R * 0.55;

    const nodes = activeConst.nodes;
    const nc = nodes.length;
    nodeWorld = nodes.map(([nx, ny]) => [fx + nx * formR, fy + ny * formR]);
    const edges = activeConst.edges;

    const ease = mode === 'crystallise' ? 0.1 : 0.05;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      // idle "life": homes drift gently, reflecting inside the dish
      p.hx += p.hvx; p.hy += p.hvy;
      const dx = p.hx - cx, dy = p.hy - cy;
      const d = Math.hypot(dx, dy);
      if (d > R * 0.82) {
        const nx = dx / d, ny = dy / d;
        const dot = p.hvx * nx + p.hvy * ny;
        p.hvx -= 2 * dot * nx; p.hvy -= 2 * dot * ny;
        p.hx = cx + nx * R * 0.82; p.hy = cy + ny * R * 0.82;
      }

      let txp, typ;
      if (mode === 'crystallise') {
        if (i < nc) {
          txp = nodeWorld[i][0]; typ = nodeWorld[i][1];
        } else {
          const e = edges[(i - nc) % edges.length];
          const A = nodeWorld[e[0]], B = nodeWorld[e[1]];
          txp = lerp(A[0], B[0], p.edgeT) + p.jx;
          typ = lerp(A[1], B[1], p.edgeT) + p.jy;
        }
      } else {
        txp = p.hx; typ = p.hy;
      }
      p.x += (txp - p.x) * ease;
      p.y += (typ - p.y) * ease;
    }
  }

  function draw(ts) {
    const nc = activeConst.nodes.length;
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.97, 0, Math.PI * 2);
    ctx.clip();

    // struts along the active constellation's edges
    if (crystal > 0.02) {
      ctx.lineWidth = 1;
      ctx.strokeStyle = `rgba(96,206,172,${0.24 * crystal})`;
      for (const [a, b] of activeConst.edges) {
        ctx.beginPath();
        ctx.moveTo(points[a].x, points[a].y);
        ctx.lineTo(points[b].x, points[b].y);
        ctx.stroke();
      }
    }

    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const isNode = i < nc;
      const breathe = 0.7 + 0.3 * Math.sin(ts * 0.0016 + p.ph);
      const nodeBoost = isNode ? 1 + 1.3 * crystal : 1;
      const baseA = clamp(p.a * (0.72 + 0.5 * intensity) * breathe, 0, 1);
      const rr = p.r * nodeBoost;
      const gd = rr * 6;
      ctx.globalAlpha = baseA;
      ctx.drawImage(GLOW, p.x - gd / 2, p.y - gd / 2, gd, gd);
      ctx.globalAlpha = clamp(baseA * (isNode ? 1.05 : 0.7), 0, 1);
      ctx.fillStyle = 'rgba(214,255,230,1)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, rr * (isNode ? 0.6 : 0.34), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function renderStaticFrame() {
    ensureCanvas();
    layout();
    if (!points.length) makePoints();
    const fake = performance.now();
    for (let i = 0; i < 30; i++) step(fake);
    draw(fake);
  }

  function loop(ts) {
    if (!sectionActive() || document.hidden || paperOpen() || !lensVisible() || !hasWork()) {
      release();
      rafId = null;
      return;
    }
    const b = getGraphicsBudget('altar-culture');
    const interval = Math.max(33, b.frameIntervalMs || 33);
    if (ts - lastTs < interval) { rafId = requestAnimationFrame(loop); return; }
    const dt = ts - lastTs;
    lastTs = ts;
    step(ts);
    draw(ts);
    reportFrameSample('altar-culture', dt);
    rafId = requestAnimationFrame(loop);
  }

  function release() {
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (canvas && (canvas.width !== 1 || canvas.height !== 1)) {
      canvas.width = 1; canvas.height = 1;
    }
  }

  function ensureLoop() {
    if (rafId != null) return;
    if (!sectionActive() || !lensVisible()) return;
    if (prefersReducedMotion || !hasWork()) { renderStaticFrame(); return; }
    ensureCanvas();
    layout();
    if (!points.length) makePoints();
    lastTs = performance.now();
    rafId = requestAnimationFrame(loop);
  }

  function stop() {
    if (rafId != null) cancelAnimationFrame(rafId);
    rafId = null;
    release();
  }

  function dirToCard(card) {
    const cr = card.getBoundingClientRect(), lr = lens.getBoundingClientRect();
    const vx = (cr.left + cr.width / 2) - (lr.left + lr.width / 2);
    const vy = (cr.top + cr.height / 2) - (lr.top + lr.height / 2);
    const d = Math.hypot(vx, vy) || 1;
    return { x: clamp(vx / d, -1, 1), y: clamp(vy / d, -1, 1) };
  }
  function onHover(card) {
    hoveredCard = card;
    const dir = dirToCard(card);
    reachTX = dir.x; reachTY = dir.y;
    mode = 'crystallise';
    ensureLoop();
  }
  function onUnhover(card) {
    if (hoveredCard !== card) return;
    hoveredCard = null;
    mode = 'idle';
    reachTX = 0; reachTY = 0;
  }

  section.querySelectorAll('.slab.paper').forEach((card) => {
    card.addEventListener('pointerenter', () => onHover(card));
    card.addEventListener('pointerleave', () => onUnhover(card));
    card.addEventListener('focusin', () => onHover(card));
    card.addEventListener('focusout', () => onUnhover(card));
  });

  const mo = new MutationObserver(() => {
    if (sectionActive() && lensVisible()) ensureLoop();
    else if (!sectionActive()) stop();
  });
  mo.observe(section, { attributes: true, attributeFilter: ['class'] });

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!canvas) return;
      if (!lensVisible()) { stop(); return; }
      layout();
      makePoints();
      ensureLoop();
    }, 180);
  });

  window.addEventListener('graphics:profile-change', () => {
    if (!sectionActive() || !lensVisible()) return;
    if (prefersReducedMotion || !hasWork()) { stop(); renderStaticFrame(); return; }
    ensureLoop();
  });

  if (sectionActive() && lensVisible()) ensureLoop();
}

function boot() { initAltarCulture('skills'); }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
