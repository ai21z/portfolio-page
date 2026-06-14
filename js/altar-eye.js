// js/altar-eye.js — The Oracle's Eye, PHASE 0 (risk spike).
//
// A STATIC scrying bloom rendered under the About lens, shown only while the
// "Art's paramour" card is hovered or focused. There is no animation loop —
// one canvas draw plus a CSS opacity fade. Its only job is to answer the
// single question the whole concept rides on: does a warm glowing
// pupil-under-glass read as candlelit *devotion*, or as a *watcher*?
//
// Same house rules as altar-culture.js: decorative + aria-hidden (the cards
// stay the screen-reader truth), desktop-only (>900px; the lens is
// display:none below), reduced-motion safe (no motion to begin with), and it
// releases its canvas backing whenever About is inactive. The lifecycle is
// duplicated from the culture deliberately — per the plan, the eye ships
// standalone first and the shared base is extracted only if the eye stays.

import { sizeCanvas } from './utils.js';

function initAltarEye(sectionId) {
  const section = document.getElementById(sectionId);
  if (!section) return;
  const lens = section.querySelector('.altar-lens');
  if (!lens || lens.__eye) return;
  lens.__eye = true;

  let canvas = null;
  let ctx = null;
  let cssW = 0, cssH = 0, R = 0;
  let drawn = false;

  const sectionActive = () => section.classList.contains('active-section');
  const lensVisible = () =>
    window.innerWidth > 900 && lens.offsetParent !== null && lens.clientWidth > 1;

  function ensureCanvas() {
    if (canvas) return;
    canvas = document.createElement('canvas');
    canvas.className = 'lens-eye';
    canvas.setAttribute('aria-hidden', 'true');
    lens.insertBefore(canvas, lens.firstChild); // under the glass/reticle/glint spans
    ctx = canvas.getContext('2d');
  }

  function layout() {
    const w = Math.max(1, Math.round(lens.clientWidth));
    const h = Math.max(1, Math.round(lens.clientHeight));
    cssW = w; cssH = h; R = Math.min(w, h) / 2;
    sizeCanvas(canvas, { width: w, height: h, systemName: 'altar-eye', maxDpr: 2, minDpr: 1 });
    drawn = false;
  }

  function release() {
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (canvas && (canvas.width !== 1 || canvas.height !== 1)) {
      canvas.width = 1; canvas.height = 1;
    }
    drawn = false;
  }

  // The bloom: a teal fibre-iris with a warm ember welling from a bottomless
  // pupil. The ember fades fully to house teal before the limbus (a gradient,
  // never a solid orange disc) and a faint "candle" glows at the well bottom.
  function drawBloom() {
    if (!ctx) return;
    const cx = cssW / 2, cy = cssH / 2;
    const irisR = R * 0.9;
    const pupilR = R * 0.32;

    ctx.clearRect(0, 0, cssW, cssH);
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.97, 0, Math.PI * 2); ctx.clip();

    // 1. iris base — faint teal field
    const base = ctx.createRadialGradient(cx, cy, pupilR * 0.6, cx, cy, irisR);
    base.addColorStop(0, 'rgba(40,120,104,0.35)');
    base.addColorStop(0.6, 'rgba(28,86,78,0.22)');
    base.addColorStop(1, 'rgba(14,44,42,0)');
    ctx.fillStyle = base;
    ctx.beginPath(); ctx.arc(cx, cy, irisR, 0, Math.PI * 2); ctx.fill();

    // 2. ember stroma glow — warm from the pupil outward, GONE by ~0.6*irisR
    ctx.globalCompositeOperation = 'lighter';
    const emberR = irisR * 0.62;
    const ember = ctx.createRadialGradient(cx, cy, pupilR * 0.7, cx, cy, emberR);
    ember.addColorStop(0, 'rgba(255,150,74,0.40)');
    ember.addColorStop(0.45, 'rgba(232,116,52,0.16)');
    ember.addColorStop(1, 'rgba(255,150,74,0)');
    ctx.fillStyle = ember;
    ctx.beginPath(); ctx.arc(cx, cy, emberR, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    // 3. vein fibres — radial teal hairlines (static stroma texture)
    ctx.lineWidth = 1;
    const veins = 26;
    for (let i = 0; i < veins; i++) {
      const a = (i / veins) * Math.PI * 2 + (i % 2 ? 0.05 : -0.05);
      const j = 0.82 + ((i * 37) % 10) / 36; // deterministic jitter to the limbus
      ctx.strokeStyle = `rgba(120,206,176,${0.1 + (i % 3) * 0.03})`;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * pupilR * 1.02, cy + Math.sin(a) * pupilR * 1.02);
      ctx.lineTo(cx + Math.cos(a) * irisR * j, cy + Math.sin(a) * irisR * j);
      ctx.stroke();
    }

    // 4. caustic collarette — a bright refraction ring at the pupil edge
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(150,235,205,0.5)';
    ctx.beginPath(); ctx.arc(cx, cy, pupilR * 1.04, 0, Math.PI * 2); ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';

    // 5. pupil — a bottomless dark well (this is what makes it a thing you
    //    peer INTO, not a watcher peering out)
    const well = ctx.createRadialGradient(cx, cy, 1, cx, cy, pupilR);
    well.addColorStop(0, 'rgba(2,6,6,1)');
    well.addColorStop(0.7, 'rgba(4,12,12,1)');
    well.addColorStop(1, 'rgba(8,22,20,0.96)');
    ctx.fillStyle = well;
    ctx.beginPath(); ctx.arc(cx, cy, pupilR, 0, Math.PI * 2); ctx.fill();

    // 6. abyss-ember — a candle at the bottom of the well (subordinate, soft)
    ctx.globalCompositeOperation = 'lighter';
    const abyss = ctx.createRadialGradient(cx, cy, 0, cx, cy, pupilR * 0.6);
    abyss.addColorStop(0, 'rgba(255,140,60,0.33)');
    abyss.addColorStop(0.5, 'rgba(255,120,50,0.1)');
    abyss.addColorStop(1, 'rgba(255,120,50,0)');
    ctx.fillStyle = abyss;
    ctx.beginPath(); ctx.arc(cx, cy, pupilR * 0.6, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    ctx.restore();
    drawn = true;
  }

  function show() {
    if (!sectionActive() || !lensVisible()) return;
    ensureCanvas();
    if (Math.round(lens.clientWidth) !== cssW) layout();
    if (!drawn) drawBloom();
    canvas.classList.add('eye-lit');
  }
  function hide() {
    if (canvas) canvas.classList.remove('eye-lit');
  }

  // Phase 0: only the "Art's paramour" card summons the bloom.
  const paramour = section.querySelector('.slab-paramour');
  if (paramour) {
    paramour.addEventListener('pointerenter', show);
    paramour.addEventListener('pointerleave', hide);
    paramour.addEventListener('focusin', show);
    paramour.addEventListener('focusout', hide);
  }

  // Prep the canvas when About is active; release it (1×1) when About leaves.
  const mo = new MutationObserver(() => {
    if (sectionActive() && lensVisible()) { ensureCanvas(); layout(); }
    else { hide(); release(); }
  });
  mo.observe(section, { attributes: true, attributeFilter: ['class'] });

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!canvas) return;
      if (!lensVisible()) { hide(); release(); return; }
      layout();
      if (canvas.classList.contains('eye-lit')) drawBloom();
    }, 180);
  });

  if (sectionActive() && lensVisible()) { ensureCanvas(); layout(); }
}

function boot() { initAltarEye('about'); }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
