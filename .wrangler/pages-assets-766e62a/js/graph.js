// Graph construction and pathfinding

export function buildGraphFromPaths(paths) {
  const QUANT = 3;
  const key = (x, y) => `${Math.round(x / QUANT)},${Math.round(y / QUANT)}`;

  const nodes = [];
  const keyToId = new Map();
  const adj = [];

  const addNode = (x, y) => {
    const k = key(x, y);
    if (!keyToId.has(k)) {
      keyToId.set(k, nodes.length);
      nodes.push({ x, y });
    }
    return keyToId.get(k);
  };

  const link = (a, b) => {
    if (a === b) return;
    (adj[a] ??= new Set()).add(b);
    (adj[b] ??= new Set()).add(a);
  };

  for (const poly of paths) {
    if (!poly || poly.length === 0) continue;
    let prev = addNode(poly[0][0], poly[0][1]);
    for (let i = 1; i < poly.length; i++) {
      const cur = addNode(poly[i][0], poly[i][1]);
      link(prev, cur);
      prev = cur;
    }
  }

  const neighborCache = new Map();
  const neighbors = (id) => {
    if (!neighborCache.has(id)) neighborCache.set(id, Array.from(adj[id] ?? []));
    return neighborCache.get(id);
  };

  const nearestId = (x, y, radius = 80, step = 24) => {
    let best = -1;
    let bestD2 = Infinity;

    const tryPoint = (px, py) => {
      const id = keyToId.get(key(px, py));
      if (id != null) {
        const dx = nodes[id].x - x;
        const dy = nodes[id].y - y;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) {
          best = id;
          bestD2 = d2;
        }
      }
    };

    for (let r = 0; r <= radius; r += step) {
      for (let dx = -r; dx <= r; dx += step) {
        tryPoint(x + dx, y - r);
        tryPoint(x + dx, y + r);
      }
      for (let dy = -r + step; dy <= r - step; dy += step) {
        tryPoint(x - r, y + dy);
        tryPoint(x + r, y + dy);
      }
    }
    return best;
  };

  return { nodes, neighbors, nearestId };
}

export function aStarPath(idA, idB, graph, pathCache) {
  if (!graph || idA < 0 || idB < 0) return null;
  const cacheKey = `${idA}->${idB}`;
  if (pathCache.has(cacheKey)) return pathCache.get(cacheKey);

  const nodes = graph.nodes;
  const neighbors = graph.neighbors;

  const open = new Set([idA]);
  const came = new Map();
  const g = new Map([[idA, 0]]);
  const f = new Map([[idA, 0]]);

  const h = (id) => {
    const A = nodes[id];
    const B = nodes[idB];
    const dx = A.x - B.x;
    const dy = A.y - B.y;
    return dx * dx + dy * dy;
  };

  while (open.size) {
    let current = null;
    let best = Infinity;
    for (const id of open) {
      const fi = f.get(id) ?? Infinity;
      if (fi < best) {
        best = fi;
        current = id;
      }
    }

    if (current === idB) {
      const out = [];
      for (let c = current; c != null; c = came.get(c)) out.push(nodes[c]);
      out.reverse();
      pathCache.set(cacheKey, out);
      return out;
    }

    open.delete(current);

    for (const nb of neighbors(current)) {
      const tentative = (g.get(current) ?? Infinity) + 1;
      if (tentative < (g.get(nb) ?? Infinity)) {
        came.set(nb, current);
        g.set(nb, tentative);
        f.set(nb, tentative + h(nb));
        open.add(nb);
      }
    }
  }

  return null;
}

/**
 * Stochastic A* for attention routes (subtle variation per hover).
 * Does NOT use or modify PATH_CACHE.
 * @param {number} idA - start node id
 * @param {number} idB - end node id
 * @param {object} graph - graph object
 * @param {object} opts - { seed?: number, tieEps?: number, costJitter?: number }
 * @returns {Array|null} - array of {x,y} points or null
 */
export function aStarPathStochastic(idA, idB, graph, opts = {}) {
  if (!graph || idA < 0 || idB < 0) return null;
  
  const { seed = Date.now(), tieEps = 0.15, costJitter = 0.08 } = opts;
  
  // Simple seeded random (mulberry32)
  let rngState = seed | 0;
  const rand = () => {
    rngState = (rngState + 0x6D2B79F5) | 0;
    let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  
  const nodes = graph.nodes;
  const neighbors = graph.neighbors;

  const open = new Set([idA]);
  const came = new Map();
  const g = new Map([[idA, 0]]);
  const f = new Map([[idA, 0]]);

  const h = (id) => {
    const A = nodes[id];
    const B = nodes[idB];
    const dx = A.x - B.x;
    const dy = A.y - B.y;
    return Math.sqrt(dx * dx + dy * dy);
  };

  while (open.size) {
    // Find best fScore
    let bestF = Infinity;
    for (const id of open) {
      const fi = f.get(id) ?? Infinity;
      if (fi < bestF) bestF = fi;
    }
    
    // Gather candidates within tieEps of best (tie-breaking randomness)
    const candidates = [];
    const threshold = bestF * (1 + tieEps);
    for (const id of open) {
      const fi = f.get(id) ?? Infinity;
      if (fi <= threshold) candidates.push(id);
    }
    
    // Pick randomly among candidates
    const current = candidates[Math.floor(rand() * candidates.length)];

    if (current === idB) {
      const out = [];
      for (let c = current; c != null; c = came.get(c)) out.push(nodes[c]);
      out.reverse();
      return out;
    }

    open.delete(current);

    for (const nb of neighbors(current)) {
      // Add slight cost jitter (seeded)
      const jitter = 1 + costJitter * (rand() * 2 - 1);
      const tentative = (g.get(current) ?? Infinity) + jitter;
      if (tentative < (g.get(nb) ?? Infinity)) {
        came.set(nb, current);
        g.set(nb, tentative);
        f.set(nb, tentative + h(nb));
        open.add(nb);
      }
    }
  }

  return null;
}
