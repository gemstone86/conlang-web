#!/usr/bin/env python3
"""
Puts a sharper regional map into the default map: its zoom images (all levels) and map.jpg.

  python3 tools/insert-map.py <tiles folder> <map.jpg> <piece.png> <x> <y> <sx> <sy> [--mask mask.png] [--feather px]

 - piece.png: the regional map (or one part of it, e.g. a cut-out); <x> <y> is where its top-left corner
   lands on map.jpg (map pixels), <sx> <sy> how many of its pixels make one map pixel across / down.
 - --mask: a grey image the size of piece.png, white where the piece should be used (black: keep the
   old map, e.g. other cut-outs or the white frames between them). Without it the whole piece is used.
 - --feather: how many map pixels the edge blends over (default 1.5).
Zoom images at the three levels (8×, 4×, 2× the map) are updated or made where missing, and the
manifest lists them; map.jpg gets the piece shrunk to its size.
"""
import json, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

Image.MAX_IMAGE_PIXELS = None
args = sys.argv[1:]
opt = {}
for k in ("--mask", "--feather"):
    if k in args:
        i = args.index(k); opt[k] = args[i + 1]; args = args[:i] + args[i + 2:]
tiles, mapjpg, piece = args[0].rstrip("/") + "/", args[1], args[2]
X, Y, SX, SY = (float(v) for v in args[3:7])
feather = float(opt.get("--feather", 1.5))

P = np.asarray(Image.open(piece).convert("RGB")).astype(np.float32)
ph, pw = P.shape[:2]
M = np.ones((ph, pw), np.float32)
if "--mask" in opt:
    M = (np.asarray(Image.open(opt["--mask"]).convert("L")).astype(np.float32) / 255.0)
# soft edge: fade in over `feather` map pixels from the mask's border
inside = M > 0.5
dist = ndi.distance_transform_edt(inside)
fx = (SX + SY) / 2 * feather
M = np.clip(dist / max(fx, 1e-6), 0, 1) * inside

man = json.load(open(tiles + "manifest.json"))
ts = man["tileSize"]
W1 = Image.open(mapjpg).size[0]


def piece_at(f):
    """The piece and its weight resampled to f× the map: (x0, y0, rgb, alpha) in that image's pixels."""
    x0, y0 = X * f, Y * f
    w, h = pw / SX * f, ph / SY * f
    ix0, iy0 = int(np.floor(x0)), int(np.floor(y0))
    ow, oh = int(np.ceil(x0 + w)) - ix0, int(np.ceil(y0 + h)) - iy0
    # sample the piece at each output pixel centre
    gx = (np.arange(ow) + ix0 + 0.5 - x0) / f * SX - 0.5
    gy = (np.arange(oh) + iy0 + 0.5 - y0) / f * SY - 0.5
    scale = SX / f
    src, msk = P, M
    if scale > 1.5:                       # shrinking a lot: blur first so it doesn't alias
        sig = scale / 2.5
        src = np.stack([ndi.gaussian_filter(P[..., c], sig) for c in range(3)], -1)
        msk = ndi.gaussian_filter(M, sig)
    yy, xx = np.meshgrid(gy, gx, indexing="ij")
    rgb = np.stack([ndi.map_coordinates(src[..., c], [yy, xx], order=1, mode="nearest") for c in range(3)], -1)
    a = ndi.map_coordinates(msk, [yy, xx], order=1, mode="constant", cval=0)
    a[(yy < -0.5) | (yy > ph - 0.5) | (xx < -0.5) | (xx > pw - 0.5)] = 0
    return ix0, iy0, rgb, np.clip(a, 0, 1)


changed = {}
base = Image.open(mapjpg).convert("RGB")
for L in man["levels"]:
    lvl, f = L["level"], L["width"] / W1
    ix0, iy0, rgb, a = piece_at(f)
    have = set(L["tiles"])
    n = 0
    for ty in range(iy0 // ts, (iy0 + rgb.shape[0] - 1) // ts + 1):
        for tx in range(ix0 // ts, (ix0 + rgb.shape[1] - 1) // ts + 1):
            key = f"{tx}_{ty}"
            # the part of the piece over this tile
            x0, y0 = max(ix0, tx * ts), max(iy0, ty * ts)
            x1, y1 = min(ix0 + rgb.shape[1], (tx + 1) * ts, L["width"]), min(iy0 + rgb.shape[0], (ty + 1) * ts, L["height"])
            if x1 <= x0 or y1 <= y0: continue
            aa = a[y0 - iy0:y1 - iy0, x0 - ix0:x1 - ix0]
            if aa.max() <= 0.01: continue
            path = f"{tiles}{lvl}/{key}.jpg"
            tw, th = min(ts, L["width"] - tx * ts), min(ts, L["height"] - ty * ts)
            if key in have and os.path.exists(path):
                t = np.asarray(Image.open(path).convert("RGB")).astype(np.float32)
            else:                          # no tile here yet: start from the map picture, enlarged
                t = np.asarray(base.crop((tx * ts / f, ty * ts / f, (tx * ts + tw) / f, (ty * ts + th) / f)).resize((tw, th), Image.BICUBIC)).astype(np.float32)
            sub = t[y0 - ty * ts:y1 - ty * ts, x0 - tx * ts:x1 - tx * ts]
            t[y0 - ty * ts:y1 - ty * ts, x0 - tx * ts:x1 - tx * ts] = sub * (1 - aa[..., None]) + rgb[y0 - iy0:y1 - iy0, x0 - ix0:x1 - ix0] * aa[..., None]
            Image.fromarray(np.clip(t, 0, 255).astype(np.uint8)).save(path, quality=88, optimize=True)
            if key not in have: L["tiles"].append(key); have.add(key)
            n += 1
    changed[lvl] = n
# map.jpg itself
ix0, iy0, rgb, a = piece_at(1.0)
B = np.asarray(base).astype(np.float32)
y1, x1 = min(iy0 + rgb.shape[0], B.shape[0]), min(ix0 + rgb.shape[1], B.shape[1])
sub = B[iy0:y1, ix0:x1]; aa = a[:y1 - iy0, :x1 - ix0, None]
B[iy0:y1, ix0:x1] = sub * (1 - aa) + rgb[:y1 - iy0, :x1 - ix0] * aa
Image.fromarray(np.clip(B, 0, 255).astype(np.uint8)).save(mapjpg, quality=92, optimize=True)
for L in man["levels"]: L["tiles"].sort(key=lambda k: tuple(int(v) for v in k.split("_")))
json.dump(man, open(tiles + "manifest.json", "w"))
print("tiles changed per level:", changed)
