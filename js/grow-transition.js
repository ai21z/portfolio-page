// The landing's way into a section. A node's click flares the node and lights its route through the hub,
// while the landing's words fade and the network alone flies into the branch toward the node. The section
// opens behind a closed lens at once, so it builds during the flight, and once it has painted (its scene
// drawn, or two frames for the paper views) the lens opens where the flight arrives. Its edge is a growth
// front: lobed, thick and bright at the tips, glowing inward, with strands reaching past it. The flown
// network runs through the lens too, so it is never seen at two scales, and gives way to the backdrop at
// its own scale behind the section. Readable by about 0.5 s, done by 0.9 s.
//
// Any other route change while it runs (Back or Forward, a wheel step, a link, a resize, a hidden tab)
// finishes it at once, so the page always ends where the router says. Reduced motion and Quiet keep the
// plain switch.
//
// The same front carries the other moves. Between two sections the incoming one spreads in from where the
// move began, over the outgoing one as it fades below (spreadInto). On the first landing of a visit the
// network grows out of the hub across the backdrop while the name, portrait and words stand as they load
// (inoculate).
import { LOCKED_ROUTES } from './state.js';
import { getGraphicsBudget } from './graphics-governor.js';
import { reducedMotion } from './motion.js';

const ROUTE_MS = 280;
const PUSH = 1.7;           // the network's flight toward the node
const PUSH_MS = 620;
const WORDS_OUT_MS = 170;   // the name, portrait, bio and labels are gone by then
const OPEN_EARLIEST = 190;
const OPEN_LATEST = 300;
const OPEN_MS = 520;
const END_MS = 890;
const BACKDROP_IN_MS = 300;
const MAX_ROUTE = 420;      // px of route the comet travels, ending at the node
const FRONT_POINTS = 120;

const easeOut2 = (t) => 1 - (1 - t) * (1 - t);
const easeOut3 = (t) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const frames = (n) => new Promise((resolve) => { const step = (k) => (k ? requestAnimationFrame(() => step(k - 1)) : resolve()); step(n); });
const center = (el) => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
const trace = (ctx, pts) => { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); };

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

// The backdrop's copy for the flight, decoded ahead so the switch never shows it missing.
let backdropCopy = null;
function prepareBackdropCopy() {
  const real = document.getElementById('bg-front-img');
  const src = real?.currentSrc || real?.src;
  if (!src || backdropCopy?.dataset.src === src) return;
  backdropCopy = new Image();
  backdropCopy.dataset.src = src;
  backdropCopy.alt = '';
  backdropCopy.src = src;
  backdropCopy.decode?.().catch(() => {});
}
window.addEventListener('load', () => setTimeout(prepareBackdropCopy, 1500), { once: true });

let current = null;

// Whether the landing's transition is under way, so a route that cuts into it can end it plainly.
export const growTransitionRunning = () => Boolean(current);

export function growTransitionAllowed() {
  return !reducedMotion && !getGraphicsBudget('section-transition').quiet &&
    Boolean(document.querySelector('#main.active-section'));
}

// The growth front: a circle whose radius wanders with the angle in proportion to its size, so a small
// lens is nearly round and a large one keeps its lobes. Each point carries its lobe value for the drawing.
function frontPoints(seeds, cx, cy, r, t) {
  const pts = [];
  for (let i = 0; i < FRONT_POINTS; i++) {
    const a = (i / FRONT_POINTS) * Math.PI * 2;
    let k = 0;
    for (const [f, ph, w] of seeds) k += w * Math.sin(f * a + ph + t * 0.003 * (f % 3 + 1));
    const rr = Math.max(0, r * (1 + 0.075 * k));
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, a, rr, k]);
  }
  return pts;
}

function drawFront(ctx, edge, alpha) {
  // An inward glow, kept inside the lens.
  ctx.save();
  trace(ctx, edge);
  ctx.clip();
  for (const [w, a] of [[34, 0.07], [20, 0.12], [10, 0.2]]) {
    ctx.strokeStyle = `rgba(122,174,138,${a * alpha})`;
    ctx.lineWidth = w;
    trace(ctx, edge);
    ctx.stroke();
  }
  ctx.restore();
  // The front itself, thick and bright at the lobe tips, thin in the valleys.
  for (let i = 0; i < edge.length; i++) {
    const [x0, y0, , , k0] = edge[i];
    const [x1, y1, , , k1] = edge[(i + 1) % edge.length];
    const tip = Math.max(0, (k0 + k1) / 2);
    for (const [rgb, a, w] of [['150,215,175', 0.45 + 0.5 * tip, 1.4 + 4.2 * tip], ['235,255,242', 0.25 + 0.6 * tip, 0.8 + 1.2 * tip]]) {
      ctx.strokeStyle = `rgba(${rgb},${a * alpha})`;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
  }
  // Strands at the lobe tips and a few between, tapering out past the front.
  for (let i = 0; i < edge.length; i += 2) {
    const [x, y, angle, rr, k] = edge[i];
    const before = edge[(i - 2 + edge.length) % edge.length][4];
    const after = edge[(i + 2) % edge.length][4];
    const isTip = k > before && k >= after && k > 0.1;
    if (!isTip && (i * 7) % 11 !== 0) continue;
    const length = (isTip ? 10 + 10 * k : 6) * Math.min(1, rr / 90);
    const bend = (((i * 13) % 7) - 3) * 0.06;
    const mx = x + Math.cos(angle + bend) * length * 0.55;
    const my = y + Math.sin(angle + bend) * length * 0.55;
    const ex = x + Math.cos(angle + bend * 2) * length;
    const ey = y + Math.sin(angle + bend * 2) * length;
    ctx.strokeStyle = `rgba(170,225,190,${0.8 * alpha})`;
    ctx.lineWidth = isTip ? 1.8 : 1.2;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(mx, my); ctx.stroke();
    ctx.strokeStyle = `rgba(170,225,190,${0.45 * alpha})`;
    ctx.lineWidth = isTip ? 0.9 : 0.6;
    ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(ex, ey); ctx.stroke();
  }
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

// The flight: the backdrop's copy and frozen frames of the landing's moving layers (they are released
// as soon as the landing is left), in one layer that flies.
function buildFlight() {
  const flight = document.createElement('div');
  flight.className = 'grow-transition-flight';
  flight.setAttribute('aria-hidden', 'true');
  const real = document.getElementById('bg-front-img');
  if (real && backdropCopy?.complete && backdropCopy.naturalWidth) {
    const style = getComputedStyle(real);
    backdropCopy.style.cssText = `filter:${style.filter};opacity:${style.opacity};mix-blend-mode:${style.mixBlendMode}`;
    flight.append(backdropCopy);
  }
  for (const id of ['pulse-canvas', 'spore-canvas', 'reveal-canvas']) {
    const source = document.getElementById(id);
    if (!source || source.width < 2) continue;
    const copy = document.createElement('canvas');
    copy.width = source.width;
    copy.height = source.height;
    copy.getContext('2d')?.drawImage(source, 0, 0);
    copy.style.mixBlendMode = getComputedStyle(source).mixBlendMode;
    flight.append(copy);
  }
  return flight;
}

function restore(run, settle) {
  const { stage, main, nav, bg, flight } = run;
  for (const el of [stage, main, nav]) {
    el.style.clipPath = '';
    el.style.opacity = '';
    el.style.transform = '';
    el.style.transformOrigin = '';
    el.style.transition = 'none';
  }
  main.style.contentVisibility = '';
  nav.style.visibility = '';
  run.canvas.remove();
  document.body.classList.remove('grow-transition');
  if (settle) {
    // The backdrop comes back at its own scale behind the section as the flown copy fades.
    flight.style.transition = `opacity ${BACKDROP_IN_MS}ms ease-out`;
    flight.style.opacity = '0';
    bg.style.transition = `opacity ${BACKDROP_IN_MS}ms ease-out`;
    bg.style.opacity = '';
    run.settleTimer = setTimeout(() => { flight.remove(); bg.style.transition = ''; }, BACKDROP_IN_MS + 20);
  } else {
    flight.remove();
    bg.style.transition = 'none';
    bg.style.opacity = '';
  }
  // The inline transitions stay off for a frame, so nothing fades back from the inline values.
  requestAnimationFrame(() => {
    for (const el of [stage, main, nav]) el.style.transition = '';
    if (!settle) bg.style.transition = '';
  });
}

// Ends a running transition at once: the section as the router left it, the landing as CSS has it.
export function finishGrowTransition() {
  finishSpread();
  const run = current;
  if (!run) return;
  current = null;
  cancelAnimationFrame(run.raf);
  restore(run, false);
}

// show() switches to the section the usual way; the flight and the lens then carry the eye into it.
export function growInto(label, id, show) {
  finishGrowTransition();
  const stage = document.querySelector(`.stage[data-section="${id}"]`);
  const main = document.getElementById('main');
  const nav = document.getElementById('network-nav');
  const bg = document.getElementById('bg');
  if (!stage || !main || !nav || !bg) { show(); return; }
  const node = center(label);
  const hubEl = document.querySelector('.network-sigil-node');
  const hub = hubEl ? center(hubEl) : null;
  const route = routePath(id, node, hub);
  const [nx, ny] = node;
  const radius = Math.max(...[[0, 0], [innerWidth, 0], [0, innerHeight], [innerWidth, innerHeight]]
    .map(([x, y]) => Math.hypot(x - nx, y - ny))) * 1.15 + 30;
  const seeds = Array.from({ length: 6 }, (_, i) => [3 + i * 2 + Math.round(Math.random() * 2), Math.random() * Math.PI * 2, 0.6 / (i + 1)]);

  const canvas = document.createElement('canvas');
  canvas.className = 'grow-transition-layer';
  canvas.setAttribute('aria-hidden', 'true');
  const dpr = Math.min(getGraphicsBudget('section-transition').dprCap || 1, window.devicePixelRatio || 1);
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const flight = buildFlight();
  flight.style.transformOrigin = `${nx}px ${ny}px`;
  document.body.append(flight, canvas);
  document.body.classList.add('grow-transition');
  show();
  // The section is open behind a closed lens, so it builds now. The landing's words stay until they have
  // faded, laid out past the landing's own leave, and the labels with them.
  for (const el of [stage, main, nav]) el.style.transition = 'none';
  main.style.opacity = '1';
  main.style.contentVisibility = 'visible';
  nav.style.opacity = '1';
  nav.style.visibility = 'visible';
  stage.style.opacity = '1';
  stage.style.transformOrigin = `${nx}px ${ny}px`;
  stage.style.clipPath = 'polygon(0 0, 0 0, 0 0)';
  if (flight.childElementCount) {
    bg.style.transition = 'none';
    bg.style.opacity = '0';
  }

  const started = performance.now();
  const run = { stage, main, nav, bg, flight, canvas, raf: 0 };
  current = run;
  let readyAt = Infinity;
  (async () => {
    await frames(2);
    const scene = id === 'blog' ? stage.querySelector('#blog-network-canvas') : id === 'work' ? stage.querySelector('#work-globe-canvas') : null;
    while (scene && !scene.classList.contains('is-drawn') && performance.now() - started < OPEN_LATEST) await frames(1);
    readyAt = performance.now() - started;
  })();
  let openAt = null;

  const frame = (now) => {
    if (current !== run) return;
    const t = now - started;
    if (openAt == null && t >= OPEN_EARLIEST && (t >= readyAt || t >= OPEN_LATEST)) openAt = t;
    const p = openAt == null ? 0 : Math.min(1, (t - openAt) / OPEN_MS);
    const r = radius * easeOut2(easeOut3(p) * 0.5 + p * 0.5);
    const z = 1 + (PUSH - 1) * easeInOut(Math.min(1, t / PUSH_MS));
    flight.style.transform = `scale(${z.toFixed(4)})`;
    const words = (1 - Math.min(1, t / WORDS_OUT_MS)).toFixed(3);
    main.style.opacity = words;
    nav.style.opacity = words;
    // A touch of depth for the section as the front passes.
    stage.style.transform = `scale(${(1.05 - 0.05 * easeOut3(p)).toFixed(4)})`;
    const edge = openAt == null ? null : frontPoints(seeds, nx, ny, r, t);
    if (edge) stage.style.clipPath = `polygon(${edge.map(([x, y]) => `${x.toFixed(1)}px ${y.toFixed(1)}px`).join(',')})`;

    ctx.clearRect(0, 0, innerWidth, innerHeight);
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
    // The route: a lit hypha under a comet head, flying with the network, kept outside the lens.
    const routeFade = 1 - Math.min(1, p * 1.6);
    if (route && routeFade > 0.01) {
      const grown = easeInOut(Math.min(1, t / ROUTE_MS));
      const head = route.len * grown;
      const fly = ([x, y]) => [nx + (x - nx) * z, ny + (y - ny) * z];
      ctx.save();
      if (edge) {
        ctx.beginPath();
        ctx.rect(0, 0, innerWidth, innerHeight);
        edge.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        ctx.clip('evenodd');
      }
      for (const [rgb, a, w] of [['143,180,255', 0.3, 10], ['122,174,138', 0.85, 4], ['235,255,242', 1, 1.8]]) {
        ctx.strokeStyle = `rgba(${rgb},${a * routeFade})`;
        ctx.lineWidth = w * Math.sqrt(z);
        ctx.beginPath();
        const start = fly(route.pts[0]);
        ctx.moveTo(start[0], start[1]);
        for (let i = 1; i < route.pts.length && route.cum[i] <= head; i++) {
          const q = fly(route.pts[i]);
          ctx.lineTo(q[0], q[1]);
        }
        const tip = fly(pointAlong(route, head));
        ctx.lineTo(tip[0], tip[1]);
        ctx.stroke();
      }
      if (grown < 1) {
        const tip = fly(pointAlong(route, head));
        ctx.globalAlpha = routeFade;
        ctx.drawImage(glow, tip[0] - 22, tip[1] - 22, 44, 44);
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }
    // The growth front, gone before the lens covers the window.
    if (edge) {
      const frontAlpha = 1 - Math.min(1, p / 0.66);
      if (frontAlpha > 0.01) drawFront(ctx, edge, frontAlpha);
    }
    ctx.globalCompositeOperation = 'source-over';

    if ((openAt != null && p >= 1) || t >= END_MS) {
      current = null;
      restore(run, true);
      return;
    }
    run.raf = requestAnimationFrame(frame);
  };
  run.raf = requestAnimationFrame(frame);
}

window.addEventListener('resize', () => { finishGrowTransition(); finishInoculation(); }, { passive: true });
document.addEventListener('visibilitychange', () => { if (document.hidden) { finishGrowTransition(); finishInoculation(); } });

// A lens: an overlay for the front, sized to the window at the transition's resolution.
function frontLayer() {
  const canvas = document.createElement('canvas');
  canvas.className = 'grow-transition-layer';
  canvas.setAttribute('aria-hidden', 'true');
  const dpr = Math.min(getGraphicsBudget('section-transition').dprCap || 1, window.devicePixelRatio || 1);
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  return { canvas, ctx };
}
const reach = (x, y) => Math.max(...[[0, 0], [innerWidth, 0], [0, innerHeight], [innerWidth, innerHeight]]
  .map(([cx, cy]) => Math.hypot(cx - x, cy - y))) * 1.12 + 30;
const lobes = () => Array.from({ length: 6 }, (_, i) => [3 + i * 2 + Math.round(Math.random() * 2), Math.random() * Math.PI * 2, 0.6 / (i + 1)]);
const polygon = (edge) => `polygon(${edge.map(([x, y]) => `${x.toFixed(1)}px ${y.toFixed(1)}px`).join(',')})`;
const CLOSED = 'polygon(0 0, 0 0, 0 0)';

// Clears the inline styles a lens set, with the transitions held off for a frame so nothing fades back.
function release(els) {
  for (const el of els) {
    el.style.transition = 'none';
    el.style.clipPath = '';
    el.style.opacity = '';
  }
  requestAnimationFrame(() => { for (const el of els) el.style.transition = ''; });
}

// Section to section. The front starts where the pointer last pressed, if that was the move, else in the
// middle of the window (a wheel step, a key, Back or Forward).
const SPREAD_MS = 640;
let lastPress = null;
addEventListener('pointerdown', (event) => { lastPress = [event.clientX, event.clientY, performance.now()]; }, { capture: true, passive: true });
let spreading = null;

export function spreadAllowed(from, to) {
  return !reducedMotion && !getGraphicsBudget('section-transition').quiet &&
    Boolean(from && to) && from !== to && from !== 'intro' && to !== 'intro';
}

function finishSpread() {
  const run = spreading;
  if (!run) return;
  spreading = null;
  cancelAnimationFrame(run.raf);
  run.canvas.remove();
  release([run.stage]);
}

export function spreadInto(stage) {
  finishSpread();
  if (!stage) return;
  const press = lastPress && performance.now() - lastPress[2] < 800 ? lastPress : null;
  const [ox, oy] = press || [innerWidth / 2, innerHeight / 2];
  const radius = reach(ox, oy);
  const seeds = lobes();
  const { canvas, ctx } = frontLayer();
  document.body.append(canvas);
  stage.style.transition = 'none';
  stage.style.opacity = '1';
  stage.style.clipPath = CLOSED;
  const started = performance.now();
  const run = { stage, canvas, raf: 0 };
  spreading = run;
  const frame = (now) => {
    if (spreading !== run) return;
    const t = now - started;
    const p = Math.min(1, t / SPREAD_MS);
    const edge = frontPoints(seeds, ox, oy, radius * easeOut2(easeOut3(p) * 0.5 + p * 0.5), t);
    stage.style.clipPath = polygon(edge);
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    ctx.globalCompositeOperation = 'lighter';
    const alpha = 1 - Math.min(1, p / 0.7);
    if (alpha > 0.01) drawFront(ctx, edge, alpha);
    ctx.globalCompositeOperation = 'source-over';
    if (p >= 1) { finishSpread(); return; }
    run.raf = requestAnimationFrame(frame);
  };
  run.raf = requestAnimationFrame(frame);
}

// The first landing of a visit. The network's layers stay closed behind the loading veil, which then lifts
// without waiting for the backdrop. Once the veil is gone and the backdrop has loaded, a short dark beat,
// then the network opens from the hub: the backdrop and the pulses as the front reaches them, and the
// spores settle once it has grown. The section labels stand from the start, so the way on is never held
// back. Any input, a route change, a resize or a hidden tab opens it all at once.
const INOCULATE_MS = 2400;
const INOCULATE_BEAT_MS = 150;
const SPORES_IN_MS = 600;
const INOCULATED_KEY = 'az-inoculated';
let inoculating = null;

export function finishInoculation() {
  const run = inoculating;
  if (!run) return;
  inoculating = null;
  cancelAnimationFrame(run.raf);
  clearTimeout(run.cap);
  run.canvas?.remove();
  for (const [type, fn] of run.listeners) removeEventListener(type, fn, true);
  release(run.layers);
  // The spores fade in where they already drift.
  const spores = run.spores;
  if (spores) {
    spores.style.opacity = '0';
    spores.style.visibility = '';
    requestAnimationFrame(() => {
      spores.style.transition = `opacity ${SPORES_IN_MS}ms ease-out`;
      spores.style.opacity = '';
      setTimeout(() => { spores.style.transition = ''; }, SPORES_IN_MS);
    });
  }
}

export function inoculate() {
  if (reducedMotion || getGraphicsBudget('section-transition').quiet) return;
  if (!document.querySelector('#main.active-section') || (location.hash && location.hash !== '#main')) return;
  const veil = document.getElementById('threshold');
  if (!veil || veil.classList.contains('threshold--lifted')) return;
  try {
    if (sessionStorage.getItem(INOCULATED_KEY)) return;
    sessionStorage.setItem(INOCULATED_KEY, '1');
  } catch { /* storage blocked, so it grows on every landing */ }
  // Read by the veil's script in index.html at DOMContentLoaded, after this module has run.
  window.__inoculating = true;
  const layers = ['bg', 'pulse-canvas', 'reveal-canvas']
    .map((id) => document.getElementById(id)).filter(Boolean);
  for (const el of layers) el.style.clipPath = CLOSED;
  // The spores wait out of sight and fade in once it has grown, which keeps the clipped layers to three.
  const spores = document.getElementById('spore-canvas');
  if (spores) spores.style.visibility = 'hidden';
  const run = { layers, spores, canvas: null, ctx: null, raf: 0, cap: 0, listeners: [] };
  inoculating = run;
  const skip = () => finishInoculation();
  for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
    run.listeners.push([type, skip]);
    addEventListener(type, skip, true);
  }
  const seeds = lobes();
  let started = 0, origin = null, radius = 0, readyAt = 0;
  const backdrop = document.getElementById('bg-front-img');
  const frame = (now) => {
    if (inoculating !== run) return;
    if (!started) {
      // Wait for the veil to be gone, the backdrop to have loaded and the hub to be placed (the labels are
      // laid out once the cover is known), then hold the dark for a beat.
      const hub = document.querySelector('.network-sigil-node');
      const ready = veil.classList.contains('threshold--done') && (!backdrop || backdrop.complete) && hub?.getBoundingClientRect().width;
      if (ready && !readyAt) readyAt = now;
      if (!ready || now - readyAt < INOCULATE_BEAT_MS) {
        run.raf = requestAnimationFrame(frame);
        return;
      }
      origin = center(hub);
      radius = reach(origin[0], origin[1]);
      ({ canvas: run.canvas, ctx: run.ctx } = frontLayer());
      document.body.append(run.canvas);
      started = now;
    }
    const t = now - started;
    const p = Math.min(1, t / INOCULATE_MS);
    const edge = frontPoints(seeds, origin[0], origin[1], radius * easeInOut(p), t);
    const clip = polygon(edge);
    for (const el of layers) el.style.clipPath = clip;
    const { ctx } = run;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    ctx.globalCompositeOperation = 'lighter';
    // The hub wakes first, a breath of light where the culture was set.
    const wake = Math.max(0, 1 - t / 600);
    if (wake > 0) {
      ctx.globalAlpha = wake;
      ctx.drawImage(glow, origin[0] - 40, origin[1] - 40, 80, 80);
      ctx.globalAlpha = 1;
    }
    const alpha = 1 - Math.max(0, (p - 0.55) / 0.45);
    if (alpha > 0.01) drawFront(ctx, edge, alpha);
    ctx.globalCompositeOperation = 'source-over';
    if (p >= 1) { finishInoculation(); return; }
    run.raf = requestAnimationFrame(frame);
  };
  run.raf = requestAnimationFrame(frame);
  // The veil lifts within its own cap, and a backdrop slower than this is not waited for, so this never
  // holds the network shut.
  run.cap = setTimeout(() => { if (inoculating === run && !started) finishInoculation(); }, 5000);
}
