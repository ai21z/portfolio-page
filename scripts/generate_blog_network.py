#!/usr/bin/env python3
"""
Generate blog network (pure Python + Pillow).
- SOURCE -> 4 hubs via bundled trunks (no petal loops).
- Per-hub space-colonization with spatial grid (fast).
- Isotropic radial attractors (two-ring + center-overlap annulus).
- Center anastomosis (fusion) where hubs meet near SOURCE.
- Equal-distance resampling at 22 px.
- Base + glow PNGs, JSON export for frontend overlay.

No external deps beyond Pillow.
"""

import argparse, json, math, random, time
from pathlib import Path
from collections import defaultdict, Counter
from PIL import Image, ImageDraw, ImageFilter

# ---------------- Canvas / Hubs ----------------
WIDTH, HEIGHT = 1920, 1080

HUBS = {
    "source": (WIDTH // 2, HEIGHT // 2),
    "craft":  (960, 180),
    "cosmos": (1460, 540),
    "codex":  (960, 900),
    "convergence": (460, 540),
}

# ---------------- Parameters ----------------
SAMPLE_STEP_PX = 18.0
NUM_ATTRACTORS_PER_HUB = 1400     # denser canopy while keeping runtime sane
INFLUENCE_RADIUS = 140.0
KILL_RADIUS       = 40.0
STEP_SIZE         = 10.0
MAX_TIPS_PER_HUB  = 1100
MAX_OUTER_ROUNDS  = 2000          # round-robin cycles cap
FUSE_RADIUS       = 14.0
CENTER_FUSE_FRAC  = 0.60          # fraction of min(hub->SOURCE)

NUM_TRUNKS_PER_HUB = 6
TRUNK_BOW_RANGE = (0.06, 0.10)    # reduced bow (no petals)

# WARM HAND-DRAWN PALETTE (exact match to intro network)
ABYSS    = (25, 28, 30)      # Slightly lighter for visibility
NECROTIC = (122, 174, 138)   # Necrotic green (thin branches)
SPECTRAL = (143, 180, 255)   # Spectral blue (medium branches)  
EMBER    = (194, 74, 46)     # Ember orange (thick trunks)

HUB_COLORS = {
    "source": (200, 200, 200),
    "craft":  (100, 200, 220),
    "cosmos": (180, 120, 200),
    "codex":  (220, 210, 180),
    "convergence": (220, 180, 100),
}

# ---------------- Utility ----------------
def distance2(x1, y1, x2, y2):
    dx = x2 - x1; dy = y2 - y1
    return dx*dx + dy*dy

def normalize(dx, dy):
    m2 = dx*dx + dy*dy
    if m2 <= 1e-12: return 0.0, 0.0
    inv = 1.0 / math.sqrt(m2)
    return dx*inv, dy*inv

class Node:
    __slots__ = ("x","y","parent","hub","children")
    def __init__(self, x, y, parent, hub):
        self.x = float(x); self.y = float(y)
        self.parent = parent; self.hub = hub
        self.children = []
        if parent: parent.children.append(self)

# -------------- Attractor sampling (radial) --------------
def _stratified_thetas(n, bins=24):
    if n <= 0: return []
    per = [n // bins] * bins
    for i in range(n % bins): per[i] += 1
    arr = []
    for b, k in enumerate(per):
        for _ in range(k):
            arr.append(((b + random.random()) / bins) * 2.0 * math.pi)
    random.shuffle(arr)
    return arr

def _sample_annulus(rmin, rmax):
    rmin2, rmax2 = rmin*rmin, rmax*rmax
    return math.sqrt(random.random() * (rmax2 - rmin2) + rmin2)

def generate_attractors_per_hub(hubs, num_per_hub, inner_frac=0.50, center_frac=0.20, theta_bins=24):
    src = hubs["source"]
    outer = {k:v for k,v in hubs.items() if k != "source"}
    out = {k: [] for k in outer}
    diag = math.hypot(WIDTH, HEIGHT)
    min_src = min(math.hypot(v[0]-src[0], v[1]-src[1]) for v in outer.values())
    R_source_min = 0.25 * min_src
    R_source_max = 0.55 * min_src
    for hid, (hx,hy) in outer.items():
        dist_src = math.hypot(hx-src[0], hy-src[1])
        R_center = 0.85 * dist_src
        R_outer  = 0.85 * diag
        N_center = max(0, int(center_frac * num_per_hub))
        N_inner  = max(0, int(inner_frac  * num_per_hub) - N_center)
        N_outer  = max(0, num_per_hub - (N_inner + N_center))

        for th in _stratified_thetas(N_inner, theta_bins):
            r = _sample_annulus(24.0, R_center)
            x = hx + math.cos(th)*r; y = hy + math.sin(th)*r
            if -WIDTH*0.5 <= x <= WIDTH*1.5 and -HEIGHT*0.5 <= y <= HEIGHT*1.5:
                out[hid].append((x,y))

        for th in _stratified_thetas(N_outer, theta_bins):
            r = _sample_annulus(R_center, R_outer)
            x = hx + math.cos(th)*r; y = hy + math.sin(th)*r
            if -WIDTH*0.5 <= x <= WIDTH*1.5 and -HEIGHT*0.5 <= y <= HEIGHT*1.5:
                out[hid].append((x,y))

        for th in _stratified_thetas(N_center, theta_bins):
            r = _sample_annulus(R_source_min, R_source_max)
            x = src[0] + math.cos(th)*r; y = src[1] + math.sin(th)*r
            out[hid].append((x,y))
    return out

def compute_trunk_fan_angles(src, dst, num, span_deg=150.0):
    """Evenly distribute trunk tangents around the outward direction."""
    if num <= 0:
        return []
    sx, sy = src
    tx, ty = dst
    base = math.atan2(ty - sy, tx - sx)  # direction from source -> hub (outward)
    if num == 1:
        return [base]
    span = math.radians(span_deg)
    return [base + span * (i/(num-1) - 0.5) for i in range(num)]

# -------------- Trunks --------------
def _mono_ok(p0, p1, p2, p3, dirx, diry):
    def proj(p): return (p[0]-p0[0])*dirx + (p[1]-p0[1])*diry
    a, b, c, d = 0.0, proj(p1), proj(p2), proj(p3)
    return a < b <= c < d

def create_trunk_paths(src, dst, num, bow_lo, bow_hi, sample=SAMPLE_STEP_PX, bow_sign=None, fan_angles=None):
    sx, sy = src; tx, ty = dst
    dx, dy = tx-sx, ty-sy
    dist = math.hypot(dx, dy) or 1.0
    dirx, diry = dx/dist, dy/dist
    perpx, perpy = -diry, dirx
    base_angle = math.atan2(dy, dx)
    trunks = []
    if bow_sign is None:
        bow_sign = 1 if random.random() < 0.5 else -1
    # ensure we have a deterministic set of fan angles if provided
    if fan_angles and len(fan_angles) != num:
        raise ValueError("fan_angles length must match num trunks")

    for idx in range(num):
        angle = None
        if fan_angles:
            angle = fan_angles[idx]
        out_dir = None
        if angle is not None:
            out_dir = (math.cos(angle), math.sin(angle))
        else:
            out_dir = (dirx, diry)
        out_perp = (-out_dir[1], out_dir[0])
        jitter_mag = 4.0 if fan_angles else 8.0
        s_jx = random.uniform(-jitter_mag, jitter_mag); s_jy = random.uniform(-jitter_mag, jitter_mag)
        t_jx = random.uniform(-jitter_mag, jitter_mag); t_jy = random.uniform(-jitter_mag, jitter_mag)
        p0 = (sx + s_jx, sy + s_jy)
        p3 = (tx + t_jx, ty + t_jy)
        # try a few times to ensure monotone projection
        for _tries in range(6):
            if fan_angles:
                offset = angle - base_angle
                bow_sign_local = 1 if offset >= 0 else -1
            else:
                bow_sign_local = bow_sign
            bow = dist * random.uniform(bow_lo, bow_hi) * bow_sign_local
            # soften bow contribution near source, preserve old feel
            p1 = (
                sx + dx*0.33 + perpx*bow*0.4 + out_perp[0]*bow*0.4,
                sy + dy*0.33 + perpy*bow*0.4 + out_perp[1]*bow*0.4,
            )
            taper = dist * random.uniform(0.22, 0.32)
            jitter = dist * random.uniform(-0.02, 0.02)
            p2 = (
                (tx + t_jx) - out_dir[0]*taper + out_perp[0]*jitter,
                (ty + t_jy) - out_dir[1]*taper + out_perp[1]*jitter,
            )
            if _mono_ok(p0, p1, p2, p3, dirx, diry): break
        # sample the cubic
        length_guess = dist*1.15
        steps = max(2, int(length_guess / sample))
        seg = []
        for i in range(steps):
            t = i/(steps-1) if steps>1 else 0.0
            mt = 1.0 - t
            x = (mt*mt*mt)*p0[0] + 3*(mt*mt)*t*p1[0] + 3*mt*(t*t)*p2[0] + (t*t*t)*p3[0]
            y = (mt*mt*mt)*p0[1] + 3*(mt*mt)*t*p1[1] + 3*mt*(t*t)*p2[1] + (t*t*t)*p3[1]
            seg.append((round(x), round(y)))
        trunks.append(seg)
    return trunks

# -------------- Spatial grid for tips --------------
class TipGrid:
    def __init__(self, cell):
        self.cell = float(cell)
        self.B = defaultdict(list)
    def _c(self, x, y):
        return (int(x // self.cell), int(y // self.cell))  # floor works for negatives
    def rebuild(self, tips):
        self.B.clear()
        for i, t in enumerate(tips):
            self.B[self._c(t.x, t.y)].append(i)
    def nearby(self, x, y):
        cx, cy = self._c(x, y)
        for dx in (-1,0,1):
            for dy in (-1,0,1):
                yield from self.B.get((cx+dx, cy+dy), ())

# -------------- Center fusion index --------------
class CenterIndex:
    def __init__(self, fuse_radius=FUSE_RADIUS, cell_size=FUSE_RADIUS):
        self.cell = max(8, int(cell_size))
        self.r2 = float(fuse_radius)*float(fuse_radius)
        self.grid = {}
    def _c(self, x, y): return (int(x // self.cell), int(y // self.cell))
    def clear(self): self.grid.clear()
    def add(self, x, y, hub_id, node_obj):
        c = self._c(x,y)
        self.grid.setdefault(c, []).append((x,y,hub_id,node_obj))
    def build_from_nodes(self, nodes_by_hub, center_xy, center_r):
        self.clear()
        cx, cy = center_xy
        r2 = center_r*center_r
        for hub_id, nodes in nodes_by_hub.items():
            for n in nodes:
                if distance2(n.x,n.y,cx,cy) <= r2:
                    self.add(n.x,n.y,hub_id,n)
    def find_other(self, x, y, my_hub):
        cx, cy = self._c(x,y)
        for dx in (-1,0,1):
            for dy in (-1,0,1):
                for px,py,hid,obj in self.grid.get((cx+dx,cy+dy),()):
                    if hid == my_hub: continue
                    if distance2(px,py,x,y) <= self.r2:
                        return obj
        return None

# -------------- Equal-distance resampling --------------
def resample_equal(points, step=SAMPLE_STEP_PX):
    if len(points) < 2: return points
    out = [points[0]]
    px, py = points[0]
    acc = 0.0
    for i in range(1, len(points)):
        qx, qy = points[i]
        dx, dy = qx-px, qy-py
        seg = math.hypot(dx, dy)
        if seg <= 1e-9:
            px, py = qx, qy
            continue
        nx, ny = dx/seg, dy/seg
        while acc + seg >= step:
            d = step - acc
            x = px + nx*d; y = py + ny*d
            out.append((x,y))
            px, py = x, y
            seg -= d; acc = 0.0
        acc += seg
        px, py = qx, qy
    if out[-1] != points[-1]:
        out.append(points[-1])
    return out

def count_segments(paths):
    return sum(max(0, len(p)-1) for p in paths)

# -------------- Path extraction --------------
def extract_paths(nodes_by_hub, min_pts=3):
    paths, metas = [], []
    for hid, nodes in nodes_by_hub.items():
        roots = [n for n in nodes if n.parent is None]
        if not roots: continue
        for root in roots:
            stack = [(root, [], 0, 0)]  # node, accumulated path, depth, tier
            while stack:
                node, cur, depth, tier = stack.pop()
                cur = cur + [(node.x, node.y)]
                if not node.children:
                    if len(cur) >= min_pts:
                        paths.append(cur)
                        metas.append({"hub":hid,"kind":"branch","tier":tier})
                elif len(node.children)==1:
                    stack.append((node.children[0], cur, depth+1, tier))
                else:
                    if len(cur) >= min_pts:
                        paths.append(cur)
                        metas.append({"hub":hid,"kind":"hub-branch","tier":tier})
                    for ch in node.children:
                        stack.append((ch, [cur[-1]], depth+1, tier+1))
    return paths, metas

# -------------- Rendering --------------
def render_pngs(paths, metas, hubs, out_base, out_glow):
    def render(is_glow=False):
        W2, H2 = WIDTH*2, HEIGHT*2
        img = Image.new("RGB", (W2,H2), ABYSS)
        draw = ImageDraw.Draw(img, "RGBA")
        for i, path in enumerate(paths):
            if len(path)<2: continue
            meta = metas[i] if i<len(metas) else {}
            hid = meta.get("hub","craft")
            is_trunk = meta.get("kind") == "trunk"
            tier = meta.get("tier")
            hx, hy = HUBS[hid]
            first = path[0]
            depth = min(8, int(math.hypot(first[0]-hx, first[1]-hy)/80))
            L = len(path)
            base_wave_phase = random.uniform(0.0, math.tau)
            base_wave_freq = random.uniform(5.5, 10.5)
            for j in range(L-1):
                # MINIMAL GAPS: Very subtle, only in thinnest branches (3-8%)
                gap_chance = 0.03 + (depth * 0.01)  # Much less gaps
                if random.random() < gap_chance:
                    continue  # Skip this segment = rare gap
                
                x1,y1 = path[j]; x2,y2 = path[j+1]
                X1,Y1 = int(x1*2), int(y1*2); X2,Y2 = int(x2*2), int(y2*2)
                t = j/max(1,L-1)
                
                # Progress along this path (0.0 = start, 1.0 = end)
                progress = t
                
                # THINNER BRANCHES: Proper parent→child hierarchy
                # Base width decreases with distance from hub (depth)
                # Each child branch thinner than parent
                base_w = max(2, 12 - depth*2.5) * 2  # Thinner than intro (12 vs 15)
                if is_trunk:
                    base_w *= 1.2  # Trunks only slightly thicker
                else:
                    if isinstance(tier, int) and tier <= 1:
                        base_w += 2.0  # Slight boost for parent + first child branches
                    base_w *= 1.2  # global 20% boost for branches
                heavy = min(1.0, max(0.0, (base_w - 6.0) / 10.0))
                und_amp = (0.16 + max(0.0, base_w - 6.0) * 0.015) * heavy
                jitter_amp = (0.14 + random.uniform(0.0, 0.08)) * heavy
                
                # Stronger taper along length for aged, wrinkled look
                undulation = 1.0 + und_amp * math.sin(progress * base_wave_freq + base_wave_phase)
                micro = 1.0 + random.uniform(-jitter_amp, jitter_amp)
                w = max(1.5, base_w*(1.0 - 0.6*progress) * undulation * micro)  # Stronger taper (0.6 vs 0.5)
                
                # MORE HAND-PAINTED WRINKLES: Stronger random variation
                # Creates organic, imperfect mycelium texture
                wrinkle = random.uniform(0.7, 1.3)  # ±30% width variation (more wrinkly!)
                w = w * wrinkle
                
                # WIDTH-BASED COLOR: More visible multi-color palette
                width_ratio = w / (base_w * 2)  # 0.0 = thin, 1.0 = thick
                
                if is_glow:
                    # Brighter spectral glow
                    w = w + 3
                    col = SPECTRAL + (220,)
                    draw.line([(X1,Y1),(X2,Y2)], fill=col, width=int(w), joint='curve')
                else:
                    # VIBRANT MULTI-COLOR PALETTE for hand-drawn look
                    if width_ratio > 0.60:  # INCREASED from 0.65 - more orange
                        # THICKEST parts: Pure EMBER orange (hot, vibrant)
                        r = min(255, int(EMBER[0] * 1.5))  # Bright orange-red
                        g = min(255, int(EMBER[1] * 1.3))
                        b = min(255, int(EMBER[2] * 1.2))
                        col = (r, g, b, 255)
                    elif width_ratio > 0.45:  # Adjusted from 0.5 - expanded blue zone
                        # THICK-MEDIUM: SPECTRAL blue (cool, vibrant)
                        r = min(255, int(SPECTRAL[0] * 1.4))  # Bright blue
                        g = min(255, int(SPECTRAL[1] * 1.4))
                        b = min(255, int(SPECTRAL[2] * 1.5))
                        col = (r, g, b, 255)
                    elif width_ratio > 0.38:  # DECREASED from 0.35 - less purple
                        # MEDIUM: Purple blend (SPECTRAL + EMBER mixed)
                        r = min(255, int((SPECTRAL[0] + EMBER[0]) * 0.8))
                        g = min(255, int((SPECTRAL[1] + EMBER[1]) * 0.7))
                        b = min(255, int((SPECTRAL[2] + EMBER[2]) * 0.8))
                        col = (r, g, b, 255)
                    elif width_ratio > 0.2:
                        # MEDIUM-THIN: Transition to necrotic green
                        blend = (width_ratio - 0.2) / 0.15
                        r = int(SPECTRAL[0] * blend + NECROTIC[0] * (1-blend) * 1.3)
                        g = int(SPECTRAL[1] * blend + NECROTIC[1] * (1-blend) * 1.3)
                        b = int(SPECTRAL[2] * blend + NECROTIC[2] * (1-blend) * 1.3)
                        col = (r, g, b, 255)
                    else:
                        # THINNEST parts: Pure ominous necrotic green
                        r = min(255, int(NECROTIC[0] * 1.5))
                        g = min(255, int(NECROTIC[1] * 1.5))
                        b = min(255, int(NECROTIC[2] * 1.5))
                        col = (r, g, b, 255)
                    
                    # 3D DEPTH EFFECT: Add subtle shadow/highlight for dimensionality
                    # Random lighting variation creates hand-painted depth
                    lighting = random.uniform(0.85, 1.15)  # ±15% brightness variation
                    r = min(255, max(0, int(col[0] * lighting)))
                    g = min(255, max(0, int(col[1] * lighting)))
                    b = min(255, max(0, int(col[2] * lighting)))
                    col_3d = (r, g, b, 255)
                    
                    # Draw segment with hand-drawn pencil style (with gaps + curve joints)
                    draw.line([(X1,Y1),(X2,Y2)], fill=col_3d, width=int(w), joint='curve')
        # hub markers
        for hid,(hx,hy) in hubs.items():
            HX, HY = hx*2, hy*2
            c = HUB_COLORS[hid]
            if is_glow:
                for k in range(3,0,-1):
                    r = (12 + k*6) * 2
                    a = 40 + (3-k)*30
                    draw.ellipse([HX-r,HY-r,HX+r,HY+r], fill=c+(a,))
            else:
                r = 10*2
                draw.ellipse([HX-r,HY-r,HX+r,HY+r], outline=c, width=4)
                r2 = 4*2
                draw.ellipse([HX-r2,HY-r2,HX+r2,HY+r2], fill=c)
        return img.resize((WIDTH,HEIGHT), Image.LANCZOS)

    base = render(False); base.save(out_base)
    glow2x = render(True).filter(ImageFilter.GaussianBlur(radius=12))
    glow = glow2x.resize((WIDTH,HEIGHT), Image.LANCZOS); glow.save(out_glow)

# -------------- Main growth (round-robin) --------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=7171)
    ap.add_argument("--segments", type=int, default=7600)
    args = ap.parse_args()
    random.seed(args.seed)
    MAX_SEGMENTS = int(args.segments)

    t0 = time.time()
    # trunks
    trunks, trunk_meta = [], []
    bow_sign_per_hub = {}
    for hid,(hx,hy) in HUBS.items():
        if hid=="source": continue
        bow_sign_per_hub[hid] = 1 if random.random()<0.5 else -1
        fan = compute_trunk_fan_angles(HUBS["source"], (hx,hy), NUM_TRUNKS_PER_HUB)
        segs = create_trunk_paths(
            HUBS["source"], (hx,hy),
            NUM_TRUNKS_PER_HUB, TRUNK_BOW_RANGE[0], TRUNK_BOW_RANGE[1],
            bow_sign=bow_sign_per_hub[hid], fan_angles=fan
        )
        trunks.extend(segs)
        trunk_meta.extend([{"hub":hid,"kind":"trunk","tier":0} for _ in segs])
    trunk_seg = count_segments(trunks)
    trunk_counts = Counter(m.get("hub") for m in trunk_meta if m.get("kind") == "trunk")
    print(f"Trunks per hub: {dict(trunk_counts)}")
    if trunk_seg >= MAX_SEGMENTS:
        # decimate uniformly
        keep_every = max(2, int(math.ceil(trunk_seg / MAX_SEGMENTS)))
        new_t, new_m = [], []
        for t, m in zip(trunks, trunk_meta):
            t2 = t[::keep_every]
            if t2[-1] != t[-1]: t2.append(t[-1])
            if len(t2)>=2:
                new_t.append(t2); new_m.append(m)
        trunks, trunk_meta = new_t, new_m
        trunk_seg = count_segments(trunks)
        trunk_counts = Counter(m.get("hub") for m in trunk_meta if m.get("kind") == "trunk")
        print(f"Trunks per hub after decimate: {dict(trunk_counts)}")

    # starting tips = trunk endpoints
    endpoints_by_hub = defaultdict(list)
    for t, m in zip(trunks, trunk_meta):
        endpoints_by_hub[m["hub"]].append(t[-1])

    nodes_by_hub = {hid: [] for hid in HUBS if hid!="source"}
    actives = {}
    for hid in nodes_by_hub:
        for (x,y) in endpoints_by_hub.get(hid, []):
            n = Node(x,y,None, hid)
            nodes_by_hub[hid].append(n)
        actives[hid] = [n for n in nodes_by_hub[hid]]

    # attractors
    attrs_by_hub = generate_attractors_per_hub(HUBS, NUM_ATTRACTORS_PER_HUB)

    # budgets
    branch_budget = MAX_SEGMENTS - trunk_seg
    hubs_list = [h for h in nodes_by_hub.keys()]
    per_hub_budget = {h: max(0, branch_budget // len(hubs_list)) for h in hubs_list}
    segs_used = {h: 0 for h in hubs_list}

    # center fusion
    min_src = min(math.hypot(HUBS[h][0]-HUBS["source"][0], HUBS[h][1]-HUBS["source"][1]) for h in hubs_list)
    CENTER_FUSE_RADIUS = CENTER_FUSE_FRAC * min_src
    center_idx = CenterIndex(FUSE_RADIUS, FUSE_RADIUS)
    extra_paths, extra_meta = [], []
    fusion_count = {h:0 for h in hubs_list}

    # round-robin growth
    R2_INF = INFLUENCE_RADIUS*INFLUENCE_RADIUS
    R2_KILL = KILL_RADIUS*KILL_RADIUS
    rounds = 0
    growth_start = time.time()
    while rounds < MAX_OUTER_ROUNDS:
        rounds += 1
        # build center index from current nodes
        center_idx.build_from_nodes(nodes_by_hub, HUBS["source"], CENTER_FUSE_RADIUS)

        any_progress = False
        for hid in hubs_list:
            if segs_used[hid] >= per_hub_budget[hid]: continue
            tips = actives[hid]
            if not tips: continue
            attrs = attrs_by_hub[hid]
            if not attrs: continue

            grid = TipGrid(INFLUENCE_RADIUS)
            grid.rebuild(tips)

            influences = {}   # idx -> (fx,fy)
            kill = set()
            # nearest influence per attractor
            for ai, (ax,ay) in enumerate(attrs):
                best_i = -1; best_d2 = R2_INF
                for ti in grid.nearby(ax, ay):
                    t = tips[ti]
                    d2 = (ax - t.x)*(ax - t.x) + (ay - t.y)*(ay - t.y)
                    if d2 < R2_KILL:
                        kill.add(ai); best_i = -1; break
                    if d2 < best_d2:
                        best_d2 = d2; best_i = ti
                if best_i >= 0:
                    fx, fy = influences.get(best_i, (0.0,0.0))
                    influences[best_i] = (fx + (ax - tips[best_i].x),
                                          fy + (ay - tips[best_i].y))

            # remove killed attractors
            if kill:
                attrs_by_hub[hid] = [(ax,ay) for i,(ax,ay) in enumerate(attrs) if i not in kill]
                attrs = attrs_by_hub[hid]

            if not influences:
                continue

            # grow new tips
            new_tips = []
            for ti, (fx,fy) in influences.items():
                if segs_used[hid] >= per_hub_budget[hid]: break
                nx, ny = normalize(fx, fy)
                if nx == 0.0 and ny == 0.0: continue
                nnx = tips[ti].x + nx*STEP_SIZE
                nny = tips[ti].y + ny*STEP_SIZE
                if not (0 <= nnx < WIDTH and 0 <= nny < HEIGHT): continue
                node = Node(nnx, nny, tips[ti], hid)

                # center fusion
                if distance2(nnx,nny,HUBS["source"][0],HUBS["source"][1]) <= CENTER_FUSE_RADIUS*CENTER_FUSE_RADIUS:
                    other = center_idx.find_other(nnx, nny, hid)
                    if other is not None:
                        # save a tiny bridge and TERMINATE this tip
                        extra_paths.append([(nnx,nny),(other.x,other.y)])
                        extra_meta.append({"hub":hid,"kind":"fusion"})
                        fusion_count[hid] += 1
                        # do not add to active list (terminal)
                    else:
                        center_idx.add(nnx,nny,hid,node)
                        new_tips.append(node)
                        segs_used[hid] += 1
                else:
                    new_tips.append(node)
                    segs_used[hid] += 1

            # next active set = influenced + new
            next_actives = [tips[i] for i in influences.keys()]
            next_actives.extend(new_tips)
            # cap
            if len(next_actives) > MAX_TIPS_PER_HUB:
                next_actives = next_actives[:MAX_TIPS_PER_HUB]
            actives[hid] = next_actives
            any_progress = True

        if not any_progress:
            break

    growth_time = time.time() - growth_start

    # extract, resample, budget prune (branches only)
    paths, metas = extract_paths(nodes_by_hub, min_pts=3)
    sampled = [resample_equal(p, SAMPLE_STEP_PX) for p in paths]
    segs = count_segments(sampled)

    branch_budget = max(0, MAX_SEGMENTS - trunk_seg)
    if segs > branch_budget:
        # prune shortest first
        order = sorted(range(len(sampled)), key=lambda i: len(sampled[i]))
        keep = []
        cur = 0
        for i in reversed(order):  # keep longer paths preferentially
            L = max(0, len(sampled[i])-1)
            if cur + L <= branch_budget:
                keep.append(i); cur += L
        keep_set = set(keep)
        sampled = [p for i,p in enumerate(sampled) if i in keep_set]
        metas   = [m for i,m in enumerate(metas)   if i in keep_set]
        segs = count_segments(sampled)

    all_paths = trunks + sampled + extra_paths
    all_meta  = trunk_meta + metas + extra_meta
    final_seg = count_segments(all_paths)

    # JSON
    hubs_list = [{"id":k,"x":v[0],"y":v[1],"label":k.upper()} for k,v in HUBS.items()]
    labels = [{"id":k,"label":k.upper()} for k in HUBS.keys()]
    data = {
        "width": WIDTH, "height": HEIGHT, "seed": args.seed,
        "hubs": hubs_list, "nodes": [],
        "paths": all_paths, "paths_meta": all_meta, "labels": labels
    }

    artifacts = Path("artifacts"); artifacts.mkdir(parents=True, exist_ok=True)
    json_path = artifacts / "blog_network.json"
    base_png  = artifacts / "blog_bg_base.png"
    glow_png  = artifacts / "blog_bg_glow.png"

    with open(json_path,"w") as f: json.dump(data, f, indent=2)
    render_pngs(all_paths, all_meta, HUBS, base_png, glow_png)

    t1 = time.time()
    # ---- logs / acceptance hints ----
    print(f"\nSeed: {args.seed}")
    print(f"Trunk segments: {trunk_seg}")
    print(f"Branch segments: {segs}  (budget {branch_budget})")
    print(f"Final segments: {final_seg} / {MAX_SEGMENTS}")
    print(f"Fusions: {fusion_count}")
    print(f"Growth time: {growth_time:.2f}s   Total: {t1-t0:.2f}s")
    # angular coverage quick check
    def ang(p, h): 
        a = math.atan2(p[1]-h[1], p[0]-h[0])
        return a + 2*math.pi if a<0 else a
    SECT = 12
    cov = {h:[0]*SECT for h in nodes_by_hub.keys()}
    for p,m in zip(all_paths, all_meta):
        hid = m.get("hub","")
        if hid in cov:
            hxy = HUBS[hid]
            for i in range(1, len(p)):
                mx = 0.5*(p[i-1][0]+p[i][0]); my = 0.5*(p[i-1][1]+p[i][1])
                idx = int((ang((mx,my),hxy) // (2*math.pi/SECT)))
                cov[hid][min(SECT-1,max(0,idx))] += 1
    print("Angular coverage (non-empty/12):",
          {h: sum(1 for b in bins if b>0) for h,bins in cov.items()})

if __name__ == "__main__":
    main()
