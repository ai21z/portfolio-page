#!/usr/bin/env python3
"""
Generate the blog Petri-dish network as a *Physarum polycephalum* reticulum.

Engine: Voronoi edge graph (natively degree-3 = real Y-junctions) + Tero flux-reinforcement
solve (mu=1.0, radial_rim driving), validated in the prototype. Locked look = variant "9b"
dense radial full-bloom (see docs/local/physarum-network-spec.md).

Output: artifacts/blog_network.json in VIEW space (1920x1080), with
  - paths        : list of polylines, each point is [x, y, w]  (w = vein diameter in VIEW px)
  - paths_meta   : [{hub, kind}]  hub = the category whose flux the edge most carries (flux-tag,
                   used by the renderer to light the right veins on hover); kind in
                   vein|trunk|fan
  - masses       : [{x, y, r, kind}]  plasmodial mass blobs at the 5 anchors
  - hubs, labels : unchanged contract (5 canonical anchors)
The renderer (js/blog-network-webgl.js) applies userZoom + petriClip, so the mesh is grown a
little past the dish and trimmed at the glass. No PNGs (the old blog_bg_*.png were dead).

Deps (build-time only): numpy scipy networkx.
"""
import argparse, json, math, time
from pathlib import Path
import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.linalg import spsolve
from scipy.spatial import Voronoi
import networkx as nx

VIEW_W, VIEW_H = 1920, 1080
CX, CY = 960.0, 540.0
R_DISH = 600.0                      # mesh radius in VIEW px; renderer trims at the real glass
HUBS = {"source": (960.0, 540.0), "craft": (960.0, 180.0), "cosmos": (1460.0, 540.0),
        "codex": (960.0, 900.0), "convergence": (460.0, 540.0)}
FOODS = ["craft", "cosmos", "codex", "convergence"]
MU = 1.0
W_MIN, W_MAX = 1.6, 16.0            # vein diameter range in VIEW px (~10x hierarchy)

# --------------------------------------------------------------------------- graph
def density_field(rng):
    yy, xx = np.mgrid[0:VIEW_H, 0:VIEW_W]
    rr = np.sqrt((xx - CX) ** 2 + (yy - CY) ** 2) / R_DISH
    dish = rr <= 1.0
    f = np.full((VIEW_H, VIEW_W), 0.8)                      # near-uniform: full bloom
    for k in HUBS:
        ax_, ay_ = HUBS[k]
        f += 0.35 * np.exp(-((xx - ax_) ** 2 + (yy - ay_) ** 2) / (2 * 288.0 ** 2))
    f *= np.clip(1.18 - 0.38 * rr, 0.45, 1.0)               # mild frontier coarsening
    f[~dish] = 0.0
    return f

def build_graph(rng, seeds_n):
    field = density_field(rng)
    p = field.flatten(); p = p / p.sum()
    pick = rng.choice(VIEW_W * VIEW_H, size=seeds_n, p=p)
    sy, sx = np.unravel_index(pick, (VIEW_H, VIEW_W))
    sx = sx + rng.uniform(-4, 4, seeds_n); sy = sy + rng.uniform(-4, 4, seeds_n)
    for k in HUBS:
        ax_, ay_ = HUBS[k]; sx = np.append(sx, ax_); sy = np.append(sy, ay_)
    seeds = np.column_stack([sx, sy])
    seeds = seeds[(seeds[:, 0] - CX) ** 2 + (seeds[:, 1] - CY) ** 2 <= (R_DISH - 12) ** 2]
    vor = Voronoi(seeds)
    V = vor.vertices
    inside = lambda q: (q[0] - CX) ** 2 + (q[1] - CY) ** 2 <= (R_DISH - 8) ** 2
    G = nx.Graph()
    for (a, b) in vor.ridge_vertices:
        if a < 0 or b < 0:
            continue
        pa, pb = V[a], V[b]
        if not (inside(pa) and inside(pb)):
            continue
        la = math.hypot(pa[0] - pb[0], pa[1] - pb[1])
        if la < 1e-6 or la > 150.0:
            continue
        G.add_node(a, pos=(float(pa[0]), float(pa[1])))
        G.add_node(b, pos=(float(pb[0]), float(pb[1])))
        G.add_edge(a, b, length=la)
    return G

# --------------------------------------------------------------------------- flux
def flux_solve(G, rng, iters):
    G = G.subgraph(max(nx.connected_components(G), key=len)).copy()
    nodes = list(G.nodes); idx = {n: i for i, n in enumerate(nodes)}; N = len(nodes)
    pos = {n: G.nodes[n]["pos"] for n in nodes}
    px = np.array([pos[n][0] for n in nodes]); py = np.array([pos[n][1] for n in nodes])
    def snap(tx, ty):
        return int(np.argmin((px - tx) ** 2 + (py - ty) ** 2))
    term = {k: snap(*HUBS[k]) for k in HUBS}
    src = term["source"]; food_idx = [term[k] for k in FOODS]
    rim = [snap(CX + (R_DISH - 20) * math.cos(j / 10 * 2 * math.pi),
               CY + (R_DISH - 20) * math.sin(j / 10 * 2 * math.pi)) for j in range(10)]
    edges = list(G.edges())
    ei = np.array([idx[u] for u, v in edges]); ej = np.array([idx[v] for u, v in edges])
    L = np.array([max(G[u][v]["length"], 1.0) for u, v in edges])
    D = 1.0 + rng.uniform(-0.05, 0.05, len(edges))
    rows = np.concatenate([ei, ej, ei, ej]); cols = np.concatenate([ei, ej, ej, ei])
    sinks = food_idx + rim
    def solve(s, t, C):
        A = coo_matrix((np.concatenate([C, C, -C, -C]), (rows, cols)), shape=(N, N)).tocsr()
        b = np.zeros(N); b[s] = 1.0; b[t] = -1.0
        keep = np.r_[0:t, t + 1:N]
        p = np.zeros(N); p[keep] = spsolve(A[keep][:, keep], b[keep])
        return C * (p[ei] - p[ej])
    for it in range(iters):
        s, t = src, int(rng.choice(sinks))
        if s == t:
            continue
        Q = solve(s, t, D / L)
        D = np.clip(D + 0.15 * (np.abs(Q) ** MU - D), 1e-6, 1e6)
    C = D / L                                                # flux-tag: per-food flow at steady state
    Qf = np.stack([np.abs(solve(src, t, C)) for t in food_idx])
    tag = np.argmax(Qf, axis=0)
    return nodes, pos, edges, D ** 0.25, tag, term

# --------------------------------------------------------------------------- fans
def grow_tip(x0, y0, a0, reach, rng):
    path = [(x0, y0)]; x, y, a = x0, y0, a0
    for _ in range(max(2, int(reach / 8))):
        a += rng.uniform(-0.22, 0.22); x += 8 * math.cos(a); y += 8 * math.sin(a)
        if (x - CX) ** 2 + (y - CY) ** 2 > (R_DISH - 2) ** 2:
            break
        path.append((x, y))
    return path

def make_fans(nodes, pos, edges, r, rng):
    rmax = r.max(); node_r = {}
    for e, (u, v) in enumerate(edges):
        node_r[u] = max(node_r.get(u, 0), r[e]); node_r[v] = max(node_r.get(v, 0), r[e])
    bins = 28; best = {}
    for n, nr in node_r.items():
        if nr < 0.08 * rmax:
            continue
        x, y = pos[n]; ang = math.atan2(y - CY, x - CX); dc = math.hypot(x - CX, y - CY)
        if dc < 0.64 * R_DISH:
            continue
        b = int((ang % (2 * math.pi)) / (2 * math.pi / bins))
        if dc > best.get(b, (0, None))[0]:
            best[b] = (dc, n)
    paths, metas = [], []
    for dc, n in best.values():
        x, y = pos[n]; base = math.atan2(y - CY, x - CX); reach = (R_DISH - 2) - dc
        if reach < 24:
            continue
        hub = min(FOODS, key=lambda k: (HUBS[k][0] - x) ** 2 + (HUBS[k][1] - y) ** 2)
        nt = 11
        for i in range(nt):
            a = base + (i / (nt - 1) - 0.5) * 1.2 + rng.uniform(-0.07, 0.07)
            tip = grow_tip(x, y, a, reach * rng.uniform(0.6, 1.05), rng)
            if len(tip) < 2:
                continue
            P = []
            for j, (tx, ty) in enumerate(tip):
                t = j / (len(tip) - 1)
                P.append([round(tx, 1), round(ty, 1), round(2.6 * (1 - t) + 0.6, 2)])
            paths.append(P); metas.append({"hub": hub, "kind": "fan"})
    return paths, metas

# --------------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=1008)        # 9b reference network
    ap.add_argument("--seeds", type=int, default=1300)
    ap.add_argument("--iters", type=int, default=700)
    args = ap.parse_args()
    rng = np.random.default_rng(args.seed)
    t0 = time.time()

    G = build_graph(rng, args.seeds)
    nodes, pos, edges, r, tag, term = flux_solve(G, rng, args.iters)
    rmax = r.max()
    wpx = lambda rn: W_MIN + (W_MAX - W_MIN) * (rn / rmax) ** 0.85

    paths, metas = [], []
    for e, (u, v) in enumerate(edges):
        w = round(wpx(r[e]), 2)
        (x0, y0), (x1, y1) = pos[u], pos[v]
        paths.append([[round(x0, 1), round(y0, 1), w], [round(x1, 1), round(y1, 1), w]])
        metas.append({"hub": FOODS[tag[e]], "kind": "trunk" if w > 0.5 * W_MAX else "vein"})

    fpaths, fmetas = make_fans(nodes, pos, edges, r, rng)
    paths += fpaths; metas += fmetas

    masses = [{"x": HUBS[k][0], "y": HUBS[k][1], "r": (82.0 if k == "source" else 56.0),
               "kind": "source" if k == "source" else "food"} for k in HUBS]

    data = {
        "width": VIEW_W, "height": VIEW_H, "seed": args.seed,
        "hubs": [{"id": k, "x": HUBS[k][0], "y": HUBS[k][1], "label": k.upper()} for k in HUBS],
        "nodes": [], "paths": paths, "paths_meta": metas, "masses": masses,
        "labels": [{"id": k, "label": k.upper()} for k in HUBS],
    }
    out = Path("artifacts") / "blog_network.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data))
    size_kb = out.stat().st_size / 1024

    # ---- diagnostics ----
    import collections
    FG = nx.Graph()
    for e, (u, v) in enumerate(edges):
        FG.add_edge(u, v, length=G[u][v]["length"] if G.has_edge(u, v) else 1.0, r=r[e])
    loops = FG.number_of_edges() - FG.number_of_nodes() + nx.number_connected_components(FG)
    deg = collections.Counter(d for _, d in FG.degree())
    tot = sum(deg.values()) or 1
    print(f"seed={args.seed} seeds={args.seeds}")
    print(f"vein edges={len(edges)}  fan paths={len(fpaths)}  total paths={len(paths)}")
    print(f"degree-3 share={100*deg.get(3,0)/tot:.0f}%  loops={loops}")
    print(f"width(px) min={W_MIN} max={W_MAX} ratio={W_MAX/W_MIN:.1f}x")
    print(f"flux-tag counts={ {FOODS[i]: int((tag==i).sum()) for i in range(4)} }")
    print(f"JSON {out} ({size_kb:.0f} KB)  in {time.time()-t0:.1f}s")

if __name__ == "__main__":
    main()
