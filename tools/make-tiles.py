#!/usr/bin/env python3
"""
Turns a huge map image into the default map's picture plus sharp zoom tiles.

  python3 tools/make-tiles.py <full-size-map.jpg> <tile-folder-name>   e.g. mundana-2

Writes src/main/resources/default-map/map.jpg (the map shrunk to 1/8) and
src/main/resources/static/weather/tiles/<name>/ (tiles at 1/4, 1/2 and full size, only where the
full-size map has more detail than the shrunk one, plus manifest.json).
Then set "tiles": "tiles/<name>/" in default-map/map.json, and scale kmPerPixel and wrapWidth
to the new map.jpg width. Needs vips (libvips) and pip packages pyvips, numpy, scipy.
"""
import json, os, shutil, sys, tempfile
import numpy as np, pyvips
from scipy.ndimage import binary_dilation

src, name = sys.argv[1], sys.argv[2]
root = os.path.join(os.path.dirname(__file__), "..", "src", "main", "resources")
out = os.path.join(root, "static", "weather", "tiles", name)
tmp = tempfile.mkdtemp()
TS, BLOCK, THRESHOLD = 512, 256, 1.5

pyvips.Image.new_from_file(src).write_to_file(os.path.join(tmp, "full.v"))
full = pyvips.Image.new_from_file(os.path.join(tmp, "full.v"))

# the base picture: 1/8 size
base = full.shrink(8, 8)
base.write_to_file(os.path.join(tmp, "b8.v"))
base = pyvips.Image.new_from_file(os.path.join(tmp, "b8.v"))
base.jpegsave(os.path.join(root, "default-map", "map.jpg"), Q=86, optimize_coding=True, strip=True)

# where does the full map have detail the base picture lacks?
up = base.resize(8, kernel="linear").embed(0, 0, full.width, full.height, extend="copy")
det = (full - up).abs().bandmean().cast("float").shrink(BLOCK, BLOCK)
det = np.frombuffer(det.write_to_memory(), dtype=np.float32).reshape(det.height, det.width)
mask = binary_dilation(det > THRESHOLD, iterations=1)

shutil.rmtree(out, ignore_errors=True)
levels = []
srcs = {0: full}
for L in (1, 2):
    p = os.path.join(tmp, f"l{L}.v")
    full.shrink(2 ** L, 2 ** L).write_to_file(p)
    srcs[L] = pyvips.Image.new_from_file(p)
for L in (2, 1, 0):
    img, span = srcs[L], TS * 2 ** L
    os.makedirs(os.path.join(out, str(L)), exist_ok=True)
    have = []
    for ty in range((img.height + TS - 1) // TS):
        for tx in range((img.width + TS - 1) // TS):
            bx0, by0 = tx * span // BLOCK, ty * span // BLOCK
            bx1, by1 = -(-(tx + 1) * span // BLOCK), -(-(ty + 1) * span // BLOCK)
            if not mask[by0:by1, bx0:bx1].any():
                continue
            x0, y0 = tx * TS, ty * TS
            img.crop(x0, y0, min(TS, img.width - x0), min(TS, img.height - y0)).jpegsave(
                os.path.join(out, str(L), f"{tx}_{ty}.jpg"), Q=82, optimize_coding=True, strip=True)
            have.append(f"{tx}_{ty}")
    levels.append({"level": L, "width": img.width, "height": img.height, "tiles": have})
    print(f"level {L}: {len(have)} tiles")
json.dump({"tileSize": TS, "fullWidth": full.width, "fullHeight": full.height, "levels": levels},
          open(os.path.join(out, "manifest.json"), "w"))
shutil.rmtree(tmp)
print("map.jpg:", base.width, "x", base.height)
