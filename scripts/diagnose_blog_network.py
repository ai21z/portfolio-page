#!/usr/bin/env python3
import json, math, sys

SECTORS = 12

def load(fp):
    with open(fp,"r") as f: return json.load(f)

def angle_of(p, hub):
    a = math.atan2(p[1]-hub[1], p[0]-hub[0])
    return a + 2*math.pi if a < 0 else a

def sector_index(theta):
    w = 2*math.pi / SECTORS
    i = int(theta // w)
    return max(0, min(SECTORS-1, i))

def main(path="artifacts/blog_network.json"):
    d = load(path)
    hubs = {h["id"]:(h["x"],h["y"]) for h in d["hubs"]}
    paths, metas = d["paths"], d["paths_meta"]
    outer = [h for h in hubs if h != "source"]

    cov = {h:[0]*SECTORS for h in outer}
    fusion_count = {h:0 for h in outer}
    src = hubs["source"]
    min_h2s = min(math.hypot(hubs[h][0]-src[0], hubs[h][1]-src[1]) for h in outer)
    min_center_dist = {h: float("inf") for h in outer}

    for p,m in zip(paths, metas):
        hid = m.get("hub",""); kind = m.get("kind","")
        if hid in cov:
            hxy = hubs[hid]
            for i in range(1, len(p)):
                mx = 0.5*(p[i-1][0]+p[i][0]); my = 0.5*(p[i-1][1]+p[i][1])
                cov[hid][sector_index(angle_of((mx,my), hxy))] += 1
            if kind != "trunk":
                for (x,y) in p:
                    dsrc = math.hypot(x-src[0], y-src[1])
                    if dsrc < min_center_dist[hid]: min_center_dist[hid] = dsrc
        if kind == "fusion" and hid in fusion_count:
            fusion_count[hid] += 1

    print("\n=== Angular coverage (non-empty / 12) ===")
    for h,b in cov.items():
        print(f"{h:12s}: {sum(1 for v in b if v>0)}/12")
    print("\n=== Fusion segments created ===")
    for h,c in fusion_count.items():
        print(f"{h:12s}: {c}")

    thresh = 0.12 * min_h2s
    weak = [h for h,v in min_center_dist.items() if not (v < thresh)]
    if weak:
        print(f"\n[WARN] Center overlap weak for: {', '.join(weak)}  (thresh {thresh:.1f}px)")
    else:
        print("\n[OK] Center proximity good (ignoring trunks).")

    low = [h for h,b in cov.items() if sum(1 for v in b if v>0) < 9]
    if low:
        print(f"[WARN] Low angular coverage for: {', '.join(low)}")
    else:
        print("[OK] Angular coverage good.")

if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv)>1 else "artifacts/blog_network.json")
