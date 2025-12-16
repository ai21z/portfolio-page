/**
 * routes.js
 * Locked route building system for navigation labels.
 * Routes are computed once and locked to specific polylines on the mycelium network.
 */

import { 
  NAV_COORDS, 
  NAV_ORDER,
  LABEL_SPEEDS, 
  DEFAULT_SPEED,
  MIN_ROUTE_LEN_PX,
  MAX_ROUTE_LEN_PX,
  RESAMPLE_STEP_PX,
  RESAMPLE_MIN_POINTS
} from './config.js';
import { GRAPH, LOCKED_ROUTES, setLockedRoutes } from './state.js';
import { coverMap, projectXY } from './viewport.js';
import { cumulativeLengths, pointAt } from './utils.js';

// Local storage for routes during building
const LOCKED = new Map(); // id -> {imgPts, projPts, cum, len, s, dir, speed}

// Helper: Get degree (number of neighbors) of a graph node
const deg = (id) => (GRAPH.neighbors(id) || []).length;

// Helper: Calculate distance between two points
const hyp = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Walk off tiny spurs: if start is a leaf, climb until a junction (deg!=2).
 */
function climbToSpine(id, prev = null, maxHops = 80) {
  let a = prev, b = id, hops = 0;
  while (hops++ < maxHops) {
    const nbs = GRAPH.neighbors(b).filter(n => n !== a);
    if (nbs.length !== 1) break; // stop at leaf(0) or junction(>=2)
    a = b; b = nbs[0];
  }
  return b;
}

/**
 * BFS in geodesic length; optionally forbid the first hop from src.
 */
function farthestLeafFrom(src, forbidFirstHop = -1) {
  const q = [src];
  const dist   = new Map([[src, 0]]);
  const parent = new Map();
  const firstHop = new Map();

  while (q.length) {
    const u = q.shift();
    for (const v of GRAPH.neighbors(u)) {
      if (u === src && v === forbidFirstHop) continue;
      if (!dist.has(v)) {
        const w = hyp(GRAPH.nodes[u], GRAPH.nodes[v]);
        dist.set(v, dist.get(u) + w);
        parent.set(v, u);
        firstHop.set(v, firstHop.get(u) ?? v);
        q.push(v);
      }
    }
  }

  let best = src, bestD = -1;
  for (const [v, d] of dist) if (d > bestD) { best = v; bestD = d; }
  return { leaf: best, parent, dist, firstHop };
}

/**
 * Rebuild path from parent map (A* result).
 */
function rebuildPath(parent, end) {
  const out = [];
  for (let v = end; v != null; v = parent.get(v)) out.push(GRAPH.nodes[v]);
  return out.reverse();
}

/**
 * Slice a polyline to a centered window (by arc-length) around the anchor.
 */
function trimAroundAnchor(imgPts, maxLenPx, anchor) {
  const proj = imgPts.map(p => [p.x, p.y]);
  const cum  = cumulativeLengths(proj);
  const total = cum[cum.length - 1];

  // index of poly point closest to anchor
  const idx = proj.reduce((best, p, i) =>
    (Math.hypot(p[0]-anchor.x, p[1]-anchor.y) <
     Math.hypot(proj[best][0]-anchor.x, proj[best][1]-anchor.y)) ? i : best
  , 0);

  const centerS = cum[idx];
  const half = maxLenPx / 2;
  const s0 = Math.max(0, centerS - half);
  const s1 = Math.min(total, centerS + half);

  // turn window into points
  const out = [];
  const steps = Math.max(2, Math.round((s1 - s0) / RESAMPLE_STEP_PX));
  for (let i = 0; i <= steps; i++) {
    const s = s0 + (i * (s1 - s0)) / steps;
    out.push(pointAt(proj, cum, s));
  }
  return { imgPts: out.map(([x,y]) => ({ x, y })), len: s1 - s0 };
}

/**
 * Resample polyline to uniform spacing in viewport coordinates.
 */
function resampleToViewport(imgPts) {
  // Project to viewport, then resample to uniform spacing with a minimum count.
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

/**
 * Find arc-length on route closest to a viewport point.
 */
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

/**
 * Compute a locked route for a navigation label.
 */
function computeLockedRouteFor(id, anchor) {
  // Wider radius + finer step, with retry on failure
  let start = GRAPH.nearestId(anchor.x, anchor.y, /*radius*/ 160, /*step*/ 12);
  
  // Retry with wider radius if first attempt failed
  if (start < 0) {
    console.warn(`⚠️ [LOCKED-ROUTE] ${id}: nearestId failed at r=160, retrying with r=240`);
    start = GRAPH.nearestId(anchor.x, anchor.y, /*radius*/ 240, /*step*/ 12);
  }
  
  if (start < 0) {
    console.error(`❌ [LOCKED-ROUTE] ${id}: nearestId failed even with r=240`);
    return null;
  }

  // If on a tiny twig, walk to a spine before evaluating both directions.
  if (deg(start) <= 1) start = climbToSpine(start);

  // Two directions from the spine: pick two farthest leaves on distinct sides.
  const A = farthestLeafFrom(start);
  const avoid = A.firstHop.get(A.leaf) ?? -1;
  const B = farthestLeafFrom(start, avoid);

  let left  = rebuildPath(A.parent, A.leaf);
  let right = rebuildPath(B.parent, B.leaf);

  // Ensure both include the spine as their first point.
  const spine = GRAPH.nodes[start];
  const eq = (p,q) => p.x === q.x && p.y === q.y;
  while (left.length  && !eq(left[0], spine))  left.shift();
  while (right.length && !eq(right[0], spine)) right.shift();

  // Build a long, continuous branch passing through the anchor's spine.
  const raw = [...left.reverse(), spine, ...right.slice(1)];

  // Limit window around the anchor so movement is generous but not crazy.
  const trimmed = trimAroundAnchor(raw, MAX_ROUTE_LEN_PX, anchor);

  // Guarantee enough samples to move smoothly.
  const sampled = resampleToViewport(trimmed.imgPts);
  if (sampled.projPts.length < 2) {
    console.error(`❌ [LOCKED-ROUTE] ${id}: resample produced < 2 points`);
    return null;
  }

  // Enforce minimum length (target 140-240px)
  if (sampled.len < MIN_ROUTE_LEN_PX) {
    console.warn(`⚠️ [LOCKED-ROUTE] ${id}: route too short (${sampled.len.toFixed(1)}px < ${MIN_ROUTE_LEN_PX}px)`);
    return { ...sampled, imgPts: trimmed.imgPts, len: sampled.len, tooShort: true };
  }
  
  return { ...sampled, imgPts: trimmed.imgPts };
}

/**
 * Build locked routes for all navigation labels.
 */
export function buildLockedRoutes() {
  LOCKED.clear();
  
  for (const [id, anchor] of Object.entries(NAV_COORDS)) {
    if (id === 'intro') continue; // sigil stays static
    
    const route = computeLockedRouteFor(id, anchor);
    if (!route) {
      console.warn(`❌ [LOCKED-ROUTE] ${id}: failed; fallback to static anchor`);
      LOCKED.set(id, null);
      continue;
    }
    
    const pointsCount = route.projPts?.length || 0;
    
    // Log route quality with clear criteria
    if (route.tooShort || route.len < 140 || pointsCount < 3) {
      console.warn(`⚠️ [LOCKED-ROUTE] ${id}: len=${route.len.toFixed(1)}px, points=${pointsCount} (BELOW TARGET: want 140-240px, ≥3 points)`);
    }
    
    // Find the arc-length position on route closest to the anchor
    // This is where labels START (sHome) and where they are in static mode
    const [anchorX, anchorY] = coverMap(anchor.x, anchor.y);
    const sHome = findClosestSOnRoute(route, anchorX, anchorY);
    
    // Add animation state with safe margins (sMin/sMax)
    const MIN_S = 24;
    const MAX_S = Math.max(MIN_S + 1, route.len - 24);
    
    // Clamp sHome to safe bounds
    const clampedHome = Math.max(MIN_S, Math.min(MAX_S, sHome));
    
    route.s = clampedHome; // Start at anchor position
    route.sHome = clampedHome; // Where it returns when ritual is off
    route.sMin = MIN_S;
    route.sMax = MAX_S;
    route.dir = 1;
    route.speed = LABEL_SPEEDS[id] ?? DEFAULT_SPEED;
    
    LOCKED.set(id, route);
  }
  
  // Copy to LOCKED_ROUTES for compatibility with existing code
  const newLockedRoutes = {};
  for (const [id, route] of LOCKED) {
    if (route) newLockedRoutes[id] = route;
  }
  setLockedRoutes(newLockedRoutes);
}

/**
 * Interpolate position along locked route (viewport coordinates).
 */
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

/**
 * Get image-space point at current s on route.
 */
export function imgPointAtRoute(route, s) {
  if (s <= 0) return [route.imgPts[0].x, route.imgPts[0].y];
  if (s >= route.len) {
    const last = route.imgPts[route.imgPts.length - 1];
    return [last.x, last.y];
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
  
  const pt0 = route.imgPts[i - 1];
  const pt1 = route.imgPts[i];
  
  return [
    pt0.x + (pt1.x - pt0.x) * t,
    pt0.y + (pt1.y - pt0.y) * t
  ];
}
