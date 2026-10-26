// Graph construction and pathfinding

// network-lite.json writes each path as its start in steps of quant, then a letter per step to one of
// the 8 neighbours, or a longer step in brackets (scripts/generate-network-lite.mjs). This reads it back
// to [x, y] points. Plain point arrays pass through.
const STEP_OFFSETS = { a: [0, -1], b: [1, -1], c: [1, 0], d: [1, 1], e: [0, 1], f: [-1, 1], g: [-1, 0], h: [-1, -1] };
export function decodeNetworkPaths(data) {
  if (data?.encoding !== 'steps') return data;
  const quant = data.quant || 1;
  const paths = data.paths.map((encoded) => {
    const start = /^(-?\d+),(-?\d+)/.exec(encoded);
    let x = Number(start[1]) * quant;
    let y = Number(start[2]) * quant;
    const points = [[x, y]];
    for (let i = start[0].length; i < encoded.length; i++) {
      let dx;
      let dy;
      if (encoded[i] === '(') {
        const end = encoded.indexOf(')', i);
        [dx, dy] = encoded.slice(i + 1, end).split(',').map(Number);
        i = end;
      } else {
        [dx, dy] = STEP_OFFSETS[encoded[i]];
      }
      x += dx * quant;
      y += dy * quant;
      points.push([x, y]);
    }
    return points;
  });
  return { ...data, paths };
}

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
