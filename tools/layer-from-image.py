#!/usr/bin/env python3
"""
Makes (or replaces) one map layer from one whole image, so a regional map can be a layer of its own
instead of fragments cut out around the other layers.

  python3 tools/layer-from-image.py <tiles folder> <layer id> <image.png> <scale> <tx> <ty> [--feather px] [--name-sv ..] [--name-en ..]

 - <tiles folder>: e.g. src/main/resources/static/weather/tiles/mundana-1 (its manifest.json must have the layer
   list and, for each layer, the "map" rectangle; the layer is replaced if it exists, added last otherwise).
 - <scale>, <tx>, <ty>: where the image lies, in the pixels of zoom level 2 (the manifest's level with
   the smallest width): one image pixel is <scale> level-2 pixels, and the image's first pixel is at
   (<tx>, <ty>) in the level-2 picture. Find them by matching the image against the picture (SIFT + a similarity fit).
 - --feather: how many image pixels the edge fades over (default 4).
Writes layers/<id>/{2,1}/{x}_{y}.webp (see-through outside the image) and layers/<id>/map.webp (the layer's part of the
map picture), and updates manifest.json. Level 0 is left out when the image is less sharp than level 1: the page
then stretches the level-1 pieces, which is what it would do with level-0 pieces made from this image.
"""
import json, os, shutil, sys
import cv2, numpy as np
from PIL import Image
from scipy import ndimage as ndi

Image.MAX_IMAGE_PIXELS = None
args = sys.argv[1:]
opt = {}
for k in ("--feather", "--name-sv", "--name-en"):
    if k in args:
        i = args.index(k); opt[k] = args[i + 1]; args = args[:i] + args[i + 2:]
tiles, lid, imgf = args[0].rstrip("/") + "/", args[1], args[2]
s2, tx2, ty2 = float(args[3]), float(args[4]), float(args[5])
feather = float(opt.get("--feather", 4))
man = json.load(open(tiles + "manifest.json"))
TS = man["tileSize"]
rect = man["layers"][0]["map"]                      # all layers share the rectangle of the map picture

im = Image.open(imgf).convert("RGBA")
A = np.asarray(im).astype(np.float32)
h, w = A.shape[:2]
alpha = A[..., 3] / 255.0
# fade the edge: distance (in image pixels) to the nearest transparent or outside pixel
pad = np.pad(alpha > 0.5, 1, constant_values=False)
dist = ndi.distance_transform_edt(pad)[1:-1, 1:-1]
alpha = alpha * np.clip(dist / max(feather, 0.01), 0, 1)
P = np.dstack([A[..., :3] * alpha[..., None], alpha])          # premultiplied

# level 1 canvas on the tile grid (pixel-centre convention: u1 = 2*u2 + 0.5)
s1 = 2 * s2
gx0, gy0 = 2 * tx2 + 0.5, 2 * ty2 + 0.5
cx0, cy0 = int(gx0 // (2 * TS)) * 2 * TS, int(gy0 // (2 * TS)) * 2 * TS   # multiples of 2 tiles so level 2 lines up
cx1, cy1 = int(np.ceil((gx0 + s1 * w) / (2 * TS))) * 2 * TS, int(np.ceil((gy0 + s1 * h) / (2 * TS))) * 2 * TS
CW, CH = cx1 - cx0, cy1 - cy0
M = np.float32([[s1, 0, gx0 - cx0], [0, s1, gy0 - cy0]])
C1 = cv2.warpAffine(P, M, (CW, CH), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))
C1[..., 3] = np.clip(C1[..., 3], 0, 1)
C1[..., :3] = np.clip(C1[..., :3], 0, 255 * C1[..., 3:4])
C2 = cv2.resize(C1, (CW // 2, CH // 2), interpolation=cv2.INTER_AREA)


def to_rgba(C):
    a = C[..., 3:4]
    rgb = np.where(a > 1e-4, C[..., :3] / np.maximum(a, 1e-4), 0)
    return Image.fromarray(np.dstack([np.clip(rgb, 0, 255), np.clip(a * 255, 0, 255)]).round().astype(np.uint8), "RGBA")


out = tiles + "layers/" + lid + "/"
shutil.rmtree(out, ignore_errors=True)
listed = {}
for lvl, C, ox, oy in ((2, C2, cx0 // 2, cy0 // 2), (1, C1, cx0, cy0)):
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
listed["0"] = []

# the layer's part of the map picture (map pixels = level 2 / 2), over the shared rectangle
R = np.zeros((rect["h"] * 2, rect["w"] * 2, 4), np.float32)
ox, oy = cx0 // 2 - rect["x"] * 2, cy0 // 2 - rect["y"] * 2
sx0, sy0 = max(0, -ox), max(0, -oy)
dx0, dy0 = max(0, ox), max(0, oy)
ww = min(C2.shape[1] - sx0, R.shape[1] - dx0); hh = min(C2.shape[0] - sy0, R.shape[0] - dy0)
R[dy0:dy0 + hh, dx0:dx0 + ww] = C2[sy0:sy0 + hh, sx0:sx0 + ww]
Rm = cv2.resize(R, (rect["w"], rect["h"]), interpolation=cv2.INTER_AREA)
to_rgba(Rm).save(out + "map.webp", "WEBP", quality=86, method=4)

layer = next((l for l in man["layers"] if l["id"] == lid), None)
if layer is None:
    layer = {"id": lid, "name": {"sv": opt.get("--name-sv", lid), "en": opt.get("--name-en", lid)}, "default": False, "map": rect}
    man["layers"].append(layer)
if "--name-sv" in opt or "--name-en" in opt:
    layer["name"] = {"sv": opt.get("--name-sv", layer["name"]["sv"]), "en": opt.get("--name-en", layer["name"]["en"])}
layer["tiles"] = listed
layer["map"] = rect
json.dump(man, open(tiles + "manifest.json", "w"), ensure_ascii=False, separators=(",", ":"))
print("layer", lid, "written; image covers level-2 px", tx2, ty2, "to", tx2 + s2 * w, ty2 + s2 * h)
