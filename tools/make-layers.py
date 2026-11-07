#!/usr/bin/env python3
"""
Makes the map layers ("Kartbild") for the default map: the base map, and each regional map as its own
see-through layer, so the app can show any of them on top of the base map.

  python3 tools/make-layers.py <tiles folder> <map.jpg> <base tiles folder> <base map image> <layers.json>

 - <tiles folder>, <map.jpg>: the combined zoom images and map picture (all default layers put in with
   tools/insert-map.py; the app shows these when exactly the default layers are chosen).
 - <base tiles folder>, <base map image>: the same before any regional map was put in.
 - layers.json: {"layers": [{"id": "jargien", "name": {"sv": "Jargien", "en": "Jargien"}, "default": true,
       "pieces": [{"file": "jargien.png", "x": 2752, "y": 742.5, "sx": 7.92, "sy": 8.23,
                   "mask": "mask.png", "feather": 1.5}, ...]}, ...]}
   in drawing order (later layers lie on top); x, y, sx, sy, mask and feather as for insert-map.py.
Writes:
 - <tiles>/base/{level}/{x}_{y}.jpg: the base map's zoom images where they differ from the combined ones,
   and base/map.jpg, the base map picture over the area the regional maps cover;
 - <tiles>/layers/<id>/{level}/{x}_{y}.webp: the layer's zoom images, see-through outside the map,
   and layers/<id>/map.webp, its part of the map picture;
 - manifest.json: "base" and "layers", listing all of this.
"""
import json, os, shutil, sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

Image.MAX_IMAGE_PIXELS = None
tiles, mapjpg, btiles, bmap, spec = sys.argv[1:6]
tiles = tiles.rstrip("/") + "/"; btiles = btiles.rstrip("/") + "/"
man = json.load(open(tiles + "manifest.json"))
bman = json.load(open(btiles + "manifest.json"))
layers = json.load(open(spec))["layers"]
ts = man["tileSize"]
W1, H1 = Image.open(mapjpg).size


class Piece:
    def __init__(self, p):
        self.P = np.asarray(Image.open(p["file"]).convert("RGB")).astype(np.float32)
        self.ph, self.pw = self.P.shape[:2]
        self.X, self.Y, self.SX, self.SY = float(p["x"]), float(p["y"]), float(p["sx"]), float(p["sy"])
        M = np.ones((self.ph, self.pw), np.float32)
        if p.get("mask"):
            M = np.asarray(Image.open(p["mask"]).convert("L")).astype(np.float32) / 255.0
        inside = M > 0.5
        fx = (self.SX + self.SY) / 2 * float(p.get("feather", 1.5))
        self.M = np.clip(ndi.distance_transform_edt(inside) / max(fx, 1e-6), 0, 1) * inside

    def box(self):
        return self.X, self.Y, self.X + self.pw / self.SX, self.Y + self.ph / self.SY

    def at(self, f):
        """The piece and its weight at f× the map: (x0, y0, rgb, alpha) in that image's pixels (as insert-map.py)."""
        x0, y0 = self.X * f, self.Y * f
        w, h = self.pw / self.SX * f, self.ph / self.SY * f
        ix0, iy0 = int(np.floor(x0)), int(np.floor(y0))
        ow, oh = int(np.ceil(x0 + w)) - ix0, int(np.ceil(y0 + h)) - iy0
        gx = (np.arange(ow) + ix0 + 0.5 - x0) / f * self.SX - 0.5
        gy = (np.arange(oh) + iy0 + 0.5 - y0) / f * self.SY - 0.5
        scale = self.SX / f
        src, msk = self.P, self.M
        if scale > 1.5:
            sig = scale / 2.5
            src = np.stack([ndi.gaussian_filter(self.P[..., c], sig) for c in range(3)], -1)
            msk = ndi.gaussian_filter(self.M, sig)
        yy, xx = np.meshgrid(gy, gx, indexing="ij")
        rgb = np.stack([ndi.map_coordinates(src[..., c], [yy, xx], order=1, mode="nearest") for c in range(3)], -1)
        a = ndi.map_coordinates(msk, [yy, xx], order=1, mode="constant", cval=0)
        a[(yy < -0.5) | (yy > self.ph - 0.5) | (xx < -0.5) | (xx > self.pw - 0.5)] = 0
        return ix0, iy0, rgb, np.clip(a, 0, 1)


def over(acc, key, shape, x0, y0, rgb, a):
    """Lays rgb/alpha over the (premultiplied) accumulator for one image at offset x0, y0."""
    if key not in acc:
        acc[key] = (np.zeros(shape + (3,), np.float32), np.zeros(shape, np.float32))
    C, A = acc[key]
    h, w = a.shape
    C[y0:y0 + h, x0:x0 + w] = rgb * a[..., None] + C[y0:y0 + h, x0:x0 + w] * (1 - a[..., None])
    A[y0:y0 + h, x0:x0 + w] = a + A[y0:y0 + h, x0:x0 + w] * (1 - a)


def save_rgba(C, A, path):
    rgb = np.where(A[..., None] > 1e-4, C / np.maximum(A[..., None], 1e-4), 0)
    im = np.dstack([np.clip(rgb, 0, 255), np.clip(A * 255, 0, 255)]).round().astype(np.uint8)
    Image.fromarray(im, "RGBA").save(path, "WEBP", quality=88, method=5)


for d in ("base", "layers", "views"):
    shutil.rmtree(tiles + d, ignore_errors=True)
pieces = {L["id"]: [Piece(p) for p in L.get("pieces", [])] for L in layers}
# the area all regional maps cover (for the map picture)
bx = [p.box() for ps in pieces.values() for p in ps]
fx0, fy0 = max(0, int(min(b[0] for b in bx)) - 4), max(0, int(min(b[1] for b in bx)) - 4)
fx1, fy1 = min(W1, int(max(b[2] for b in bx)) + 5), min(H1, int(max(b[3] for b in bx)) + 5)
mapbox = {"x": fx0, "y": fy0, "w": fx1 - fx0, "h": fy1 - fy0}

# ── base: zoom images that differ from the combined ones, and the map picture over the area ──
base = {"tiles": {}, "hide": {}, "map": mapbox}
for L in man["levels"]:
    lv = str(L["level"])
    mine = set(next(x for x in bman["levels"] if x["level"] == L["level"])["tiles"])
    use, hide = [], []
    for k in sorted(mine | set(L["tiles"])):
        a, b = btiles + lv + "/" + k + ".jpg", tiles + lv + "/" + k + ".jpg"
        if k not in mine: hide.append(k); continue
        if k in L["tiles"] and open(a, "rb").read() == open(b, "rb").read(): continue
        os.makedirs(tiles + "base/" + lv, exist_ok=True)
        shutil.copy(a, tiles + "base/" + lv + "/" + k + ".jpg")
        use.append(k)
    if use: base["tiles"][lv] = use
    if hide: base["hide"][lv] = hide
Image.open(bmap).convert("RGB").crop((fx0, fy0, fx1, fy1)).save(tiles + "base/map.jpg", quality=92)
print("base", {k: len(v) for k, v in base["tiles"].items()}, "hidden", {k: len(v) for k, v in base["hide"].items()})

# ── each layer: see-through zoom images and its part of the map picture ──
out = []
for Ly in layers:
    lid, ps = Ly["id"], pieces[Ly["id"]]
    od = tiles + "layers/" + lid + "/"
    entry = {"id": lid, "name": Ly["name"], "default": bool(Ly.get("default")), "tiles": {}}
    for L in man["levels"]:
        lv, f = str(L["level"]), L["width"] / W1
        acc = {}
        for p in ps:
            ix0, iy0, rgb, a = p.at(f)
            for ty in range(max(0, iy0 // ts), (iy0 + rgb.shape[0] - 1) // ts + 1):
                for tx in range(max(0, ix0 // ts), (ix0 + rgb.shape[1] - 1) // ts + 1):
                    x0, y0 = max(ix0, tx * ts), max(iy0, ty * ts)
                    x1, y1 = min(ix0 + rgb.shape[1], (tx + 1) * ts, L["width"]), min(iy0 + rgb.shape[0], (ty + 1) * ts, L["height"])
                    if x1 <= x0 or y1 <= y0: continue
                    aa = a[y0 - iy0:y1 - iy0, x0 - ix0:x1 - ix0]
                    if aa.max() <= 0.01: continue
                    tw, th = min(ts, L["width"] - tx * ts), min(ts, L["height"] - ty * ts)
                    over(acc, f"{tx}_{ty}", (th, tw), x0 - tx * ts, y0 - ty * ts, rgb[y0 - iy0:y1 - iy0, x0 - ix0:x1 - ix0], aa)
        os.makedirs(od + lv, exist_ok=True)
        for k, (C, A) in acc.items():
            save_rgba(C, A, od + lv + "/" + k + ".webp")
        entry["tiles"][lv] = sorted(acc, key=lambda k: tuple(int(v) for v in k.split("_")))
    acc = {}
    for p in ps:
        ix0, iy0, rgb, a = p.at(1.0)
        over(acc, "m", (fy1 - fy0, fx1 - fx0), ix0 - fx0, iy0 - fy0, rgb, a)
    save_rgba(*acc["m"], od + "map.webp")
    entry["map"] = mapbox
    out.append(entry)
    print(lid, {k: len(v) for k, v in entry["tiles"].items()})
man.pop("views", None)
man["base"] = base
man["layers"] = out
json.dump(man, open(tiles + "manifest.json", "w"))
