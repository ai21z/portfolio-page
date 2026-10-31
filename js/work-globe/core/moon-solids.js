// The projects' moons as solids: TrueRolls as a d20, Talos as its helmet mark. Both are flat-faced and
// unindexed, so every face carries its own normal, and every vertex carries an edge attribute the moon
// shader inks the face's true edges from: one value per side that is 0 on that side and runs to 1 across
// the face, held at 1 for a side that is only a seam of the triangulation.

function createMesh() {
  const positions = [];
  const normals = [];
  const edges = [];
  const tints = [];
  return {
    // A triangle a, b, c with one normal and tint. sides flags the true edges ab, bc and ca.
    triangle(a, b, c, normal, tint, sides = [true, true, true]) {
      const [ab, bc, ca] = sides;
      const corners = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
      [a, b, c].forEach((p, i) => {
        positions.push(p[0], p[1], p[2]);
        normals.push(normal[0], normal[1], normal[2]);
        // The value opposite each side, a side's own value is 0 along it.
        edges.push(bc ? corners[i][0] : 1, ca ? corners[i][1] : 1, ab ? corners[i][2] : 1, 1);
        tints.push(tint[0], tint[1], tint[2]);
      });
    },
    // A quad a, b, c, d in order round its rim, all four sides true edges.
    quad(a, b, c, d, normal, tint) {
      this.triangle(a, b, c, normal, tint, [true, true, false]);
      this.triangle(a, c, d, normal, tint, [false, true, true]);
    },
    build() {
      return {
        positions: new Float32Array(positions),
        normals: new Float32Array(normals),
        edges: new Float32Array(edges),
        tints: new Float32Array(tints),
        vertexCount: positions.length / 3
      };
    }
  };
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const normalize = (a) => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };

// A regular icosahedron, the d20, its vertices on the unit sphere.
export function createD20Geometry() {
  const phi = (1 + Math.sqrt(5)) / 2;
  const raw = [
    [-1, phi, 0], [1, phi, 0], [-1, -phi, 0], [1, -phi, 0],
    [0, -1, phi], [0, 1, phi], [0, -1, -phi], [0, 1, -phi],
    [phi, 0, -1], [phi, 0, 1], [-phi, 0, -1], [-phi, 0, 1]
  ];
  const v = raw.map(normalize);
  const edge = Math.hypot(...sub(v[0], v[1]));
  const near = (i, j) => Math.abs(Math.hypot(...sub(v[i], v[j])) - edge) < 1e-6;
  const mesh = createMesh();
  const white = [1, 1, 1];
  for (let i = 0; i < 12; i++) {
    for (let j = i + 1; j < 12; j++) {
      for (let k = j + 1; k < 12; k++) {
        if (!near(i, j) || !near(j, k) || !near(i, k)) continue;
        let [a, b, c] = [v[i], v[j], v[k]];
        let n = normalize(cross(sub(b, a), sub(c, a)));
        if (dot(n, a) < 0) { [b, c] = [c, b]; n = n.map((x) => -x); }
        mesh.triangle(a, b, c, n, white);
      }
    }
  }
  return mesh.build();
}

// Splits a simple polygon, counter-clockwise, into triangles by clipping its ears. Returns index triples.
function triangulate(poly) {
  const turn = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const inside = (p, a, b, c) => turn(a, b, p) >= 0 && turn(b, c, p) >= 0 && turn(c, a, p) >= 0;
  const left = poly.map((_, i) => i);
  const triangles = [];
  while (left.length > 3) {
    const before = left.length;
    for (let i = 0; i < left.length; i++) {
      const i0 = left[(i + left.length - 1) % left.length];
      const i1 = left[i];
      const i2 = left[(i + 1) % left.length];
      const [a, b, c] = [poly[i0], poly[i1], poly[i2]];
      if (turn(a, b, c) <= 1e-9) continue;
      if (left.some((j) => j !== i0 && j !== i1 && j !== i2 && inside(poly[j], a, b, c))) continue;
      triangles.push([i0, i1, i2]);
      left.splice(i, 1);
      break;
    }
    if (left.length === before) break;
  }
  if (left.length === 3) triangles.push(left.slice());
  return triangles;
}

// The polygon moved inward by d, each corner along its mitre.
function inset(poly, d) {
  const n = poly.length;
  return poly.map((p, i) => {
    const prev = poly[(i + n - 1) % n];
    const next = poly[(i + 1) % n];
    const inward = (a, b) => { const l = Math.hypot(b[0] - a[0], b[1] - a[1]); return [-(b[1] - a[1]) / l, (b[0] - a[0]) / l]; };
    const n1 = inward(prev, p);
    const n2 = inward(p, next);
    const m = [n1[0] + n2[0], n1[1] + n2[1]];
    const ml = Math.hypot(m[0], m[1]);
    const s = d / ((m[0] / ml) * n1[0] + (m[1] / ml) * n1[1]);
    return [p[0] + (m[0] / ml) * s, p[1] + (m[1] / ml) * s];
  });
}

// The Talos mark, a Corinthian helmet seen from the front, in the logo's own pixels (talos-icon.png,
// 1024 square, y down): two cheek bars cut by the eye slit, two brow bars cut through by it, the nose
// guard, and the chin below the mouth's opening. Left side only, the right is its mirror about x 512.
const TALOS_CENTRE = [512, 509];
const TALOS_UNIT = 347;  // logo pixels per model unit, so the mark stands 2 units tall
const TALOS_LEFT = [
  { tint: 'cheek', poly: [[192, 280], [302, 226], [302, 397], [244, 397], [244, 524], [302, 524], [302, 693], [192, 620]] },
  { tint: 'brow', poly: [[309, 205], [415, 163], [415, 397], [309, 397]] },
  { tint: 'brow', poly: [[309, 524], [415, 524], [415, 801], [309, 715]] }
];
const TALOS_MIDDLE = [
  { tint: 'nose', poly: [[480, 162], [544, 162], [544, 530], [480, 530]] },
  { tint: 'nose', poly: [[480, 772], [544, 772], [544, 840], [528, 856], [496, 856], [480, 840]] }
];
// The logo's three bronzes, relative to the moon's colour: dark cheeks, mid brows, a light nose guard.
const TALOS_TINTS = { cheek: [0.85, 0.74, 0.63], brow: [1, 1, 1], nose: [1.11, 1.12, 1.12] };
const TALOS_DEPTH = 0.16;    // half the plate's thickness, in model units
const TALOS_BEVEL = 0.035;   // the chamfer round each bar's face
const TALOS_CURVE = 0.35;    // radians each bar turns outward per model unit off the centre, so the bars wrap like a helmet
const TALOS_RECESS = 0.2;   // how far the outer bars sit back, per model unit squared off the centre

export function createTalosGeometry() {
  const mesh = createMesh();
  const toModel = ([x, y]) => [(x - TALOS_CENTRE[0]) / TALOS_UNIT, -(y - TALOS_CENTRE[1]) / TALOS_UNIT];
  const pieces = [...TALOS_LEFT, ...TALOS_MIDDLE];
  for (const piece of TALOS_LEFT) {
    pieces.push({ tint: piece.tint, poly: piece.poly.map(([x, y]) => [2 * TALOS_CENTRE[0] - x, y]) });
  }
  for (const piece of pieces) {
    // Wound counter-clockwise, whichever way the logo's pixels list it.
    let outer = piece.poly.map(toModel);
    const area = outer.reduce((s, p, i) => { const q = outer[(i + 1) % outer.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0);
    if (area < 0) outer = outer.reverse();
    const face = inset(outer, TALOS_BEVEL);
    const tint = TALOS_TINTS[piece.tint];
    const cx = outer.reduce((s, p) => s + p[0], 0) / outer.length;
    const angle = TALOS_CURVE * cx;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const place = ([x, y, z]) => {
      const dx = x - cx;
      return [cx + dx * c + z * s, y, -dx * s + z * c - TALOS_RECESS * cx * cx];
    };
    const turn = ([x, y, z]) => [x * c + z * s, y, -x * s + z * c];
    const tri = (a, b, d, n, sides) => mesh.triangle(place(a), place(b), place(d), turn(n), tint, sides);
    const quad = (a, b, d, e, n) => mesh.quad(place(a), place(b), place(d), place(e), turn(n), tint);
    const n = outer.length;
    const isRim = (i, j) => (j - i + n) % n === 1 || (i - j + n) % n === 1;
    for (const [i, j, k] of triangulate(face)) {
      tri([...face[i], TALOS_DEPTH], [...face[j], TALOS_DEPTH], [...face[k], TALOS_DEPTH], [0, 0, 1],
        [isRim(i, j), isRim(j, k), isRim(k, i)]);
    }
    for (const [i, j, k] of triangulate(outer)) {
      tri([...outer[i], -TALOS_DEPTH], [...outer[k], -TALOS_DEPTH], [...outer[j], -TALOS_DEPTH], [0, 0, -1],
        [isRim(i, k), isRim(k, j), isRim(j, i)]);
    }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ex = outer[j][0] - outer[i][0];
      const ey = outer[j][1] - outer[i][1];
      const l = Math.hypot(ex, ey);
      const out = [ey / l, -ex / l, 0];
      const front = TALOS_DEPTH - TALOS_BEVEL;
      quad([...outer[i], front], [...outer[j], front], [...face[j], TALOS_DEPTH], [...face[i], TALOS_DEPTH],
        normalize([out[0], out[1], 1]));
      quad([...outer[i], -TALOS_DEPTH], [...outer[j], -TALOS_DEPTH], [...outer[j], front], [...outer[i], front], out);
    }
  }
  return mesh.build();
}
