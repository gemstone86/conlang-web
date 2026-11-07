#!/usr/bin/env python3
"""
Draft height map from the painted Mundana map, as a starting point for the in-app height painter.

  python3 tools/draft-height.py <map image> <out.png> [--keep <edited.png> <old-draft.png>]

With --keep, every pixel where <edited.png> (a height map exported from the painter) differs from
<old-draft.png> (the draft it was painted on) keeps the hand-edited value; the rest is drafted anew.

Scale: 0–255 grey, sea level 120, 100 m per step (255 = 13 500 m, 0 = 12 000 m deep).
 - sea: blue pixels; depth from how dark the blue is, plus distance from the coast
 - lakes: small light-blue water inland, shallow (a few hundred metres)
 - land: low plains near the coast, rising gently inland
 - mountains: where the map's shaded relief drawings are (highlights and mid-tone shadows close
   together); map lettering (dark serif text, red and blue names) is painted out first, so names
   don't become hills. In the detailed regional maps, mountains are picked up at a finer scale.
 - ice: white land near the poles, a raised ice sheet
Mountain heights are guesses from how dense the relief drawing is; fix them in the painter.

Version 2: learnt from hand edits (labels flattened, lakes added, ridges in the detailed maps).
Version 3: ice sheets only near the poles; in the detailed regional maps, brown shading with pale
olive highlights on green land counts as mountains (as ridges, not whole areas).
Version 5: sea depth mostly from the distance to the coast, so the paler sea of the regional maps
and the seams between maps no longer make steps and trenches.
Version 4: names cleaned up afterwards with tools/clean-labels.py (letter shapes on the sea, low
name bumps on even land).
"""
import sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

Image.MAX_IMAGE_PIXELS = None
args = sys.argv[1:]
keep = None
if "--keep" in args:
    i = args.index("--keep")
    keep = (args[i + 1], args[i + 2])
    args = args[:i] + args[i + 3:]
src, out = args[0], args[1]

im = Image.open(src).convert("RGB")
W, H = im.size
rgb = np.asarray(im, dtype=np.float32) / 255.0
r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
mx, mn = rgb.max(2), rgb.min(2)
L = (mx + mn) / 2
sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
d = np.maximum(mx - mn, 1e-6)
hue = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60

def drop_small(mask, min_size):
    lab, n = ndi.label(mask)
    if n == 0:
        return mask
    sizes = ndi.sum(mask, lab, index=np.arange(1, n + 1))
    ok = np.zeros(n + 1, bool); ok[1:] = sizes >= min_size
    return ok[lab]

# ── lettering: dark ink strokes, red names, saturated blue names ──
ink = (L < 0.30) & (sat < 0.40)
redText = ((sat > 0.45) & ((hue < 22) | (hue > 330)) & (L < 0.72)) | ((sat > 0.18) & ((hue < 12) | (hue > 300)))  # red names and their pink halo
blueText = (sat > 0.45) & (hue > 200) & (hue < 255) & (L < 0.55)
text = ndi.binary_dilation(ink | redText | blueText, iterations=2)

# ── water and land: sure water is clearly blue, sure land clearly green/beige/brown or ice;
# everything uncertain (lettering, its blurred halo, pale mixed colours) takes the class of the
# nearest sure terrain, so names printed on the sea don't become islands ──
# detailed regional maps: crisp fine detail (the rest is the older map enlarged, so softer)
fine = np.abs(L - ndi.gaussian_filter(L, 1.0))
detailed = ndi.gaussian_filter(fine, 25) > 0.022
detailed = ndi.binary_opening(ndi.binary_closing(detailed, iterations=8), iterations=8)
lettering = ndi.binary_dilation(ink | redText | blueText, iterations=1)
sureWater = (hue > 185) & (hue < 235) & (sat > 0.10) & (b > r + 0.04) & ~lettering
sureWater = ndi.binary_opening(sureWater, iterations=1)
sureLand = ~lettering & ~sureWater & (
    ((hue > 25) & (hue < 175) & (sat > 0.15)) |      # greens, yellows, beige, browns
    ((L > 0.86) & (sat < 0.10)) |                    # ice and snow
    (L < 0.62) & (sat < 0.42) & ~((hue > 185) & (hue < 260)))   # relief shading
dW = ndi.distance_transform_edt(~sureWater)
dL = ndi.distance_transform_edt(~sureLand)
water = sureWater | (~sureLand & (dW < dL))
# small water bodies: real lakes in the detailed maps; elsewhere usually specks or shading
water = np.where(detailed, drop_small(water, 25), drop_small(water, 400))
# lettering lying in the sea is sea too: fill land specks surrounded by water
land = ~water
lab, n = ndi.label(land)
sizes = ndi.sum(land, lab, index=np.arange(1, n + 1))
tiny = np.zeros(n + 1, bool); tiny[1:] = sizes < 150
water |= tiny[lab]
land = ~water
# lakes: water bodies that aren't part of the big seas
lab, n = ndi.label(water)
sizes = ndi.sum(water, lab, index=np.arange(1, n + 1))
lakeIds = np.zeros(n + 1, bool); lakeIds[1:] = sizes < 6000
lake = lakeIds[lab]
sea = water & ~lake

# ── mountains: the relief drawings (white highlights + mid-tone shadows close together) ──
Lf = np.where(text, ndi.median_filter(np.where(text, np.nan_to_num(L), L), 9), L)   # paint lettering out
mean = ndi.uniform_filter(Lf, 7)
var = ndi.uniform_filter(Lf * Lf, 7) - mean * mean
std = np.sqrt(np.maximum(var, 0))
# two drawing styles: white peaks with grey/brown shadows (most of the map), and olive-brown
# shading with pale highlights drawn on green land (the detailed regional maps)
whiteish = (L > 0.78) & (sat < 0.13)
shadow = (L >= 0.30) & (L < 0.62) & (sat < 0.42) & ((hue < 60) | (sat < 0.15))
relief = (std > 0.09) & (whiteish | shadow) & land & ~text
relief &= ndi.maximum_filter(relief & whiteish, 7) & ndi.maximum_filter(relief & shadow, 7)
# the detailed regional maps also draw mountains as brown shading with pale olive highlights on green
oliveLight = (L > 0.62) & (sat < 0.32) & (hue > 20) & (hue < 110)
brownShade = (L >= 0.25) & (L < 0.52) & (sat > 0.10) & (sat < 0.50) & (hue > 18) & (hue < 60)
relief2 = (std > 0.10) & (oliveLight | brownShade) & land & ~text & detailed
relief2 &= ndi.maximum_filter(relief2 & oliveLight, 5) & ndi.maximum_filter(relief2 & brownShade, 5)
relief |= relief2
relief = drop_small(relief, 6)                     # leftover letter edges
rel = relief.astype(np.float32)
density = np.where(detailed,
                   np.clip(ndi.gaussian_filter(rel, 4) / 0.65, 0, 1),     # finer in the detailed maps
                   np.clip(ndi.gaussian_filter(rel, 9) / 0.45, 0, 1))
density = ndi.gaussian_filter(density, 1.5)

# ── ice: very pale, unsaturated land ──
# ice sheets only near the poles (pale plains in the regional maps are not ice)
yy = (np.arange(H)[:, None] + 0.5) / H
polar = np.clip((0.15 - yy) / 0.03, 0, 1) + np.clip((yy - 0.85) / 0.03, 0, 1)
ice = land & (L > 0.86) & (sat < 0.10) & (polar > 0)
ice = ndi.binary_opening(ice, iterations=2)
iceShare = ndi.gaussian_filter(ice.astype(np.float32), 12) * np.clip(polar, 0, 1)

# ── distances from the coast (in pixels) ──
dl = ndi.distance_transform_edt(land)
ds = ndi.distance_transform_edt(sea | lake)

landH = 1 + 5 * (1 - np.exp(-dl / 60))
tex = ndi.gaussian_filter(np.where(relief, Lf, mean), 2)
mountH = 65 * density ** 1.3 * (0.8 + 0.4 * np.clip((tex - 0.35) / 0.5, 0, 1))
mountH = ndi.gaussian_filter(mountH, 2.0)
iceH = 20 * np.clip(iceShare / 0.6, 0, 1)
hLand = landH + np.maximum(mountH, iceH) + 0.4 * np.minimum(mountH, iceH)

# sea depth from the shade of blue (lettering painted out) and the distance from land
# sea names are dark strokes on the blue: anything clearly darker than the water around it
seaText = ndi.binary_dilation((ndi.median_filter(L, 11) - L) > 0.07, iterations=2)
seaL = np.where(sea & ~text & ~seaText, L, np.nan)
fillIdx = ndi.distance_transform_edt(np.isnan(seaL), return_distances=False, return_indices=True)
seaL = seaL[tuple(fillIdx)]
seaL = ndi.gaussian_filter(np.where(sea, seaL, 0.85), 3)
depth = np.clip((0.86 - seaL) / 0.32, 0, 1) * 45 + 15 * (1 - np.exp(-ds / 80))
# the detailed regional maps paint their sea paler, and where one map was pasted onto another the
# shade jumps in straight lines; so the depth mostly follows the distance from the coast and the
# shade only adds local detail, faded out along those straight seams
wS = ndi.gaussian_filter(sea.astype(np.float32), 50) + 1e-4
hp = depth - ndi.gaussian_filter(np.where(sea, depth, 0), 50) / wS
Ls = ndi.gaussian_filter(L, 1.5)
gx = np.abs(np.diff(Ls, axis=1, append=Ls[:, -1:])); gy = np.abs(np.diff(Ls, axis=0, append=Ls[-1:, :]))
seam = ((ndi.uniform_filter1d(gx, 61, axis=0) > 0.012) | (ndi.uniform_filter1d(gy, 61, axis=1) > 0.012)) & sea & (ds > 8)
fade = np.clip((ndi.distance_transform_edt(~ndi.binary_dilation(seam, iterations=3)) - 4) / 30, 0, 1)
depth = 10 + 42 * (1 - np.exp(-ds / 110)) + np.clip(hp, -10, 10) * fade
depth = np.maximum(1, ndi.gaussian_filter(depth, 2))
lakeDepth = np.clip(2 + ds * 0.8, 2, 16)           # shallow lakes: 200 m at the shore, at most 1 600 m

SEA = 120
height = np.where(land, SEA + np.maximum(1, hLand), np.where(lake, SEA - lakeDepth, SEA - depth))
height = np.clip(np.round(height), 0, 255)
height = np.where(land, np.maximum(height, SEA + 1), np.minimum(height, SEA - 1)).astype(np.uint8)

if keep:
    edited = np.asarray(Image.open(keep[0]).convert("L"))
    old = np.asarray(Image.open(keep[1]).convert("L"))
    if edited.shape != height.shape:
        edited = np.asarray(Image.fromarray(edited).resize((W, H), Image.NEAREST))
        old = np.asarray(Image.fromarray(old).resize((W, H), Image.NEAREST))
    touched = edited.astype(int) != old.astype(int)
    touched = ndi.binary_closing(touched, iterations=2)
    # blend over a few pixels around the edits so they don't stand out as steps
    w = np.clip(ndi.distance_transform_edt(~touched) / 4.0, 0, 1)
    height = np.where(touched, edited, np.round(edited * (1 - w) + height * w)).astype(np.uint8)
    print("kept hand edits:", int(touched.sum()), "pixels")

Image.fromarray(height, "L").save(out, optimize=True)
print("height map", W, "x", H, "land", round(land.mean() * 100, 1), "%  lakes", int(lake.sum()), "px  detailed",
      round(detailed.mean() * 100, 1), "%  max", int(height.max()), "min", int(height.min()))
