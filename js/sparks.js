// Spark animation system

import { cumulativeLengths, pointAt } from './utils.js';
import { aStarPath } from './graph.js';
import { NAV_COORDS, MAX_SPARKS } from './config.js';
import {
  prefersReducedMotion,
  GRAPH,
  PATH_CACHE,
  NODE_IDS,
  ACTIVE_ANIMS,
  setActiveAnims,
  sparkCtx,
  sparkCanvas,
  ritualActive,
  followerSparks,
  LOCKED_ROUTES,
} from './state.js';
import { projectXY } from './viewport.js';

const loggedPathFailures = new Set();

// Reuse the glow sprite to avoid shadowBlur on every frame.
const GLOW_SIZE = 64;
const _glowCanvas = document.createElement('canvas');
_glowCanvas.width = GLOW_SIZE;
_glowCanvas.height = GLOW_SIZE;
const _glowCtx = _glowCanvas.getContext('2d');
const _grad = _glowCtx.createRadialGradient(GLOW_SIZE/2, GLOW_SIZE/2, 0, GLOW_SIZE/2, GLOW_SIZE/2, GLOW_SIZE/2);
_grad.addColorStop(0, 'rgba(200,255,220,1)');
_grad.addColorStop(0.15, 'rgba(200,255,220,0.8)');
_grad.addColorStop(0.4, 'rgba(122,174,138,0.3)');
_grad.addColorStop(0.7, 'rgba(143,180,255,0.1)');
_grad.addColorStop(1, 'rgba(143,180,255,0)');
_glowCtx.fillStyle = _grad;
_glowCtx.fillRect(0, 0, GLOW_SIZE, GLOW_SIZE);

export function startSpark(fromKey, toKey, speedPxPerSec = 650) {
  if (prefersReducedMotion || !GRAPH) return;
  if (ACTIVE_ANIMS.length >= MAX_SPARKS) ACTIVE_ANIMS.shift();

  const fromAnchor = NAV_COORDS[fromKey];
  const toAnchor = NAV_COORDS[toKey];
  if (!fromAnchor || !toAnchor) return;

  let idA = NODE_IDS[fromKey];
  let idB = NODE_IDS[toKey];

  if (idA == null || idB == null || idA < 0 || idB < 0) {
    for (const [id, pt] of Object.entries(NAV_COORDS)) {
      NODE_IDS[id] = GRAPH.nearestId(pt.x, pt.y, 80, 24);
    }
    idA = NODE_IDS[fromKey];
    idB = NODE_IDS[toKey];
  }

  if (idA == null || idB == null || idA < 0 || idB < 0) {
    const key = `${fromKey}->${toKey}`;
    if (!loggedPathFailures.has(key)) {
      console.warn('nearestId failed for spark path', key, { idA, idB });
      loggedPathFailures.add(key);
    }
    return;
  }

  const solved = aStarPath(idA, idB, GRAPH, PATH_CACHE);
  if (!solved || solved.length < 2) {
    const key = `${fromKey}->${toKey}`;
    if (!loggedPathFailures.has(key)) {
      console.warn('A* path missing for spark', key);
      loggedPathFailures.add(key);
    }
    return;
  }

  const pathImg = solved.map((pt) => ({ x: pt.x, y: pt.y }));
  pathImg[0] = { x: fromAnchor.x, y: fromAnchor.y };
  pathImg[pathImg.length - 1] = { x: toAnchor.x, y: toAnchor.y };

  const proj = projectXY(pathImg);
  const cum = cumulativeLengths(proj);
  const len = cum[cum.length - 1];
  if (!len) return;

  ACTIVE_ANIMS.push({
    imgPts: pathImg,
    projPts: proj,
    cum,
    len,
    s: 0,
    v: speedPxPerSec
  });
}

// The route a hovered or focused label lights, from the hub to the label, eased in and out under
// the travelling spark. It needs the spark loop, so Quiet (and reduced motion, which runs Quiet) has
// none, and the label's preview line carries the same news there.
const LIT_IN_PER_SEC = 1 / 0.14;
const LIT_OUT_PER_SEC = 1 / 0.26;
// The lit route's three strokes, outer glow to core: colour, peak alpha, width.
const LIT_STROKES = [['143,180,255', 0.12, 7], ['122,174,138', 0.4, 3], ['220,255,235', 0.6, 1.2]];
// The sigil's drawn radius, where a tie to a route that passes near the hub begins.
const HUB_EDGE = 26;
let litRoute = null;

export function setLitRoute(id) {
  if (id) litRoute = { id, alpha: litRoute?.id === id ? litRoute.alpha : 0, target: 1 };
  else if (litRoute) litRoute.target = 0;
}

// Leaving the landing drops the route at once, so it never fades in again on the way back.
export function clearLitRoute() {
  litRoute = null;
}

// After a resize the route and the sigil sit elsewhere, so the lit span is measured again.
export function remeasureLitRoute() {
  if (litRoute) litRoute.start = null;
}

export function litRouteHasWork() {
  return Boolean(litRoute && (litRoute.target > 0 || litRoute.alpha > 0.01));
}

function drawLitRoute(dt, pointAtRoute) {
  if (!litRouteHasWork()) return;
  const step = (litRoute.target > litRoute.alpha ? LIT_IN_PER_SEC : LIT_OUT_PER_SEC) * dt;
  litRoute.alpha = litRoute.target > litRoute.alpha
    ? Math.min(litRoute.target, litRoute.alpha + step)
    : Math.max(litRoute.target, litRoute.alpha - step);
  const route = LOCKED_ROUTES[litRoute.id];
  const pts = route?.projPts;
  if (!pts || pts.length < 2) return;
  // From the hub to where the label sits now (its home, or wherever the ritual has walked it). The
  // traced route runs on past the hub, so it starts at its point nearest the sigil.
  if (litRoute.start == null) {
    litRoute.hub = hubPoint();
    litRoute.start = nearestS(route, litRoute.hub);
  }
  const labelS = Math.min(route.len, route.s ?? route.len);
  const s0 = Math.min(litRoute.start, labelS);
  const s1 = Math.max(litRoute.start, labelS);
  // Where the traced path only passes near the hub, a short tie from the sigil's edge.
  const first = pointAtRoute(route, litRoute.start);
  const hub = litRoute.hub;
  const gap = hub ? Math.hypot(first[0] - hub[0], first[1] - hub[1]) : 0;
  const a = litRoute.alpha;
  sparkCtx.save();
  sparkCtx.lineCap = 'round';
  sparkCtx.lineJoin = 'round';
  for (const [rgb, peak, width] of LIT_STROKES) {
    sparkCtx.strokeStyle = `rgba(${rgb},${peak * a})`;
    sparkCtx.lineWidth = width;
    sparkCtx.beginPath();
    if (gap > HUB_EDGE) {
      const k = HUB_EDGE / gap;
      sparkCtx.moveTo(hub[0] + (first[0] - hub[0]) * k, hub[1] + (first[1] - hub[1]) * k);
      sparkCtx.lineTo(first[0], first[1]);
    }
    const from = pointAtRoute(route, s0);
    sparkCtx.moveTo(from[0], from[1]);
    for (let i = 1; i < pts.length; i++) {
      if (route.cum[i] <= s0) continue;
      if (route.cum[i] >= s1) break;
      sparkCtx.lineTo(pts[i][0], pts[i][1]);
    }
    const to = pointAtRoute(route, s1);
    sparkCtx.lineTo(to[0], to[1]);
    sparkCtx.stroke();
  }
  sparkCtx.restore();
  if (!litRouteHasWork()) litRoute = null;
}

// The round-capped strokes need a GPU program the canvas has not drawn with, and the first lit route
// compiled it inside the first hover's frame (about 55 ms, a shader compile in the GPU process). The idle
// warm-up strokes an invisible route in a corner first, then clears it.
export function warmLitRoute() {
  if (!sparkCtx) return;
  sparkCtx.save();
  sparkCtx.lineCap = 'round';
  sparkCtx.lineJoin = 'round';
  for (const [rgb, , width] of LIT_STROKES) {
    sparkCtx.strokeStyle = `rgba(${rgb},0.004)`;
    sparkCtx.lineWidth = width;
    sparkCtx.beginPath();
    sparkCtx.moveTo(2, 2);
    sparkCtx.lineTo(9, 5);
    sparkCtx.lineTo(14, 3);
    sparkCtx.stroke();
  }
  sparkCtx.restore();
  requestAnimationFrame(() => requestAnimationFrame(() => sparkCtx?.clearRect(0, 0, 24, 24)));
}

function hubPoint() {
  const r = document.querySelector('.network-sigil-node')?.getBoundingClientRect();
  return r && r.width ? [r.left + r.width / 2, r.top + r.height / 2] : null;
}

// The distance along a route to its point nearest p, or 0 without one.
function nearestS(route, p) {
  if (!p) return 0;
  let best = Infinity, bestS = 0;
  for (let i = 1; i < route.projPts.length; i++) {
    const [x0, y0] = route.projPts[i - 1], [x1, y1] = route.projPts[i];
    const dx = x1 - x0, dy = y1 - y0;
    const t = Math.max(0, Math.min(1, ((p[0] - x0) * dx + (p[1] - y0) * dy) / Math.max(1e-6, dx * dx + dy * dy)));
    const d = Math.hypot(x0 + dx * t - p[0], y0 + dy * t - p[1]);
    if (d < best) { best = d; bestS = route.cum[i - 1] + t * (route.cum[i] - route.cum[i - 1]); }
  }
  return bestS;
}

export function drawSparks(dt, pointAtRoute) {
  if (!sparkCtx || !sparkCanvas) return;
  const cssW = window.innerWidth;
  const cssH = window.innerHeight;
  sparkCtx.clearRect(0, 0, cssW, cssH);
  drawLitRoute(dt, pointAtRoute);

  const trailLen = 60;
  const survivors = [];

  for (const anim of ACTIVE_ANIMS) {
    anim.s += anim.v * dt;
    if (anim.s > anim.len) continue;

    const head = pointAt(anim.projPts, anim.cum, anim.s);
    const tail = pointAt(anim.projPts, anim.cum, Math.max(0, anim.s - trailLen));

    sparkCtx.save();
    sparkCtx.lineCap = 'round';
    sparkCtx.lineJoin = 'round';

    // Layered strokes provide the outer glow.
    sparkCtx.strokeStyle = 'rgba(143,180,255,0.2)';
    sparkCtx.lineWidth = 8;
    sparkCtx.beginPath();
    sparkCtx.moveTo(tail[0], tail[1]);
    sparkCtx.lineTo(head[0], head[1]);
    sparkCtx.stroke();

    // Layer 2: mid green
    sparkCtx.strokeStyle = 'rgba(122,174,138,0.6)';
    sparkCtx.lineWidth = 4;
    sparkCtx.beginPath();
    sparkCtx.moveTo(tail[0], tail[1]);
    sparkCtx.lineTo(head[0], head[1]);
    sparkCtx.stroke();

    // Layer 3: bright core
    sparkCtx.strokeStyle = 'rgba(240,255,245,0.9)';
    sparkCtx.lineWidth = 2;
    sparkCtx.beginPath();
    sparkCtx.moveTo(tail[0], tail[1]);
    sparkCtx.lineTo(head[0], head[1]);
    sparkCtx.stroke();

    // Head dot: pre-rendered glow sprite instead of arc + shadowBlur
    const glowR = 16;
    sparkCtx.drawImage(_glowCanvas, head[0] - glowR, head[1] - glowR, glowR * 2, glowR * 2);

    sparkCtx.restore();
    survivors.push(anim);
  }

  setActiveAnims(survivors);

  if (ritualActive && followerSparks.length && !prefersReducedMotion){
    for (const f of followerSparks){
      const route = LOCKED_ROUTES[f.id];
      if (!route || !route.projPts || route.projPts.length < 2) continue;

      const head = pointAtRoute(route, route.s);

      // Follower spark: pre-rendered glow sprite at multiple sizes for layered glow
      sparkCtx.save();
      sparkCtx.globalAlpha = 0.4 * f.alpha;
      sparkCtx.drawImage(_glowCanvas, head[0] - 20, head[1] - 20, 40, 40);
      sparkCtx.globalAlpha = 0.7 * f.alpha;
      sparkCtx.drawImage(_glowCanvas, head[0] - 10, head[1] - 10, 20, 20);
      sparkCtx.globalAlpha = 0.9 * f.alpha;
      sparkCtx.drawImage(_glowCanvas, head[0] - 5, head[1] - 5, 10, 10);
      sparkCtx.restore();
    }
  }
}

export function startSparkToPoint(fromKey, imgX, imgY, speed = 750) {
  if (prefersReducedMotion || !GRAPH) return;

  const fromId = NODE_IDS[fromKey];
  if (fromId == null || fromId < 0) return;

  const toId = GRAPH.nearestId(imgX, imgY, 96, 24);
  if (toId == null || toId < 0) {
    const key = `nonode:${imgX.toFixed(0)},${imgY.toFixed(0)}`;
    if (!loggedPathFailures.has(key)) {
      console.warn(`[LOCKED-ROUTE] No graph node near (${imgX.toFixed(0)}, ${imgY.toFixed(0)}) for spark`);
      loggedPathFailures.add(key);
    }
    return;
  }

  const solved = aStarPath(fromId, toId, GRAPH, PATH_CACHE);
  if (!solved || solved.length < 2) return;

  const imgPts = solved.map(p => ({ x: p.x, y: p.y }));
  const projPts = projectXY(imgPts);
  const cum = cumulativeLengths(projPts);
  const len = cum[cum.length - 1];
  if (!len) return;

  ACTIVE_ANIMS.push({
    imgPts, projPts, cum, len,
    s: 0, v: speed
  });
}
