// Nutrient pulses on the landing: soft comets that flow along the baked network toward the hub sigil,
// lighting the hypha behind them for a moment, eight at a time. The network feeds its centre, so the
// landing is never still. They reach the sigil and fade there, and never draw over it.
//
// A governor system ('intro-pulses'): they run on Rich and Balanced, never under Quiet or reduced
// motion, pause in a hidden tab, and give their canvas back whenever the landing is not shown. They
// need the network graph, which the idle warm-up builds (js/app.js calls startLandingPulses then).
import { COVER, GRAPH } from './state.js';
import { NAV_COORDS } from './config.js';
import { frameDue, getGraphicsBudget, reportFrameSample } from './graphics-governor.js';
import { reducedMotion } from './motion.js';
import { sizeCanvas } from './utils.js';

const COUNT = 8;
const SPEED = 42;        // screen px per second
const TAIL = 90;         // the comet's bright tail, px
const TRACE = 2.4;       // seconds the hypha stays lit behind a pulse
const ALPHA = 0.9;
const HEAD = 26;         // the head's glow, px
const WIDTH = 2.2;
const WALK_STEPS = 260;  // graph steps a pulse may travel
const MIN_TRIP = 220;    // px
const CORE = [220, 255, 235];
const MID = [122, 174, 138];
const HALO = [143, 180, 255];

const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

const glow = document.createElement('canvas');
glow.width = glow.height = 64;
{
  const g = glow.getContext('2d');
  const gradient = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, rgba(CORE, 1));
  gradient.addColorStop(0.18, rgba(CORE, 0.7));
  gradient.addColorStop(0.45, rgba(MID, 0.25));
  gradient.addColorStop(1, rgba(HALO, 0));
  g.fillStyle = gradient;
  g.fillRect(0, 0, 64, 64);
}

const canvas = document.getElementById('pulse-canvas');
const introStage = document.querySelector('.stage[data-section="intro"]');
let ctx = null;
let started = false;
let rafId = null;
let lastTs = 0;
let pulses = [];

const project = (node) => [node.x * COVER.s + COVER.dx, node.y * COVER.s + COVER.dy];
const onScreen = ([x, y]) => x > 20 && y > 20 && x < innerWidth - 20 && y < innerHeight - 20;
// The landing's name, portrait and bio sit on the left: the pulses keep to the network's side.
const inField = ([x]) => x > innerWidth * 0.42;

// A smooth walk: at each node the neighbour that turns least, with a little chance, so a pulse flows
// on through junctions rather than stopping where one traced path ends.
function walk(from) {
  const ids = [from];
  let previous = -1;
  let current = from;
  for (let i = 0; i < WALK_STEPS; i++) {
    const next = GRAPH.neighbors(current).filter((n) => n !== previous);
    if (!next.length) break;
    let pick = next[0];
    if (previous >= 0 && next.length > 1) {
      const a = GRAPH.nodes[current];
      const b = GRAPH.nodes[previous];
      const hx = a.x - b.x;
      const hy = a.y - b.y;
      let best = -Infinity;
      for (const n of next) {
        const c = GRAPH.nodes[n];
        const dot = ((c.x - a.x) * hx + (c.y - a.y) * hy) / (Math.hypot(c.x - a.x, c.y - a.y) * Math.hypot(hx, hy) || 1);
        const score = dot + Math.random() * 0.35;
        if (score > best) { best = score; pick = n; }
      }
    } else if (next.length > 1) {
      pick = next[Math.floor(Math.random() * next.length)];
    }
    previous = current;
    current = pick;
    ids.push(current);
  }
  return ids;
}

// A trip on screen, walked from a node on the network's side and run toward the hub: a walk that ends
// further from the hub than it began is run the other way.
function trip() {
  const hub = NAV_COORDS.intro;
  for (let tries = 0; tries < 60; tries++) {
    const id = Math.floor(Math.random() * GRAPH.nodes.length);
    const p0 = project(GRAPH.nodes[id]);
    if (!onScreen(p0) || !inField(p0)) continue;
    const ids = walk(id);
    const first = GRAPH.nodes[ids[0]];
    const last = GRAPH.nodes[ids[ids.length - 1]];
    if (Math.hypot(last.x - hub.x, last.y - hub.y) > Math.hypot(first.x - hub.x, first.y - hub.y)) ids.reverse();
    const pts = ids.map((n) => project(GRAPH.nodes[n]));
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    if (cum[cum.length - 1] < MIN_TRIP) continue;
    if (pts.filter(onScreen).length < pts.length * 0.8) continue;
    // Staggered, so the eight do not all begin together.
    return { pts, cum, len: cum[cum.length - 1], s: 0, wait: Math.random() * 2.5 };
  }
  return null;
}

function at(t, s) {
  let i = 1;
  while (i < t.cum.length - 1 && t.cum[i] < s) i++;
  const k = (s - t.cum[i - 1]) / Math.max(1e-6, t.cum[i] - t.cum[i - 1]);
  return [t.pts[i - 1][0] + (t.pts[i][0] - t.pts[i - 1][0]) * k, t.pts[i - 1][1] + (t.pts[i][1] - t.pts[i - 1][1]) * k];
}

function stroke(t, from, to, color, width) {
  const p0 = at(t, Math.max(0, from));
  const p1 = at(t, to);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(p0[0], p0[1]);
  ctx.lineTo(p1[0], p1[1]);
  ctx.stroke();
}

function draw(dt) {
  while (pulses.length < COUNT) {
    const t = trip();
    if (!t) break;
    pulses.push(t);
  }
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  for (let i = pulses.length - 1; i >= 0; i--) {
    const t = pulses[i];
    if (t.wait > 0) { t.wait -= dt; continue; }
    t.s += SPEED * dt;
    if (t.s > t.len + SPEED * TRACE) { pulses.splice(i, 1); continue; }
    const fadeIn = Math.min(1, t.s / 60);
    const live = fadeIn * Math.min(1, Math.max(0, (t.len - t.s) / 80));
    // The lit trace: the hypha behind the pulse, fading over TRACE seconds.
    const traceLen = SPEED * TRACE;
    const head = Math.min(t.s, t.len);
    for (let k = 0; k < 24; k++) {
      const s1 = head - (traceLen * k) / 24;
      if (s1 <= 0) break;
      stroke(t, s1 - traceLen / 24, s1, rgba(MID, ALPHA * 0.32 * (1 - k / 24) * fadeIn), WIDTH);
    }
    if (t.s > t.len) continue;
    // The comet: a brighter tail and a soft head.
    for (let k = 0; k < 12; k++) {
      const s1 = t.s - (TAIL * k) / 12;
      if (s1 <= 0) break;
      stroke(t, s1 - TAIL / 12, s1, rgba(CORE, ALPHA * 0.7 * (1 - k / 12) * live), WIDTH * 0.8);
    }
    const [x, y] = at(t, t.s);
    ctx.globalAlpha = ALPHA * live;
    ctx.drawImage(glow, x - HEAD / 2, y - HEAD / 2, HEAD, HEAD);
    ctx.globalAlpha = 1;
  }
  ctx.globalCompositeOperation = 'source-over';
}

const landingShown = () => Boolean(introStage?.classList.contains('active-section'));

function allowed() {
  const budget = getGraphicsBudget('intro-pulses');
  return started && Boolean(GRAPH) && COVER.ready && !reducedMotion && !budget.quiet && landingShown() && !document.hidden;
}

function release() {
  pulses = [];
  if (!canvas) return;
  ctx?.clearRect(0, 0, canvas.width, canvas.height);
  if (canvas.width !== 1 || canvas.height !== 1) {
    canvas.width = 1;
    canvas.height = 1;
  }
}

function loop(ts) {
  if (!allowed()) {
    release();
    rafId = null;
    return;
  }
  const budget = getGraphicsBudget('intro-pulses');
  if (frameDue(ts - lastTs, budget.frameIntervalMs)) {
    const dt = Math.min(0.05, (ts - lastTs) / 1000);
    reportFrameSample('intro-pulses', ts - lastTs, budget.frameIntervalMs);
    lastTs = ts;
    draw(dt);
  }
  rafId = requestAnimationFrame(loop);
}

function resize() {
  pulses = [];
  if (canvas && rafId != null) sizeCanvas(canvas, { systemName: 'intro-pulses' });
}

export function ensureLandingPulses() {
  if (rafId != null || !canvas || !allowed()) return;
  ctx ??= canvas.getContext('2d');
  if (!ctx) return;
  sizeCanvas(canvas, { systemName: 'intro-pulses' });
  lastTs = performance.now();
  rafId = requestAnimationFrame(loop);
}

// Called once the network graph exists. From then on the pulses follow the landing by themselves.
export function startLandingPulses() {
  if (started || !canvas) return;
  started = true;
  if (introStage) new MutationObserver(ensureLandingPulses).observe(introStage, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('visibilitychange', ensureLandingPulses);
  window.addEventListener('motion:preference', ensureLandingPulses);
  window.addEventListener('graphics:profile-change', ensureLandingPulses);
  window.addEventListener('resize', resize, { passive: true });
  ensureLandingPulses();
}
