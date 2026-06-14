// "Living Culture" — the altar lens as a scrying petri dish.
//
// A small 2D-canvas colony of spore-points lives *under the glass* of the
// About/Skills examining lens. At rest it drifts and breathes (the orb is
// alive even before you touch it). Hover a specimen card and the colony
// reaches toward it; hover "Systems Thinking" and it crystallises into a
// glowing hub-and-node lattice — the same dots reorganising, never a swap.
//
// This is a PROGRESSIVE ENHANCEMENT and obeys the house rules:
//   • decorative only — the canvas is aria-hidden inside the already
//     aria-hidden .core; the cards stay the screen-reader source of truth.
//   • governor-budgeted — registers as 'altar-culture', throttles to the
//     profile frame interval, reports frame samples for auto-downgrade.
//   • self-stopping — #about/#skills are NOT governor owner-sections, so
//     nothing throttles this offscreen; the loop bails the moment the
//     section is inactive, the tab is hidden, a paper is open, or the lens
//     is not visible (incl. <=900px where the lens is display:none).
//   • reduced-motion / quiet safe — paints one static frame, no rAF.
//
// MVP scope: wired on #skills only, with the full reveal on the
// "Systems Thinking" card; the other cards get the lean-and-brighten
// response. Structured so #about and per-card modes drop in trivially.

import { getGraphicsBudget, reportFrameSample } from './graphics-governor.js';
import { sizeCanvas } from './utils.js';

const SYSTEM = 'altar-culture';
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

function initAltarCulture(sectionId) {
  const section = document.getElementById(sectionId);
  if (!section) return;
  const lens = section.querySelector('.altar-lens');
  if (!lens || lens.__culture) return;
  lens.__culture = true;

  let canvas = null;
  let ctx = null;
  let rafId = null;
  let points = [];
  let cssW = 0, cssH = 0, cx = 0, cy = 0, R = 0;
  let lastTs = 0;

  // mode: 'idle' | 'reach' | 'crystallise'
  let mode = 'idle';
  let hoveredCard = null;
  let reachX = 0, reachY = 0;          // eased lean direction (-1..1)
  let reachTX = 0, reachTY = 0;        // target lean
  let intensity = 0;                   // eased: 0 idle -> 1 engaged (brightness)
  let crystal = 0;                     // eased: 0 -> 1 lattice/struts

  // 6 ring nodes at slightly irregular angles for an organic hub-and-node look
  const RING = 6;
  const ringAngles = [];
  for (let k = 0; k < RING; k++) {
    ringAngles.push(-Math.PI / 2 + (k * 2 * Math.PI) / RING + (k % 2 ? 0.18 : -0.12));
  }

  function sectionActive() {
    return section.classList.contains('active-section');
  }
  function lensVisible() {
    return window.innerWidth > 900 && lens.offsetParent !== null && lens.clientWidth > 1;
  }
  function paperOpen() {
    return document.body.classList.contains('has-paper-open-global');
  }
  function hasWork() {
    const b = getGraphicsBudget(SYSTEM);
    return !prefersReducedMotion && !b.quiet && b.particleScale > 0;
  }

  function ensureCanvas() {
    if (canvas) return;
    canvas = document.createElement('canvas');
    canvas.className = 'lens-scry';
    canvas.setAttribute('aria-hidden', 'true');
    lens.insertBefore(canvas, lens.firstChild); // behind the glass/reticle/glint spans
    ctx = canvas.getContext('2d');
  }

  function layout() {
    const w = Math.max(1, Math.round(lens.clientWidth));
    const h = Math.max(1, Math.round(lens.clientHeight));
    cssW = w; cssH = h; cx = w / 2; cy = h / 2; R = Math.min(w, h) / 2;
    sizeCanvas(canvas, { width: w, height: h, systemName: SYSTEM, maxDpr: 2, minDpr: 1 });
  }

  function makePoints() {
    const b = getGraphicsBudget(SYSTEM);
    const n = Math.max(20, Math.round(34 * (b.particleScale || 0.6)));
    points = new Array(n).fill(0).map((_, i) => {
      const ang = Math.random() * Math.PI * 2;
      const rad = Math.sqrt(Math.random()) * R * 0.8;
      const hx = cx + Math.cos(ang) * rad;
      const hy = cy + Math.sin(ang) * rad;
      const isNode = i <= RING;            // index 0 = hub, 1..6 = ring nodes
      const spoke = i > RING ? (i - RING - 1) % RING : -1;
      return {
        hx, hy, x: hx, y: hy,
        hvx: (Math.random() - 0.5) * 0.18,
        hvy: (Math.random() - 0.5) * 0.18,
        r: isNode ? 1.4 + Math.random() * 0.8 : 0.7 + Math.random() * 1.4,
        a: isNode ? 0.34 + Math.random() * 0.18 : 0.12 + Math.random() * 0.26,
        ph: Math.random() * Math.PI * 2,
        isNode,
        spoke,
        spokeT: 0.26 + Math.random() * 0.66,
        jx: (Math.random() - 0.5) * 6,
        jy: (Math.random() - 0.5) * 6,
      };
    });
  }

  function step(ts) {
    // ease global mode parameters
    intensity += ((mode === 'idle' ? 0 : 1) - intensity) * 0.08;
    crystal += ((mode === 'crystallise' ? 1 : 0) - crystal) * 0.08;
    reachX += (reachTX - reachX) * 0.08;
    reachY += (reachTY - reachY) * 0.08;

    // formation centre leans toward the hovered card
    const fx = cx + reachX * R * 0.3;
    const fy = cy + reachY * R * 0.3;
    const formR = R * 0.58;

    // live node positions (hub + ring), used as crystallise targets & strut ends
    const nodeX = new Array(RING + 1);
    const nodeY = new Array(RING + 1);
    nodeX[0] = fx; nodeY[0] = fy;
    for (let k = 0; k < RING; k++) {
      nodeX[k + 1] = fx + Math.cos(ringAngles[k]) * formR;
      nodeY[k + 1] = fy + Math.sin(ringAngles[k]) * formR;
    }

    const ease = mode === 'crystallise' ? 0.1 : mode === 'reach' ? 0.07 : 0.05;

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

      // target depends on mode (the SAME dots reorganise — never a swap)
      let txp, typ;
      if (mode === 'crystallise') {
        if (i <= RING) {
          txp = nodeX[i]; typ = nodeY[i];        // i=0 hub, 1..6 ring nodes
        } else {
          const s = p.spoke + 1;                 // ring node index for this spoke
          txp = lerp(nodeX[0], nodeX[s], p.spokeT) + p.jx;
          typ = lerp(nodeY[0], nodeY[s], p.spokeT) + p.jy;
        }
      } else if (mode === 'reach') {
        txp = p.hx + reachX * R * 0.18;
        typ = p.hy + reachY * R * 0.18;
      } else {
        txp = p.hx; typ = p.hy;
      }

      p.x += (txp - p.x) * ease;
      p.y += (typ - p.y) * ease;
    }

    return { nodeX, nodeY };
  }

  function draw(ts, nodes) {
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.97, 0, Math.PI * 2);
    ctx.clip();

    // struts: hub -> each ring node (only when crystallising)
    if (crystal > 0.02) {
      ctx.lineWidth = 1;
      ctx.strokeStyle = `rgba(96,206,172,${0.24 * crystal})`;
      for (let k = 1; k <= RING; k++) {
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        ctx.lineTo(points[k].x, points[k].y);
        ctx.stroke();
      }
    }

    ctx.globalCompositeOperation = 'lighter';
    for (const p of points) {
      const breathe = 0.7 + 0.3 * Math.sin(ts * 0.0016 + p.ph);
      const nodeBoost = p.isNode ? 1 + 1.3 * crystal : 1;
      const baseA = clamp(p.a * (0.72 + 0.5 * intensity) * breathe, 0, 1);
      const rr = p.r * nodeBoost;
      const gd = rr * 6;
      ctx.globalAlpha = baseA;
      ctx.drawImage(GLOW, p.x - gd / 2, p.y - gd / 2, gd, gd);
      // bright core
      ctx.globalAlpha = clamp(baseA * (p.isNode ? 1.05 : 0.7), 0, 1);
      ctx.fillStyle = 'rgba(214,255,230,1)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, rr * (p.isNode ? 0.6 : 0.34), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function renderStaticFrame() {
    // reduced-motion / quiet: one calm frame, no animation
    ensureCanvas();
    layout();
    if (!points.length) makePoints();
    const fake = performance.now();
    // settle a few eases so it doesn't look mid-transition
    for (let i = 0; i < 30; i++) step(fake);
    draw(fake, null);
  }

  function loop(ts) {
    if (!sectionActive() || document.hidden || paperOpen() || !lensVisible() || !hasWork()) {
      release();
      rafId = null;
      return;
    }
    const b = getGraphicsBudget(SYSTEM);
    const interval = Math.max(33, b.frameIntervalMs || 33);
    if (ts - lastTs < interval) {
      rafId = requestAnimationFrame(loop);
      return;
    }
    const dt = ts - lastTs;
    lastTs = ts;
    const nodes = step(ts);
    draw(ts, nodes);
    reportFrameSample(SYSTEM, dt);
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
    if (prefersReducedMotion || !hasWork()) {
      renderStaticFrame();
      return;
    }
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

  // --- interaction: cards drive the mode ---
  function dirToCard(card) {
    const cr = card.getBoundingClientRect();
    const lr = lens.getBoundingClientRect();
    const vx = (cr.left + cr.width / 2) - (lr.left + lr.width / 2);
    const vy = (cr.top + cr.height / 2) - (lr.top + lr.height / 2);
    const d = Math.hypot(vx, vy) || 1;
    return { x: clamp(vx / d, -1, 1), y: clamp(vy / d, -1, 1) };
  }
  function onHover(card) {
    hoveredCard = card;
    const dir = dirToCard(card);
    reachTX = dir.x; reachTY = dir.y;
    mode = card.classList.contains('slab-systems') ? 'crystallise' : 'reach';
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

  // --- lifecycle triggers ---
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

  // deep-link / already-active on load
  if (sectionActive() && lensVisible()) ensureLoop();
}

function boot() {
  // MVP: Skills only. (initAltarCulture('about') drops in once tuned.)
  initAltarCulture('skills');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
