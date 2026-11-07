#!/usr/bin/env python3
"""
Detailed terrain for the 3D view: the height map at 4× its size, with ridges and eroded valleys.

  python3 tools/detail-height.py <height.png> <tiles folder> <out folder> [--area x0,y0,x1,y1 ...]

The height map (grey 0–255, sea level 120, 100 m per step) stays the base: big shapes and coasts are
kept, and weather and wind keep using the base. On top of it:
 1. Where there are zoom images (level 1, 4× the map), the shaded relief drawing is turned into
    heights (light from the north-west: a slope that faces the light is drawn bright, so the ground
    rises away from the light there). Lettering, forests and other coloured fills are left out.
 2. Everywhere on land, ridged noise adds ridges, more the higher the ground (plains stay smooth).
    Where there is a drawing, it leads and the noise only adds fine detail.
 3. A water-erosion simulation (stream power, implicit scheme) lets rain run downhill and cut
    branching valleys into the mountains, with a little slope smoothing.
 4. Only the ridges and valleys (finer than about three map pixels) are added to the base, so the
    big shapes stay; where ridges would rise above the highest base ground nearby, that
    neighbourhood is lowered a little instead (heights you have set stay the top). The weather
    keeps using the base height map. Towards the
    edge of the written tiles it blends into the base, so the 3D view shows no step there.
Without --area the whole world is done: every 256×256 map-pixel piece with ground above 800 m, each
with 32 pixels of overlap that are blended with its neighbours, so there are no seams (about two
hours on two cores; pieces already made are kept in <out>/_pieces, so a stopped run can go on).
--area x0,y0,x1,y1 (map pixels) limits it to the pieces there. Output: <out>/manifest.json and
<out>/{tx}_{ty}.png, 256×256 8-bit grey tiles at 4× the map: the metres added to the height map
(as the 3D view reads it) = (grey − 128) × 24. Tiles with nothing to add are left out.
"""
import json, os, sys, numpy as np
from PIL import Image
from scipy import ndimage as ndi
from scipy.fft import dctn, idctn
from numba import njit

S = 4                 # detail pixels per map pixel
TILE = 256
STEP = 24             # metres per grey step in the tiles (±3 km)
SEA = 120; MPS = 100

args = sys.argv[1:]
areas = []
while "--area" in args:
    i = args.index("--area"); areas.append(tuple(int(v) for v in args[i + 1].split(","))); args = args[:i] + args[i + 2:]
hpath, tiles, out = args
tiles = tiles.rstrip("/") + "/"
K_ERODE = float(os.environ.get("K_ERODE", "0.15")); STEPS = int(os.environ.get("STEPS", "300"))
os.makedirs(out, exist_ok=True)

base = np.asarray(Image.open(hpath).convert("L")).astype(np.float32)
H, W = base.shape
man = json.load(open(tiles + "manifest.json"))
L1 = [l for l in man["levels"] if l["level"] == 1][0]
assert abs(L1["width"] / W - S) < 0.01, "level 1 zoom images must be 4× the map"
have1 = set(L1["tiles"])
mpp = 5410.0          # metres per map pixel
dx = mpp / S
rng = np.random.default_rng(7)


def zoom_images(x0, y0, x1, y1):
    """The level 1 zoom images over map pixels x0..x1, y0..y1 (4× size), and where they exist."""
    w, h = (x1 - x0) * S, (y1 - y0) * S
    img = np.zeros((h, w, 3), np.float32); have = np.zeros((h, w), bool)
    for ty in range(max(0, y0 * S // 512), (y1 * S) // 512 + 1):
        for tx in range(max(0, x0 * S // 512), (x1 * S) // 512 + 1):
            if f"{tx}_{ty}" not in have1:
                continue
            t = np.asarray(Image.open(f"{tiles}1/{tx}_{ty}.jpg").convert("RGB"), np.float32) / 255
            ox, oy = tx * 512 - x0 * S, ty * 512 - y0 * S
            a0, b0 = max(0, ox), max(0, oy)
            a1, b1 = min(w, ox + t.shape[1]), min(h, oy + t.shape[0])
            if a1 <= a0 or b1 <= b0:
                continue
            img[b0:b1, a0:a1] = t[b0 - oy:b1 - oy, a0 - ox:a1 - ox]
            have[b0:b1, a0:a1] = True
    return img, have


def relief_from_drawing(img, have):
    """Shaded relief → heights (zero mean, unit spread), and how much drawing there is at each point."""
    r, g, b = img[..., 0], img[..., 1], img[..., 2]
    mx, mn = img.max(2), img.min(2)
    L = (mx + mn) / 2
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    d = np.maximum(mx - mn, 1e-6)
    hue = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60
    ink = ((L < 0.36) & (sat < 0.45)) | ((sat > 0.45) & ((hue < 25) | (hue > 300)))   # lettering, red names
    ink = ndi.binary_dilation(ink, iterations=2)                          # and their soft edges
    shading = have & ~ink & ((sat < 0.30) | ((hue > 15) & (hue < 70) & (sat < 0.55)))   # grey / brown relief
    shading = ndi.binary_opening(shading, iterations=1)
    s = L - ndi.gaussian_filter(np.where(shading, L, np.nan_to_num(L)), 10)
    s = np.where(shading, s, 0)
    s = np.clip(s, -0.35, 0.35)
    # bright slopes face the light (north-west): the ground rises towards the south-east there
    gx = gy = s / np.sqrt(2)
    div = np.gradient(gx, axis=1) + np.gradient(gy, axis=0)
    # Poisson solve with Neumann edges (cosine transform)
    h, w = div.shape
    k = np.pi * np.arange(w) / w; l = np.pi * np.arange(h) / h
    den = (2 * np.cos(k)[None, :] - 2) + (2 * np.cos(l)[:, None] - 2)
    den[0, 0] = 1
    z = idctn(dctn(div, norm="ortho") / den, norm="ortho")
    z -= ndi.gaussian_filter(z, 40)                                         # only the ridges, not drift
    amount = ndi.gaussian_filter(shading.astype(np.float32), 12)
    # only where the drawing is really sharp (the detailed regional maps); elsewhere the zoom images
    # are the world map enlarged, and its blur and lettering would only make false ridges
    fine = ndi.gaussian_filter(np.abs(L - ndi.gaussian_filter(L, 1.0)) * ~ndi.binary_dilation(ink, iterations=3), 40)   # lettering doesn't count
    amount *= np.clip((fine - 0.006) / 0.010, 0, 1)
    if os.environ.get("ZD_DEBUG") and (amount > 0.2).any(): print("zd std", float(np.std(z[amount > 0.2])), flush=True)
    z /= ZD_SCALE                                                           # same scale in every piece
    return z.astype(np.float32), np.clip(amount / 0.35, 0, 1).astype(np.float32)


def _value_noise(X, Y, octave):
    """Smooth value noise at whole-world positions (same everywhere, whichever piece is made)."""
    ix, iy = np.floor(X).astype(np.int64), np.floor(Y).astype(np.int64)
    fx, fy = X - ix, Y - iy
    fx = fx * fx * fx * (fx * (fx * 6 - 15) + 10); fy = fy * fy * fy * (fy * (fy * 6 - 15) + 10)
    def lat(a, b):
        h = (a * 374761393 + b * 668265263 + octave * 1442695041) & 0xFFFFFFFF
        h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
        h = h ^ (h >> 16)
        return (h & 0xFFFF).astype(np.float32) / 32767.5 - 1.0
    a = lat(ix, iy) * (1 - fx) + lat(ix + 1, iy) * fx
    b = lat(ix, iy + 1) * (1 - fx) + lat(ix + 1, iy + 1) * fx
    return (a * (1 - fy) + b * fy).astype(np.float32)


def ridged_noise(X0, Y0, h, w):
    """Ridged multifractal noise at whole-world detail pixels X0…, Y0…, roughly mean 0, spread 1,
    features from ~30 km down to ~2 km."""
    X = (X0 + np.arange(w, dtype=np.float64))[None, :]; Y = (Y0 + np.arange(h, dtype=np.float64))[:, None]
    X, Y = np.broadcast_to(X, (h, w)), np.broadcast_to(Y, (h, w))
    total = np.zeros((h, w), np.float32); amp, norm, prev = 1.0, 0.0, None
    for o, cell in enumerate((24, 12, 6, 3, 1.5)):
        n = 1 - np.abs(_value_noise(X / cell, Y / cell, o + 1))
        n = n * n
        if prev is not None:
            n *= 0.5 + 0.5 * np.clip(prev, 0, 1)                            # ridges sharper on ridges
        total += amp * n; norm += amp; prev = n; amp *= 0.5
    total /= norm
    return (total - NOISE_MEAN) / NOISE_STD


@njit(cache=True)
def _fill(z, fixed):
    """Priority flood: every land point drains to the sea or the edge (tiny slope through pits)."""
    h, w = z.shape
    out = z.copy()
    done = np.zeros((h, w), np.bool_)
    # simple binary heap of (height, index)
    heap_v = np.empty(h * w, np.float64); heap_i = np.empty(h * w, np.int64); n = 0
    for y in range(h):
        for x in range(w):
            if fixed[y, x] or y == 0 or x == 0 or y == h - 1 or x == w - 1:
                done[y, x] = True
                v = out[y, x]; i = y * w + x
                k = n; n += 1
                while k > 0 and heap_v[(k - 1) // 2] > v:
                    heap_v[k] = heap_v[(k - 1) // 2]; heap_i[k] = heap_i[(k - 1) // 2]; k = (k - 1) // 2
                heap_v[k] = v; heap_i[k] = i
    while n > 0:
        v = heap_v[0]; i = heap_i[0]
        n -= 1
        lv = heap_v[n]; li = heap_i[n]; k = 0
        while True:
            c = 2 * k + 1
            if c >= n: break
            if c + 1 < n and heap_v[c + 1] < heap_v[c]: c += 1
            if heap_v[c] >= lv: break
            heap_v[k] = heap_v[c]; heap_i[k] = heap_i[c]; k = c
        if n > 0:
            heap_v[k] = lv; heap_i[k] = li
        y = i // w; x = i % w
        for dy in (-1, 0, 1):
            for dx_ in (-1, 0, 1):
                yy = y + dy; xx = x + dx_
                if yy < 0 or xx < 0 or yy >= h or xx >= w or done[yy, xx]:
                    continue
                done[yy, xx] = True
                nv = out[yy, xx]
                if nv <= v + 1e-3:
                    nv = v + 1e-3
                    out[yy, xx] = nv
                k = n; n += 1
                while k > 0 and heap_v[(k - 1) // 2] > nv:
                    heap_v[k] = heap_v[(k - 1) // 2]; heap_i[k] = heap_i[(k - 1) // 2]; k = (k - 1) // 2
                heap_v[k] = nv; heap_i[k] = yy * w + xx
    return out


@njit(cache=True)
def _erode(z, fixed, K, dx, steps, diff, uplift):
    """Stream-power erosion, implicit (Braun & Willett 2013): D8 flow, nodes in drainage order
    (a stack built from the outlets, O(n)), uplift and slope smoothing. Run long enough, the ground
    settles where uplift and erosion balance: branching valleys, high where the uplift is strong."""
    h, w = z.shape
    nn = h * w
    oy = np.array([-1, -1, -1, 0, 0, 1, 1, 1]); ox = np.array([-1, 0, 1, -1, 1, -1, 0, 1])
    od = np.array([1.4142135, 1.0, 1.4142135, 1.0, 1.0, 1.4142135, 1.0, 1.4142135])
    rec = np.empty(nn, np.int64); dist = np.ones(nn)
    ndon = np.zeros(nn, np.int64); start = np.zeros(nn + 1, np.int64); don = np.empty(nn, np.int64)
    stack = np.empty(nn, np.int64); todo = np.empty(nn, np.int64); area = np.empty(nn)
    zf = z.reshape(nn); fx = fixed.reshape(nn); up = uplift.reshape(nn)
    for it in range(steps):
        for i in range(nn):
            zf[i] += up[i]
        # receivers
        for y in range(h):
            for x in range(w):
                i = y * w + x
                rec[i] = i; dist[i] = 1.0
                if fx[i] or y == 0 or x == 0 or y == h - 1 or x == w - 1:
                    continue
                best = 0.0
                for k in range(8):
                    j = (y + oy[k]) * w + x + ox[k]
                    sl = (zf[i] - zf[j]) / od[k]
                    if sl > best:
                        best = sl; rec[i] = j; dist[i] = od[k]
        # donors (CSR)
        ndon[:] = 0
        for i in range(nn):
            if rec[i] != i: ndon[rec[i]] += 1
        start[0] = 0
        for i in range(nn): start[i + 1] = start[i] + ndon[i]
        fill = start[:-1].copy()
        for i in range(nn):
            r = rec[i]
            if r != i:
                don[fill[r]] = i; fill[r] += 1
        # stack from every outlet
        ns = 0
        for b in range(nn):
            if rec[b] != b: continue
            nt = 0; todo[nt] = b; nt += 1
            while nt > 0:
                nt -= 1; i = todo[nt]
                stack[ns] = i; ns += 1
                for q in range(start[i], start[i + 1]):
                    todo[nt] = don[q]; nt += 1
        # drainage area (in cells), from the tops down
        for i in range(nn): area[i] = 1.0
        for k in range(ns - 1, -1, -1):
            i = stack[k]; r = rec[i]
            if r != i: area[r] += area[i]
        # erosion, from the outlets up (implicit, unconditionally stable)
        for k in range(ns):
            i = stack[k]; r = rec[i]
            if r == i: continue
            F = K * np.sqrt(area[i]) / dist[i]
            zf[i] = (zf[i] + F * zf[r]) / (1 + F)
        # slope smoothing (hillslopes)
        if diff > 0:
            z2 = z.copy()
            for y in range(1, h - 1):
                for x in range(1, w - 1):
                    if fixed[y, x]: continue
                    lap = z[y - 1, x] + z[y + 1, x] + z[y, x - 1] + z[y, x + 1] - 4 * z[y, x]
                    z2[y, x] = z[y, x] + diff * lap
            z[:, :] = z2
    return z


NOISE_MEAN, NOISE_STD = 0.0, 1.0
_n = ridged_noise(0, 0, 512, 512)
NOISE_MEAN, NOISE_STD = float(_n.mean()), float(_n.std())
ZD_SCALE = float(os.environ.get("ZD_SCALE", "0.25"))
CORE = 256            # map pixels in the middle of each piece (its own part)
OVER = 32             # map pixels of overlap on each side, where neighbouring pieces are blended


def make_piece(job):
    """One piece of the world: detailed heights over the window and its blending weight."""
    cx, cy, path = job
    x0, y0 = max(0, cx - OVER), max(0, cy - OVER)
    x1, y1 = min(W, cx + CORE + OVER), min(H, cy + CORE + OVER)
    g = base[y0:y1, x0:x1]
    up = ndi.zoom((g - SEA) * MPS, S, order=3, mode="nearest").astype(np.float32)
    hh, ww = up.shape
    land = up > 0
    img, have = zoom_images(x0, y0, x1, y1)
    zd, amount = relief_from_drawing(img, have)
    # how far the ground rises above the low ground around it (plains and ice sheets stay smooth)
    # (from a smoothed copy: small bumps in the height map, like old letter imprints, mustn't steer it)
    ups = ndi.gaussian_filter(up, 3 * S)
    low = ndi.minimum_filter(ndi.gaussian_filter(up, 4 * S), size=48 * S)
    prom = np.clip(ups - np.maximum(low, 0), 0, None)
    amp = float(os.environ.get("AMP", "0.6")) * prom * np.clip((prom - 150) / 900, 0, 1)
    zd = ndi.gaussian_filter(zd, 1.0)
    zn = ridged_noise(x0 * S, y0 * S, hh, ww)
    # erosion carves the valleys: the ground is lifted (more where the drawing has ridges) while
    # rain wears it down, until the two balance in a landscape of branching valleys
    fixed = ~land | (ndi.distance_transform_edt(land) < 2)
    mask = np.clip(amp / 1800.0, 0, 1)
    lift = mask * np.clip(1 + float(os.environ.get("ZDW", "0.3")) * amount * zd, 0.3, 2.0) * 20.0
    z0 = np.where(fixed, 0.0, 200 * mask * (1 + 0.3 * zn))
    z0 = _fill(z0.astype(np.float64), fixed)
    zs = _erode(z0, fixed, K_ERODE, dx, STEPS, float(os.environ.get("DIFF", "0.2")), np.where(fixed, 0.0, lift).astype(np.float64)).astype(np.float32)
    # only its ridges and valleys go onto the base, at the wanted strength
    hp = zs - ndi.gaussian_filter(zs, 6.0 * S)
    spread = np.sqrt(ndi.gaussian_filter(hp * hp, 4 * S)) + 1.0
    hp = hp / spread * np.clip(0.40 * amp, 0, None)
    z = up + hp + 0.25 * amp * zn * (1 - amount)   # a little extra noise where there is no drawing
    # heights you have set stay the top: ridges above the highest base ground nearby are pressed down
    cap = ndi.maximum_filter(up, size=5 * S)
    z = np.where(z > cap, cap + (z - cap) * 0.15, z)
    z = np.where(land, np.maximum(z, 2.0), up)
    # weight: full in the middle, fading to nothing at the window's edge (so pieces blend)
    yy = np.arange(hh)[:, None]; xx = np.arange(ww)[None, :]
    e = np.minimum(np.minimum(yy, hh - 1 - yy), np.minimum(xx, ww - 1 - xx)).astype(np.float32)
    wgt = np.clip(e / (OVER * S * 0.9), 0, 1)
    np.savez_compressed(path, z=z.astype(np.float32), up=up, w=wgt.astype(np.float32), x0=x0 * S, y0=y0 * S)
    return path


if __name__ == "__main__":
    import multiprocessing as mp
    work = os.path.join(out, "_pieces"); os.makedirs(work, exist_ok=True)
    jobs = []
    for cy in range(0, H, CORE):
        for cx in range(0, W, CORE):
            if areas and not any(cx < a1 and cx + CORE > a0 and cy < b1 and cy + CORE > b0 for a0, b0, a1, b1 in areas):
                continue
            win = base[max(0, cy - OVER):cy + CORE + OVER, max(0, cx - OVER):cx + CORE + OVER]
            if (win >= SEA + 8).sum() < 200:          # hardly any ground above 800 m: nothing to do
                continue
            path = os.path.join(work, f"p_{cx}_{cy}.npz")
            jobs.append((cx, cy, path))
    todo = [j for j in jobs if not os.path.exists(j[2])]
    print(len(jobs), "pieces,", len(todo), "to make", flush=True)
    with mp.get_context("fork").Pool(int(os.environ.get("JOBS", str(os.cpu_count() or 1)))) as pool:
        for k, p in enumerate(pool.imap_unordered(make_piece, todo), 1):
            print(f"  {k}/{len(todo)} {os.path.basename(p)}", flush=True)
    # put the pieces together, tile by tile; where pieces fade out, the base shows through
    tiles_of = {}
    pieces = []
    for cx, cy, path in jobs:
        d = np.load(path); X0, Y0 = int(d["x0"]), int(d["y0"]); hh, ww = d["z"].shape
        pieces.append((path, X0, Y0, hh, ww))
        for ty in range(-(-Y0 // TILE), (Y0 + hh) // TILE):
            for tx in range(-(-X0 // TILE), (X0 + ww) // TILE):
                tiles_of.setdefault((tx, ty), []).append(len(pieces) - 1)
    cache = {}
    def piece(i):
        if i not in cache:
            if len(cache) > 12: cache.pop(next(iter(cache)))
            d = np.load(pieces[i][0]); cache[i] = (d["z"], d["up"], d["w"])
        return cache[i]
    names = []
    for (tx, ty) in sorted(tiles_of, key=lambda t: (t[1], t[0])):
        sz = np.zeros((TILE, TILE), np.float32); su = np.zeros_like(sz); sw = np.zeros_like(sz)
        for i in tiles_of[(tx, ty)]:
            _, X0, Y0, hh, ww = pieces[i]
            z, up, w = piece(i)
            a, b = ty * TILE - Y0, tx * TILE - X0
            if a < 0 or b < 0 or a + TILE > hh or b + TILE > ww: continue
            ww_ = w[a:a + TILE, b:b + TILE]
            sz += ww_ * z[a:a + TILE, b:b + TILE]; su += ww_ * up[a:a + TILE, b:b + TILE] + 1e-6 * up[a:a + TILE, b:b + TILE]; sw += ww_
        if sw.max() <= 0.02: continue                  # only the faded edge: the base is enough
        upm = su / (sw + 1e-6)
        rest = np.clip(1 - sw, 0, None)
        zt = (sz + rest * upm) / (sw + rest)
        # stored as the difference from the height map as the 3D view reads it (bilinear), so tiles
        # join the plain height map exactly; 8-bit grey, STEP metres per grey step, 128 = no change
        gy, gx = np.mgrid[ty * TILE:(ty + 1) * TILE, tx * TILE:(tx + 1) * TILE]
        bl = ndi.map_coordinates((base - SEA) * MPS, [(gy + 0.5) / S - 0.5, (gx + 0.5) / S - 0.5], order=1, mode="nearest")
        delta = zt - bl
        if np.abs(delta).max() < STEP: continue        # nothing to add here
        v = np.clip(np.round(delta / STEP) + 128, 0, 255).astype(np.uint8)
        Image.fromarray(v, "L").save(os.path.join(out, f"{tx}_{ty}.png"), optimize=True)
        names.append(f"{tx}_{ty}")
    json.dump({"scale": S, "tile": TILE, "step": STEP, "encoding": "metres added to the height map = (grey - 128) * step", "tiles": names},
              open(os.path.join(out, "manifest.json"), "w"))
    print("tiles", len(names))
