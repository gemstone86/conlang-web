#!/usr/bin/env python3
"""
Makes the map choices ("Kartbild") for the default map: each choice shows the base map with one
regional map (or none) on top, instead of all maps combined.

  python3 tools/make-views.py <tiles folder> <map.jpg> <base tiles folder> <base map image> <views.json>

 - <tiles folder>, <map.jpg>: the combined zoom images and map picture (what the app shows by default).
 - <base tiles folder>, <base map image>: the same before any regional map was put in.
 - views.json: {"views": [{"id": "jargien", "name": {"sv": "Jargien", "en": "Jargien"},
       "pieces": [{"file": "jargien.png", "x": 2752, "y": 742.5, "sx": 7.92, "sy": 8.23,
                   "mask": "mask.png", "feather": 1.5}, ...]}, ...]}
   A choice with no pieces is the plain base map.
For each choice the pieces are put on a copy of the base (with tools/insert-map.py); only the zoom
images that then differ from the combined ones are kept, in <tiles>/views/<id>/{level}/{x}_{y}.jpg,
together with the changed part of the map picture (views/<id>/map.jpg). manifest.json lists the
choices: which zoom images each one replaces or hides, and where its map piece goes.
"""
import json, os, shutil, subprocess, sys, tempfile
import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
tiles, mapjpg, btiles, bmap, spec = sys.argv[1:6]
tiles = tiles.rstrip("/") + "/"; btiles = btiles.rstrip("/") + "/"
here = os.path.dirname(os.path.abspath(__file__))
man = json.load(open(tiles + "manifest.json"))
bman = json.load(open(btiles + "manifest.json"))
views = json.load(open(spec))["views"]
comp_map = np.asarray(Image.open(mapjpg).convert("RGB")).astype(np.int16)
# the map picture only changes where the regional maps lie: one box around all of them, the same
# for every choice (comparing whole pictures would pick up JPEG noise everywhere)
fx0 = fy0 = 1e9; fx1 = fy1 = -1e9
for v in views:
    for p in v.get("pieces", []):
        w, h = Image.open(p["file"]).size
        fx0, fy0 = min(fx0, p["x"]), min(fy0, p["y"])
        fx1, fy1 = max(fx1, p["x"] + w / p["sx"]), max(fy1, p["y"] + h / p["sy"])

out_views = []
shutil.rmtree(tiles + "views", ignore_errors=True)
for v in views:
    vid = v["id"]
    tmp = tempfile.mkdtemp()
    t = tmp + "/tiles/"
    os.makedirs(t)
    for L in bman["levels"]:
        shutil.copytree(btiles + str(L["level"]), t + str(L["level"]))
    shutil.copy(btiles + "manifest.json", t + "manifest.json")
    m = tmp + "/map.jpg"
    Image.open(bmap).convert("RGB").save(m, quality=95)
    for p in v.get("pieces", []):
        cmd = [sys.executable, os.path.join(here, "insert-map.py"), t, m, p["file"], str(p["x"]), str(p["y"]), str(p["sx"]), str(p["sy"])]
        if p.get("mask"): cmd += ["--mask", p["mask"]]
        if p.get("feather") is not None: cmd += ["--feather", str(p["feather"])]
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL)
    vman = json.load(open(t + "manifest.json"))
    od = tiles + "views/" + vid + "/"
    entry = {"id": vid, "name": v["name"], "tiles": {}, "hide": {}}
    for L in man["levels"]:
        lv = str(L["level"])
        mine = set(next(x for x in vman["levels"] if x["level"] == L["level"])["tiles"])
        comb = set(L["tiles"])
        use, hide = [], []
        for k in sorted(mine | comb):
            a, b = t + lv + "/" + k + ".jpg", tiles + lv + "/" + k + ".jpg"
            if k not in mine: hide.append(k); continue
            if k in comb and open(a, "rb").read() == open(b, "rb").read(): continue
            os.makedirs(od + lv, exist_ok=True)
            shutil.copy(a, od + lv + "/" + k + ".jpg")
            use.append(k)
        if use: entry["tiles"][lv] = use
        if hide: entry["hide"][lv] = hide
    # the part of the map picture that differs
    vm = np.asarray(Image.open(m).convert("RGB")).astype(np.int16)
    if fx1 > fx0:
        x0, y0 = max(0, int(fx0) - 4), max(0, int(fy0) - 4)
        x1, y1 = min(vm.shape[1], int(fx1) + 5), min(vm.shape[0], int(fy1) + 5)
        os.makedirs(od, exist_ok=True)
        Image.fromarray(vm[y0:y1, x0:x1].astype(np.uint8)).save(od + "map.jpg", quality=92)
        entry["map"] = {"x": int(x0), "y": int(y0), "w": int(x1 - x0), "h": int(y1 - y0)}
    out_views.append(entry)
    print(vid, {k: len(x) for k, x in entry["tiles"].items()}, "hidden", {k: len(x) for k, x in entry["hide"].items()}, "map", entry.get("map"))
    shutil.rmtree(tmp)
man["views"] = out_views
json.dump(man, open(tiles + "manifest.json", "w"))
