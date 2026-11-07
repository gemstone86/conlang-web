#!/usr/bin/env python3
"""
Corrects coastlines in a height map using the sharper zoom images, where there are any.

  python3 tools/coast-from-tiles.py <tiles folder> <height.png> <out.png> [--keep <edited.png> <old.png> ...]

The zoom images (level 2, twice the map's size) show pale shallow water and lake shores that the
map image blurs into the land. Water there is told apart by its colour (bluer than it is red,
and not much less blue than green); a 2×2 block counts as water when most of it is.
 - land that the zoom images clearly show as water becomes water, but only when it joins water
   that is already there (so bluish shadows inland don't become lakes); its depth comes from the
   nearest old water, at least 1 step below sea level
 - sea next to the coast that the zoom images clearly show as land becomes low land
 - near the poles nothing is changed (the ice is bluish white too)
 - with --keep, pixels where an edited export differs from the map it was painted on stay as they are
Sea level is grey 120.
"""
import json, sys, numpy as np
from PIL import Image
from scipy import ndimage as ndi

args = sys.argv[1:]
keeps = []
while "--keep" in args:
    i = args.index("--keep")
    keeps.append((args[i + 1], args[i + 2]))
    args = args[:i] + args[i + 3:]
tiles, src, out = args
tiles = tiles.rstrip("/") + "/"
SEA = 120

h = np.asarray(Image.open(src).convert("L")).astype(np.int16)
H, W = h.shape
m = json.load(open(tiles + "manifest.json"))
L2 = [l for l in m["levels"] if l["level"] == 2][0]
f = L2["width"] / W
votes = np.zeros((H, W), np.float32)
cover = np.zeros((H, W), bool)
for t in L2["tiles"]:
    tx, ty = map(int, t.split("_"))
    im = np.asarray(Image.open(f"{tiles}2/{t}.jpg").convert("RGB")).astype(np.int16)
    r, g, b = im[..., 0], im[..., 1], im[..., 2]
    water = ((b - r) > 8) & ((b - g) > -14)
    water = ndi.median_filter(water.astype(np.uint8), 3).astype(bool)
    hh, ww = water.shape
    hb, wb = hh // 2, ww // 2
    blk = water[:hb * 2, :wb * 2].reshape(hb, 2, wb, 2).mean((1, 3))
    x0, y0 = int(round(tx * 512 / f)), int(round(ty * 512 / f))
    hb, wb = min(hb, H - y0), min(wb, W - x0)
    votes[y0:y0 + hb, x0:x0 + wb] = blk[:hb, :wb]
    cover[y0:y0 + hb, x0:x0 + wb] = True
cover = ndi.binary_erosion(cover, iterations=2)
yy = np.arange(H)[:, None] / H
cover &= (yy > 0.16) & (yy < 0.84)
votes = ndi.uniform_filter(votes, 3)
tw, tl = cover & (votes > 0.6), cover & (votes < 0.25)

oldW = h <= SEA
keep = np.zeros((H, W), bool)
for a, b_ in keeps:
    A = np.asarray(Image.open(a).convert("L")); B = np.asarray(Image.open(b_).convert("L"))
    keep |= A != B
keep = ndi.binary_dilation(keep, iterations=2)

cand = oldW | (tw & ~keep)
lab, n = ndi.label(cand)
ok = np.zeros(n + 1, bool); ok[np.unique(lab[oldW])] = True; ok[0] = False
newW = ok[lab] & ~oldW
newL = tl & oldW & (ndi.distance_transform_edt(oldW) <= 6) & ~keep

res = h.copy()
idx = ndi.distance_transform_edt(~oldW, return_distances=False, return_indices=True)
near = h[tuple(idx)]
res[newW] = np.minimum(SEA - 1, np.maximum(near[newW], SEA - 4))
res[newL] = SEA + 1
Image.fromarray(res.astype(np.uint8), "L").save(out, optimize=True)
print("to water", int(newW.sum()), "px, to land", int(newL.sum()), "px")
