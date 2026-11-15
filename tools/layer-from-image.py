#!/usr/bin/env python3
"""
Makes (or replaces) one map layer from one whole image, so a regional map can be a layer of its own
instead of fragments cut out around the other layers.

  python3 tools/layer-from-image.py <tiles folder> <layer id> <image.png> <scale> <tx> <ty>
        [--levels 2,1] [--after <layer id>] [--default] [--feather px] [--name-sv ..] [--name-en ..]

 - <tiles folder>: e.g. src/main/resources/static/weather/tiles/mundana-1 (its manifest.json must have the layer
   list and, for each layer, the "map" rectangle; the layer is replaced if it exists, added last otherwise).
 - <scale>, <tx>, <ty>: where the image lies, in the pixels of zoom level 2 (the manifest's level with
   the smallest width): one image pixel is <scale> level-2 pixels, and the image's first pixel is at
   (<tx>, <ty>) in the level-2 picture. Find them by matching the image against the picture.
 - --levels: which zoom levels to make (2 must be one of them). Level 0 is full size (43807 px across the world),
   each level up halves it. An image that is sharper than level 0 can have level -1 (twice full size); the manifest
   gets that level, and the page uses it when zoomed in far enough. Default: 2,1 (for an image about as sharp as level 1).
 - --after: put the layer right above that layer (layers are drawn in list order); otherwise a new layer goes last
   and an existing one keeps its place.
 - --default: the layer shows when nothing is chosen (a new layer is off by default).
 - --feather: how many image pixels the edge fades over (default 4).
Writes layers/<id>/<level>/{x}_{y}.webp (see-through outside the image) and layers/<id>/map.webp (the layer's part of the
map picture), and updates manifest.json.
"""
import json, os, shutil, sys
import cv2, numpy as np
from PIL import Image
from scipy import ndimage as ndi

Image.MAX_IMAGE_PIXELS = None
args = sys.argv[1:]
opt = {}
for k in ("--feather", "--name-sv", "--name-en", "--levels", "--after"):
    if k in args:
        i = args.index(k); opt[k] = args[i + 1]; args = args[:i] + args[i + 2:]
make_default = "--default" in args
args = [a for a in args if a != "--default"]
tiles, lid, imgf = args[0].rstrip("/") + "/", args[1], args[2]
s2, tx2, ty2 = float(args[3]), float(args[4]), float(args[5])
feather = float(opt.get("--feather", 4))
levels = sorted({int(v) for v in opt.get("--levels", "2,1").split(",")})
if 2 not in levels:
    sys.exit("--levels must include 2 (the map picture is made from it)")
man = json.load(open(tiles + "manifest.json"))
TS = man["tileSize"]
rect = man["layers"][0]["map"]                      # all layers share the rectangle of the map picture
LF = levels[0]                                      # the finest level asked for
N = 2 - LF                                          # halvings from the finest level to level 2

im = Image.open(imgf).convert("RGBA")
A = np.asarray(im).astype(np.float32)
h, w = A.shape[:2]
alpha = A[..., 3] / 255.0
# fade the edge: distance (in image pixels) to the nearest transparent or outside pixel
pad = np.pad(alpha > 0.5, 1, constant_values=False)
dist = ndi.distance_transform_edt(pad)[1:-1, 1:-1]
alpha = alpha * np.clip(dist / max(feather, 0.01), 0, 1)
P = np.dstack([A[..., :3] * alpha[..., None], alpha])          # premultiplied

# the finest canvas, on the tile grid (pixel-centre convention: u(L-1) = 2*u(L) + 0.5)
sf = s2 * 2 ** N
gx0 = 2 ** N * tx2 + 0.5 * (2 ** N - 1)
gy0 = 2 ** N * ty2 + 0.5 * (2 ** N - 1)
grid = TS * 2 ** N                                   # one level-2 piece, in finest-level pixels: every level then lines up
cx0, cy0 = int(gx0 // grid) * grid, int(gy0 // grid) * grid
cx1, cy1 = int(np.ceil((gx0 + sf * w) / grid)) * grid, int(np.ceil((gy0 + sf * h) / grid)) * grid
CW, CH = cx1 - cx0, cy1 - cy0
M = np.float32([[sf, 0, gx0 - cx0], [0, sf, gy0 - cy0]])
interp = cv2.INTER_AREA if sf < 0.5 else cv2.INTER_CUBIC
if sf < 0.5:                                         # shrinking: shrink first (warpAffine alone would alias)
    k = sf
    Ps = cv2.resize(P, None, fx=k, fy=k, interpolation=cv2.INTER_AREA)
    M = np.float32([[1, 0, gx0 - cx0], [0, 1, gy0 - cy0]])
    # place the shrunk image at the sub-pixel offset
    CF = cv2.warpAffine(Ps, M, (CW, CH), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))
else:
    CF = cv2.warpAffine(P, M, (CW, CH), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))
CF[..., 3] = np.clip(CF[..., 3], 0, 1)
CF[..., :3] = np.clip(CF[..., :3], 0, 255 * CF[..., 3:4])
canv = {LF: (CF, cx0, cy0)}
for L in range(LF + 1, 3):
    prev, ox, oy = canv[L - 1]
    canv[L] = (cv2.resize(prev, (prev.shape[1] // 2, prev.shape[0] // 2), interpolation=cv2.INTER_AREA), ox // 2, oy // 2)


def to_rgba(C):
    a = C[..., 3:4]
    rgb = np.where(a > 1e-4, C[..., :3] / np.maximum(a, 1e-4), 0)
    return Image.fromarray(np.dstack([np.clip(rgb, 0, 255), np.clip(a * 255, 0, 255)]).round().astype(np.uint8), "RGBA")


out = tiles + "layers/" + lid + "/"
shutil.rmtree(out, ignore_errors=True)
listed = {}
for lvl in levels:
    C, ox, oy = canv[lvl]
    os.makedirs(out + str(lvl), exist_ok=True)
    have = []
    for ty in range(oy // TS, (oy + C.shape[0]) // TS):
        for tx in range(ox // TS, (ox + C.shape[1]) // TS):
            part = C[ty * TS - oy:(ty + 1) * TS - oy, tx * TS - ox:(tx + 1) * TS - ox]
            if part[..., 3].max() < 0.004:
                continue
            to_rgba(part).save(out + f"{lvl}/{tx}_{ty}.webp", "WEBP", quality=84, method=4)
            have.append(f"{tx}_{ty}")
    listed[str(lvl)] = have
    print("level", lvl, len(have), "pieces")
for lvl in (2, 1, 0):
    listed.setdefault(str(lvl), [])
if LF < 0:
    # the manifest lists every level the page may use; a finer level than 0 doubles the size of the one before it and is
    # marked "extra": the page draws it on top (only layers sharp enough have pieces there) and never counts on it being complete
    have_levels = {l["level"] for l in man["levels"]}
    base0 = next(l for l in man["levels"] if l["level"] == 0)
    for lvl in range(-1, LF - 1, -1):
        if lvl not in have_levels:
            f = 2 ** (-lvl)
            man["levels"].append({"level": lvl, "width": base0["width"] * f, "height": base0["height"] * f, "tiles": [], "extra": True})
    man["levels"].sort(key=lambda l: -l["level"])

# the layer's part of the map picture (map pixels = level 2 / 2), over the shared rectangle
C2, ox2, oy2 = canv[2]
R = np.zeros((rect["h"] * 2, rect["w"] * 2, 4), np.float32)
ox, oy = ox2 - rect["x"] * 2, oy2 - rect["y"] * 2
sx0, sy0 = max(0, -ox), max(0, -oy)
dx0, dy0 = max(0, ox), max(0, oy)
ww = min(C2.shape[1] - sx0, R.shape[1] - dx0); hh = min(C2.shape[0] - sy0, R.shape[0] - dy0)
R[dy0:dy0 + hh, dx0:dx0 + ww] = C2[sy0:sy0 + hh, sx0:sx0 + ww]
Rm = cv2.resize(R, (rect["w"], rect["h"]), interpolation=cv2.INTER_AREA)
to_rgba(Rm).save(out + "map.webp", "WEBP", quality=86, method=4)

layer = next((l for l in man["layers"] if l["id"] == lid), None)
if layer is None:
    layer = {"id": lid, "name": {"sv": opt.get("--name-sv", lid), "en": opt.get("--name-en", lid)}, "default": make_default, "map": rect}
    man["layers"].append(layer)
elif make_default:
    layer["default"] = True
if "--name-sv" in opt or "--name-en" in opt:
    layer["name"] = {"sv": opt.get("--name-sv", layer["name"]["sv"]), "en": opt.get("--name-en", layer["name"]["en"])}
if "--after" in opt:
    man["layers"].remove(layer)
    idx = next(i for i, l in enumerate(man["layers"]) if l["id"] == opt["--after"])
    man["layers"].insert(idx + 1, layer)
layer["tiles"] = listed
layer["map"] = rect
json.dump(man, open(tiles + "manifest.json", "w"), ensure_ascii=False, separators=(",", ":"))
print("layer", lid, "written; image covers level-2 px", tx2, ty2, "to", tx2 + s2 * w, ty2 + s2 * h)
