#!/usr/bin/env python3
"""
Moves one piece (e.g. a small regional inset) of a map layer to another place, without touching the rest of the layer.

  python3 tools/move-layer-piece.py <tiles folder> <layer id> <x> <y> <w> <h> <dx> <dy>

 - x y w h: the piece's box in full-size pixels (zoom level 0; the map picture is 1/8 of that). Everything that is
   not see-through inside the box moves; it must not touch another piece.
 - dx dy: how far to move it, in full-size pixels (8 of them are one pixel of the map picture).
Only the zoom pieces and the part of the map picture that the old and new boxes touch are rewritten
(levels 2, 1, 0 and layers/<id>/map.webp), and manifest.json is updated.
"""
import json, os, sys
import cv2, numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
tiles, lid = sys.argv[1].rstrip("/") + "/", sys.argv[2]
X, Y, W, H, DX, DY = (int(float(v)) for v in sys.argv[3:9])
man = json.load(open(tiles + "manifest.json"))
TS = man["tileSize"]
layer = next(l for l in man["layers"] if l["id"] == lid)
base = tiles + "layers/" + lid + "/"
rect = layer["map"]
G = TS * 4                                         # region grid: one level-2 piece, so every level lines up

# the region that changes: old and new box, grown to the grid
x0 = min(X, X + DX) - 8; y0 = min(Y, Y + DY) - 8
x1 = max(X + W, X + DX + W) + 8; y1 = max(Y + H, Y + DY + H) + 8
rx0, ry0 = x0 // G * G, y0 // G * G
rx1, ry1 = -(-x1 // G) * G, -(-y1 // G) * G
CW, CH = rx1 - rx0, ry1 - ry0
canvas = np.zeros((CH, CW, 4), np.uint8)
for k in layer["tiles"].get("0", []):
    tx, ty = map(int, k.split("_"))
    if tx * TS < rx1 and (tx + 1) * TS > rx0 and ty * TS < ry1 and (ty + 1) * TS > ry0:
        t = np.asarray(Image.open(base + "0/" + k + ".webp").convert("RGBA"))
        canvas[ty * TS - ry0:(ty + 1) * TS - ry0, tx * TS - rx0:(tx + 1) * TS - rx0] = t

# cut the piece out and put it down again
box = (slice(Y - ry0, Y - ry0 + H), slice(X - rx0, X - rx0 + W))
piece = canvas[box].copy()
if piece[..., 3].max() == 0:
    sys.exit("nothing in that box")
canvas[box] = 0
nb = (slice(Y + DY - ry0, Y + DY - ry0 + H), slice(X + DX - rx0, X + DX - rx0 + W))
dest = canvas[nb]
if dest[..., 3].max() > 0:
    sys.exit("the new place is not empty (another piece is there)")
canvas[nb] = piece


def premult(a):
    f = a.astype(np.float32); f[..., :3] *= f[..., 3:4] / 255.0; return f


def unpremult(f):
    a = f[..., 3:4]
    rgb = np.where(a > 0.5, f[..., :3] * 255.0 / np.maximum(a, 0.5), 0)
    return Image.fromarray(np.dstack([np.clip(rgb, 0, 255), np.clip(a, 0, 255)]).round().astype(np.uint8), "RGBA")


P0 = premult(canvas)
changed = [(X, Y, X + W, Y + H), (X + DX, Y + DY, X + DX + W, Y + DY + H)]
for lvl in (0, 1, 2):
    f = 2 ** lvl
    C = P0 if lvl == 0 else cv2.resize(P0, (CW // f, CH // f), interpolation=cv2.INTER_AREA)
    ox, oy = rx0 // f, ry0 // f
    os.makedirs(base + str(lvl), exist_ok=True)
    have = set(layer["tiles"].get(str(lvl), []))
    touched = set()
    for (a, b, c, d) in changed:
        for ty in range(max(0, (b // f - 2) // TS), (d // f + 2) // TS + 1):
            for tx in range(max(0, (a // f - 2) // TS), (c // f + 2) // TS + 1):
                touched.add((tx, ty))
    for tx, ty in sorted(touched):
        sx, sy = tx * TS - ox, ty * TS - oy
        if sx < 0 or sy < 0 or sx + TS > C.shape[1] or sy + TS > C.shape[0]:
            continue
        part = C[sy:sy + TS, sx:sx + TS]
        key = f"{tx}_{ty}"
        path = base + f"{lvl}/{key}.webp"
        if part[..., 3].max() < 1:
            if key in have:
                have.discard(key)
                if os.path.exists(path): os.remove(path)
            continue
        unpremult(part).save(path, "WEBP", quality=84, method=4)
        have.add(key)
    layer["tiles"][str(lvl)] = sorted(have, key=lambda s: tuple(map(int, s.split("_"))))
    print("level", lvl, "pieces now", len(have))

# the layer's part of the map picture: redo the parts under the old and new box
patch = np.asarray(Image.open(base + "map.webp").convert("RGBA")).copy()
C8 = cv2.resize(P0, (CW // 8, CH // 8), interpolation=cv2.INTER_AREA)
img8 = np.asarray(unpremult(C8)).copy()
for (a, b, c, d) in changed:
    ax, ay, bx, by = a // 8 - 3, b // 8 - 3, -(-c // 8) + 3, -(-d // 8) + 3
    for my in range(ay, by):
        for mx in range(ax, bx):
            px, py = mx - rect["x"], my - rect["y"]
            ix, iy = mx - rx0 // 8, my - ry0 // 8
            if 0 <= px < patch.shape[1] and 0 <= py < patch.shape[0] and 0 <= ix < img8.shape[1] and 0 <= iy < img8.shape[0]:
                patch[py, px] = img8[iy, ix]
Image.fromarray(patch, "RGBA").save(base + "map.webp", "WEBP", quality=86, method=4)
json.dump(man, open(tiles + "manifest.json", "w"), ensure_ascii=False, separators=(",", ":"))
print("moved", (X, Y, W, H), "by", (DX, DY))
