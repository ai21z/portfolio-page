// js/altar-eye.js — The Oracle's Eye for the About lens.
//
// The lens becomes a scrying orb with something alive UNDER the glass: a dark
// vitreous well with a teal fibre-iris and a bottomless pupil that responds to
// which About card you're reading. Every card reads as a living eye — a deep
// glowing pupil-well in its own hue — and each carries a distinct iris:
//   Background      -> LATTICE  (meridians + arcs + graticule ticks)   teal
//   What I value    -> SIGIL    (quartered stroma, a violet cross)      cool violet
//   Art's paramour  -> BLOOM    (warm ember welling from the pupil)     amber  (the warm one)
//   Contact / Now   -> BEACON   (rings + bearing + transmission + pin)  signal cyan
//
// You peer INTO it, it never peers OUT at you. Five guardrails keep it an
// instrument, not a creature: the gaze never aims (drift <= R*0.06, eased slow);
// no blink / tremor / pupil-pulse; plain damped lerp (no overshoot); the
// catch-light (CSS .lens-glint) is glass, pinned, never tracking; the centre is
// a bottomless well with only a subordinate abyss-glow.
//
// House rules: decorative + aria-hidden, desktop-only (>900px; lens display:none
// below), governor 'altar-eye', self-stops offscreen (about is not an owner
// section), reduced-motion/quiet -> one calm OPEN static frame.

import { getGraphicsBudget, reportFrameSample } from './graphics-governor.js';
import { sizeCanvas } from './utils.js';

const prefersReducedMotion =
  window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const GLOW = document.createElement('canvas');
GLOW.width = GLOW.height = 32;
{
  const g = GLOW.getContext('2d');
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(214,255,230,0.9)');
  grad.addColorStop(0.35, 'rgba(96,206,172,0.4)');
  grad.addColorStop(1, 'rgba(60,150,128,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
}

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Per-card config. dilate = resting aperture; glow = the hue welling from the
// pupil (what makes each card read as a living eye). Only paramour is warm.
const IDLE_GLOW = [70, 200, 170];
const CARD_IRIS = {
  'slab-about': { motif: 'lattice', dilate: 0.96, glow: [70, 200, 170] },
  'slab-expertise': { motif: 'sigil', dilate: 1.0, glow: [126, 150, 235] },
  'slab-paramour': { motif: 'bloom', dilate: 1.18, glow: [255, 150, 74] },
  'slab-vitals': { motif: 'beacon', dilate: 1.06, glow: [90, 220, 200] },
};

function initAltarEye(sectionId) {
  const section = document.getElementById(sectionId);
  if (!section) return;
  const lens = section.querySelector('.altar-lens');
  if (!lens || lens.__eye) return;
  lens.__eye = true;

  let canvas = null, ctx = null, rafId = null;
  let cssW = 0, cssH = 0, cx = 0, cy = 0, R = 0;
  let lastTs = 0;
  let motes = [];

  let mode = 'idle';
  let activeMotif = 'lattice';
  let motifT = 0;
  let gx = 0, gy = 0, tgx = 0, tgy = 0;
  let dil = 1, tdil = 1;
  let cg = [...IDLE_GLOW], tg = [...IDLE_GLOW];   // eased glow colour
  let hoveredCard = null;

  const sectionActive = () => section.classList.contains('active-section');
  const lensVisible = () =>
    window.innerWidth > 900 && lens.offsetParent !== null && lens.clientWidth > 1;
  const paperOpen = () => document.body.classList.contains('has-paper-open-global');
  const hasWork = () => !getGraphicsBudget('altar-eye').quiet;

  function ensureCanvas() {
    if (canvas) return;
    canvas = document.createElement('canvas');
    canvas.className = 'lens-eye lens-eye--live';
    canvas.setAttribute('aria-hidden', 'true');
    lens.insertBefore(canvas, lens.firstChild);
    ctx = canvas.getContext('2d');
  }

  function layout() {
    const w = Math.max(1, Math.round(lens.clientWidth));
    const h = Math.max(1, Math.round(lens.clientHeight));
    cssW = w; cssH = h; cx = w / 2; cy = h / 2; R = Math.min(w, h) / 2;
    sizeCanvas(canvas, { width: w, height: h, systemName: 'altar-eye', maxDpr: 2, minDpr: 1 });
    makeMotes();
  }

  function makeMotes() {
    motes = new Array(7).fill(0).map(() => {
      const a = Math.random() * Math.PI * 2;
      const rad = R * (0.42 + Math.random() * 0.42);
      return {
        x: cx + Math.cos(a) * rad, y: cy + Math.sin(a) * rad,
        vx: (Math.random() - 0.5) * 0.14, vy: (Math.random() - 0.5) * 0.14,
        r: 0.7 + Math.random() * 1.1, a: 0.12 + Math.random() * 0.2,
        ph: Math.random() * Math.PI * 2,
      };
    });
  }

  function release() {
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (canvas && (canvas.width !== 1 || canvas.height !== 1)) { canvas.width = 1; canvas.height = 1; }
  }

  // ---- drawing ----
  function drawBase(ox, oy, irisR, pupilR, breathe) {
    const lift = 0.32 + 0.18 * motifT;     // iris fills out a little when engaged
    const base = ctx.createRadialGradient(ox, oy, pupilR * 0.6, ox, oy, irisR);
    base.addColorStop(0, `rgba(40,120,104,${lift * breathe})`);
    base.addColorStop(0.6, `rgba(28,86,78,${0.62 * lift * breathe})`);
    base.addColorStop(1, 'rgba(14,44,42,0)');
    ctx.fillStyle = base;
    ctx.beginPath(); ctx.arc(ox, oy, irisR, 0, Math.PI * 2); ctx.fill();

    const b = getGraphicsBudget('altar-eye');
    const veins = Math.max(7, Math.round(26 * (b.effectsScale != null ? b.effectsScale : 1)));
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < veins; i++) {
      const a = (i / veins) * Math.PI * 2 + (i % 2 ? 0.05 : -0.05);
      const j = 0.82 + ((i * 37) % 10) / 36;
      ctx.moveTo(ox + Math.cos(a) * pupilR * 1.02, oy + Math.sin(a) * pupilR * 1.02);
      ctx.lineTo(ox + Math.cos(a) * irisR * j, oy + Math.sin(a) * irisR * j);
    }
    ctx.strokeStyle = `rgba(120,206,176,${(0.12 + 0.06 * motifT) * breathe})`;
    ctx.stroke();

    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 2;
    ctx.strokeStyle = `rgba(150,235,205,${0.42 * breathe})`;
    ctx.beginPath(); ctx.arc(ox, oy, pupilR * 1.04, 0, Math.PI * 2); ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  }

  // the core glow welling from the pupil — what makes each card a LIVING eye.
  // colour is the active card's hue (warm only for paramour), fades out by
  // ~0.6*irisR so it never becomes a solid disc.
  function coreGlow(ox, oy, irisR, pupilR) {
    const r = cg[0] | 0, g = cg[1] | 0, bch = cg[2] | 0;
    const gi = 0.12 + 0.34 * motifT;
    const gr = irisR * 0.62;
    ctx.globalCompositeOperation = 'lighter';
    const grad = ctx.createRadialGradient(ox, oy, pupilR * 0.7, ox, oy, gr);
    grad.addColorStop(0, `rgba(${r},${g},${bch},${gi})`);
    grad.addColorStop(0.45, `rgba(${r},${g},${bch},${gi * 0.4})`);
    grad.addColorStop(1, `rgba(${r},${g},${bch},0)`);
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(ox, oy, gr, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawPupil(ox, oy, pupilR) {
    const well = ctx.createRadialGradient(ox, oy, 1, ox, oy, pupilR);
    well.addColorStop(0, 'rgba(2,6,6,1)');
    well.addColorStop(0.7, 'rgba(4,12,12,1)');
    well.addColorStop(1, 'rgba(8,22,20,0.96)');
    ctx.fillStyle = well;
    ctx.beginPath(); ctx.arc(ox, oy, pupilR, 0, Math.PI * 2); ctx.fill();
  }

  // a light at the bottom of the well, in the card's hue (candle / cool ember)
  function abyssGlow(ox, oy, pupilR) {
    const r = cg[0] | 0, g = cg[1] | 0, bch = cg[2] | 0;
    const a = 0.08 + 0.26 * motifT;
    ctx.globalCompositeOperation = 'lighter';
    const grad = ctx.createRadialGradient(ox, oy, 0, ox, oy, pupilR * 0.6);
    grad.addColorStop(0, `rgba(${r},${g},${bch},${a})`);
    grad.addColorStop(0.5, `rgba(${r},${g},${bch},${a * 0.32})`);
    grad.addColorStop(1, `rgba(${r},${g},${bch},0)`);
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(ox, oy, pupilR * 0.6, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  function motifLattice(ox, oy, irisR, pupilR, t) {
    ctx.strokeStyle = `rgba(120,206,176,${0.28 * t})`;
    ctx.lineWidth = 1;
    for (let k = 1; k <= 3; k++) {
      const rr = pupilR + (irisR - pupilR) * (k / 3.4);
      ctx.beginPath(); ctx.arc(ox, oy, rr, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.setLineDash([2, 4]);
    ctx.strokeStyle = `rgba(150,235,205,${0.3 * t})`;
    ctx.beginPath(); ctx.arc(ox, oy, irisR * 0.78, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
  }

  function motifSigil(ox, oy, irisR, pupilR, t) {
    const mr = (pupilR + irisR) * 0.5;
    ctx.strokeStyle = `rgba(120,206,176,${0.34 * t})`;
    ctx.lineWidth = 1.4;
    for (let q = 0; q < 4; q++) {
      const a = q * Math.PI / 2;
      const mx = ox + Math.cos(a) * mr, my = oy + Math.sin(a) * mr;
      ctx.beginPath(); ctx.arc(mx, my, irisR * 0.12, a + 0.6, a + Math.PI - 0.6); ctx.stroke();
    }
    ctx.strokeStyle = `rgba(150,130,235,${0.42 * t})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ox - irisR * 0.82, oy); ctx.lineTo(ox + irisR * 0.82, oy);
    ctx.moveTo(ox, oy - irisR * 0.82); ctx.lineTo(ox, oy + irisR * 0.82);
    ctx.stroke();
  }

  function motifBloom(ox, oy, irisR, pupilR, t) {
    // the warmth is carried by coreGlow now; bloom adds slow devotional ripples
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 1;
    for (let k = 1; k <= 2; k++) {
      ctx.strokeStyle = `rgba(255,170,110,${0.12 * t})`;
      ctx.beginPath(); ctx.arc(ox, oy, pupilR + (irisR - pupilR) * (0.35 * k), 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  function motifBeacon(ox, oy, irisR, pupilR, t) {
    ctx.strokeStyle = `rgba(120,206,176,${0.26 * t})`;
    ctx.lineWidth = 1;
    for (let k = 1; k <= 2; k++) {
      ctx.beginPath(); ctx.arc(ox, oy, pupilR + (irisR - pupilR) * (k / 2.6), 0, Math.PI * 2); ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(ox, oy - pupilR * 1.1); ctx.lineTo(ox, oy - irisR * 0.86); ctx.stroke();
    ctx.setLineDash([3, 5]);
    ctx.strokeStyle = `rgba(150,235,205,${0.3 * t})`;
    ctx.beginPath(); ctx.arc(ox, oy, irisR * 0.72, -0.5, 1.4); ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalCompositeOperation = 'lighter';
    const pin = ctx.createRadialGradient(ox, oy - irisR * 0.86, 0, ox, oy - irisR * 0.86, irisR * 0.1);
    pin.addColorStop(0, `rgba(120,235,210,${0.55 * t})`);
    pin.addColorStop(1, 'rgba(120,235,210,0)');
    ctx.fillStyle = pin;
    ctx.beginPath(); ctx.arc(ox, oy - irisR * 0.86, irisR * 0.1, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  const MOTIFS = { lattice: motifLattice, sigil: motifSigil, bloom: motifBloom, beacon: motifBeacon };

  function step(ts) {
    motifT += ((mode === 'engaged' ? 1 : 0) - motifT) * 0.07;
    gx += (tgx - gx) * 0.05;
    gy += (tgy - gy) * 0.05;
    dil += (tdil - dil) * 0.07;
    for (let i = 0; i < 3; i++) cg[i] += (tg[i] - cg[i]) * 0.06;
    for (const m of motes) {
      m.x += m.vx; m.y += m.vy;
      const dx = m.x - cx, dy = m.y - cy, d = Math.hypot(dx, dy);
      if (d > R * 0.88 || d < R * 0.34) {
        const nx = dx / (d || 1), ny = dy / (d || 1);
        m.vx -= 2 * (m.vx * nx + m.vy * ny) * nx;
        m.vy -= 2 * (m.vx * nx + m.vy * ny) * ny;
      }
    }
  }

  function draw(ts) {
    const breathe = 0.9 + 0.1 * Math.sin(ts * 0.0012);
    const irisR = R * 0.9;
    const pupilR = clamp(R * 0.3 * dil, R * 0.16, R * 0.42);
    const ox = cx + gx, oy = cy + gy;

    ctx.clearRect(0, 0, cssW, cssH);
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.97, 0, Math.PI * 2); ctx.clip();

    drawBase(ox, oy, irisR, pupilR, breathe);
    coreGlow(ox, oy, irisR, pupilR);
    if (motifT > 0.02 && MOTIFS[activeMotif]) MOTIFS[activeMotif](ox, oy, irisR, pupilR, motifT);
    drawPupil(ox, oy, pupilR);
    abyssGlow(ox, oy, pupilR);

    for (const m of motes) {
      const tw = 0.7 + 0.3 * Math.sin(ts * 0.0015 + m.ph);
      const gd = m.r * 6;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = clamp(m.a * tw * breathe, 0, 1);
      ctx.drawImage(GLOW, m.x - gd / 2, m.y - gd / 2, gd, gd);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
  }

  function renderStaticFrame() {
    ensureCanvas();
    layout();
    mode = 'idle'; motifT = 0; gx = gy = tgx = tgy = 0; dil = tdil = 1;
    cg = [...IDLE_GLOW]; tg = [...IDLE_GLOW];
    draw(performance.now());
  }

  function loop(ts) {
    if (!sectionActive() || document.hidden || paperOpen() || !lensVisible() || !hasWork()) {
      release(); rafId = null; return;
    }
    const b = getGraphicsBudget('altar-eye');
    const interval = Math.max(33, b.frameIntervalMs || 33);
    if (ts - lastTs < interval) { rafId = requestAnimationFrame(loop); return; }
    const dt = ts - lastTs; lastTs = ts;
    step(ts); draw(ts);
    reportFrameSample('altar-eye', dt);
    rafId = requestAnimationFrame(loop);
  }

  function ensureLoop() {
    if (rafId != null) return;
    if (!sectionActive() || !lensVisible()) return;
    if (prefersReducedMotion || !hasWork()) { renderStaticFrame(); return; }
    ensureCanvas();
    if (Math.round(lens.clientWidth) !== cssW || !motes.length) layout();
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
    return { x: vx / d, y: vy / d };
  }
  function onHover(card) {
    const cfg = CARD_IRIS[[...card.classList].find((c) => CARD_IRIS[c])];
    if (!cfg) return;
    hoveredCard = card;
    activeMotif = cfg.motif;
    tdil = cfg.dilate;
    tg = [...cfg.glow];
    const dir = dirToCard(card);
    tgx = clamp(dir.x, -1, 1) * R * 0.06;   // gaze NEVER aims: <= 6% of radius
    tgy = clamp(dir.y, -1, 1) * R * 0.06;
    mode = 'engaged';
    ensureLoop();
  }
  function onUnhover(card) {
    if (hoveredCard !== card) return;
    hoveredCard = null;
    mode = 'idle';
    tgx = tgy = 0; tdil = 1;
    tg = [...IDLE_GLOW];
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
      layout(); ensureLoop();
    }, 180);
  });

  window.addEventListener('graphics:profile-change', () => {
    if (!sectionActive() || !lensVisible()) return;
    if (prefersReducedMotion || !hasWork()) { stop(); renderStaticFrame(); return; }
    ensureLoop();
  });

  if (sectionActive() && lensVisible()) ensureLoop();
}

function boot() { initAltarEye('about'); }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
