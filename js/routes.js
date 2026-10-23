// Route computation for navigation labels

import { 
  NAV_COORDS, 
  LABEL_SPEEDS, 
  DEFAULT_SPEED,
  MIN_ROUTE_LEN_PX,
  MAX_ROUTE_LEN_PX,
  RESAMPLE_STEP_PX,
  RESAMPLE_MIN_POINTS
} from './config.js';
import { LOCKED_ROUTES, setLockedRoutes } from './state.js';
import { coverMap, projectXY } from './viewport.js';
import { cumulativeLengths, pointAt } from './utils.js';

const LOCKED = new Map();

// Route-layout diagnostics are noisy on normal loads (short routes fall back
// gracefully). Gate them behind the same ?hud debug flag as the HUD overlay.
const ROUTE_DEBUG = new URLSearchParams(window.location.search).has('hud');

const deg = (graph, id) => (graph.neighbors(id) || []).length;

const hyp = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function climbToSpine(graph, id, prev = null, maxHops = 80) {
  let a = prev, b = id, hops = 0;
  while (hops++ < maxHops) {
    const nbs = graph.neighbors(b).filter(n => n !== a);
    if (nbs.length !== 1) break;
    a = b; b = nbs[0];
  }
  return b;
}

// Breadth-first walk from src over the whole network, keeping each node's first-found parent and
// the walked length to it. The leaf is the node farthest along that walk, the first one found on
// a tie. The walk covers some 80,000 nodes twice per label, so it runs on typed arrays with an
// index queue. A shifted array and maps made it a 110 ms frame.
function farthestLeafFrom(graph, src, forbidFirstHop = -1) {
  const count = graph.nodes.length;
  const order = new Int32Array(count);
  const dist = new Float64Array(count).fill(-1);
  const parent = new Int32Array(count).fill(-1);
  const firstHop = new Int32Array(count).fill(-1);
  order[0] = src;
  dist[src] = 0;
  let head = 0;
  let tail = 1;

  while (head < tail) {
    const u = order[head++];
    for (const v of graph.neighbors(u)) {
      if (u === src && v === forbidFirstHop) continue;
      if (dist[v] < 0) {
        dist[v] = dist[u] + hyp(graph.nodes[u], graph.nodes[v]);
        parent[v] = u;
        firstHop[v] = u === src ? v : firstHop[u];
        order[tail++] = v;
      }
    }
  }

  let best = src, bestD = -1;
  for (let i = 0; i < tail; i++) {
    const v = order[i];
    if (dist[v] > bestD) { best = v; bestD = dist[v]; }
  }
  return { leaf: best, parent, firstHop };
}

function rebuildPath(graph, parent, end) {
  const out = [];
  for (let v = end; v >= 0; v = parent[v]) out.push(graph.nodes[v]);
  return out.reverse();
}

function trimAroundAnchor(imgPts, maxLenPx, anchor) {
  const proj = imgPts.map(p => [p.x, p.y]);
  const cum  = cumulativeLengths(proj);
  const total = cum[cum.length - 1];

  const idx = proj.reduce((best, p, i) =>
    (Math.hypot(p[0]-anchor.x, p[1]-anchor.y) <
     Math.hypot(proj[best][0]-anchor.x, proj[best][1]-anchor.y)) ? i : best
  , 0);

  const centerS = cum[idx];
  const half = maxLenPx / 2;
  const s0 = Math.max(0, centerS - half);
  const s1 = Math.min(total, centerS + half);

  const out = [];
  const steps = Math.max(2, Math.round((s1 - s0) / RESAMPLE_STEP_PX));
  for (let i = 0; i <= steps; i++) {
    const s = s0 + (i * (s1 - s0)) / steps;
    out.push(pointAt(proj, cum, s));
  }
  return { imgPts: out.map(([x,y]) => ({ x, y })), len: s1 - s0 };
}

function resampleToViewport(imgPts) {
  const screenPts = projectXY(imgPts);
  const cum = cumulativeLengths(screenPts);
  const len = cum[cum.length - 1];
  const N = Math.max(RESAMPLE_MIN_POINTS, Math.ceil(len / RESAMPLE_STEP_PX));
  const out = [];
  for (let i = 0; i < N; i++) {
    const s = (len * i) / (N - 1);
    out.push(pointAt(screenPts, cum, s));
  }
  return { projPts: out, cum: cumulativeLengths(out), len };
}

function findClosestSOnRoute(route, vpX, vpY) {
  let bestS = 0;
  let bestDist = Infinity;
  
  for (let i = 0; i < route.projPts.length; i++) {
    const [x, y] = route.projPts[i];
    const dist = Math.hypot(x - vpX, y - vpY);
    if (dist < bestDist) {
      bestDist = dist;
      bestS = route.cum[i];
    }
  }
  
  return bestS;
}

// The label's route in image space: the longest run of the network through the node nearest its
// anchor, trimmed around the anchor.
function traceRouteFor(graph, id, anchor) {
  let start = graph.nearestId(anchor.x, anchor.y, 160, 12);

  if (start < 0) {
    if (ROUTE_DEBUG) console.warn(`[LOCKED-ROUTE] ${id}: nearestId failed at r=160, retrying with r=240`);
    start = graph.nearestId(anchor.x, anchor.y, 240, 12);
  }

  if (start < 0) {
    console.error(`[LOCKED-ROUTE] ${id}: nearestId failed even with r=240`);
    return null;
  }

  if (deg(graph, start) <= 1) start = climbToSpine(graph, start);

  const A = farthestLeafFrom(graph, start);
  const avoid = A.firstHop[A.leaf];
  const B = farthestLeafFrom(graph, start, avoid);

  let left  = rebuildPath(graph, A.parent, A.leaf);
  let right = rebuildPath(graph, B.parent, B.leaf);

  const spine = graph.nodes[start];
  const eq = (p,q) => p.x === q.x && p.y === q.y;
  while (left.length  && !eq(left[0], spine))  left.shift();
  while (right.length && !eq(right[0], spine)) right.shift();

  const raw = [...left.reverse(), spine, ...right.slice(1)];

  return trimAroundAnchor(raw, MAX_ROUTE_LEN_PX, anchor);
}

// The traced route on the current viewport.
function projectRoute(id, trimmed) {
  const sampled = resampleToViewport(trimmed.imgPts);
  if (sampled.projPts.length < 2) {
    console.error(`[LOCKED-ROUTE] ${id}: resample produced < 2 points`);
    return null;
  }

  if (sampled.len < MIN_ROUTE_LEN_PX) {
    if (ROUTE_DEBUG) console.warn(`[LOCKED-ROUTE] ${id}: route too short (${sampled.len.toFixed(1)}px < ${MIN_ROUTE_LEN_PX}px)`);
    return { ...sampled, imgPts: trimmed.imgPts, len: sampled.len, tooShort: true };
  }
  
  return { ...sampled, imgPts: trimmed.imgPts };
}

// Locks each label to a single polyline on the network. Tracing a label walks the whole network,
// so the page gets a turn before each one. The routes are put on the viewport together at the
// end, so a resize during the build cannot leave a label on the old layout.
export async function buildLockedRoutes(graph, pause = () => {}) {
  const traced = [];
  for (const [id, anchor] of Object.entries(NAV_COORDS)) {
    if (id === 'intro') continue;
    await pause();
    traced.push([id, anchor, traceRouteFor(graph, id, anchor)]);
  }

  LOCKED.clear();

  for (const [id, anchor, trimmed] of traced) {
    const route = trimmed && projectRoute(id, trimmed);
    if (!route) {
      if (ROUTE_DEBUG) console.warn(`[LOCKED-ROUTE] ${id}: failed; fallback to static anchor`);
      LOCKED.set(id, null);
      continue;
    }
    
    const [anchorX, anchorY] = coverMap(anchor.x, anchor.y);
    const sHome = findClosestSOnRoute(route, anchorX, anchorY);
    
    const MIN_S = 24;
    const MAX_S = Math.max(MIN_S + 1, route.len - 24);
    
    const clampedHome = Math.max(MIN_S, Math.min(MAX_S, sHome));
    
    route.s = clampedHome;
    route.sHome = clampedHome;
    route.sMin = MIN_S;
    route.sMax = MAX_S;
    route.dir = 1;
    route.speed = LABEL_SPEEDS[id] ?? DEFAULT_SPEED;
    
    LOCKED.set(id, route);
  }
  
  const newLockedRoutes = {};
  for (const [id, route] of LOCKED) {
    if (route) newLockedRoutes[id] = route;
  }
  setLockedRoutes(newLockedRoutes);
}

export function pointAtRoute(route, s) {
  if (s <= 0) return [route.projPts[0][0], route.projPts[0][1]];
  if (s >= route.len) {
    const last = route.projPts[route.projPts.length - 1];
    return [last[0], last[1]];
  }
  
  let lo = 0, hi = route.cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (route.cum[mid] < s) lo = mid + 1;
    else hi = mid;
  }
  
  const i = Math.max(1, lo);
  const segStart = route.cum[i - 1];
  const segLen = Math.max(1e-6, route.cum[i] - segStart);
  const t = (s - segStart) / segLen;
  
  const [x0, y0] = route.projPts[i - 1];
  const [x1, y1] = route.projPts[i];
  
  return [
    x0 + (x1 - x0) * t,
    y0 + (y1 - y0) * t
  ];
}

export function imgPointAtRoute(route, s) {
  const imgPts = route?.imgPts;
  if (!imgPts || imgPts.length === 0) return null;
  if (imgPts.length === 1) return [imgPts[0].x, imgPts[0].y];

  if (!route.imgCum || route.imgCum.length !== imgPts.length) {
    route.imgCum = cumulativeLengths(imgPts.map((p) => [p.x, p.y]));
  }

  const imgCum = route.imgCum;
  const imgLen = imgCum[imgCum.length - 1] || 0;
  if (imgLen <= 0) {
    const last = imgPts[imgPts.length - 1];
    return [last.x, last.y];
  }

  const routeLen = route.len || imgLen;
  const ratio = routeLen > 0 ? Math.max(0, Math.min(1, s / routeLen)) : 0;
  const imgS = ratio * imgLen;
  if (imgS <= 0) return [imgPts[0].x, imgPts[0].y];
  if (imgS >= imgLen) {
    const last = imgPts[imgPts.length - 1];
    return [last.x, last.y];
  }
  
  let lo = 0, hi = imgCum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (imgCum[mid] < imgS) lo = mid + 1;
    else hi = mid;
  }
  
  const i = Math.max(1, lo);
  const segStart = imgCum[i - 1];
  const segLen = Math.max(1e-6, imgCum[i] - segStart);
  const t = (imgS - segStart) / segLen;
  
  const pt0 = imgPts[i - 1];
  const pt1 = imgPts[i];
  
  return [
    pt0.x + (pt1.x - pt0.x) * t,
    pt0.y + (pt1.y - pt0.y) * t
  ];
}
