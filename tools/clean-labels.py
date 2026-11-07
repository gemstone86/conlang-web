#!/usr/bin/env python3
"""
Removes the imprints that map names leave in a height map.

  python3 tools/clean-labels.py <map image> <height.png> <out.png> [--box x0,y0,x1,y1 ...] [--flat x0,y0,x1,y1 ...]

Finds the lettering in the map image (dark serif names, red names with their pink halo, blue
names), joins the letters into words, and fills each word from the terrain around it:
 - names on the sea: always (letters left the sea shallower or deeper in their shape)
 - names on land: when the word stands as a low bump or dip (at most 12 steps) on fairly even
   ground, or as a hill of any height on flat ground, which is what a name looks like, while mountains drawn under a name are left alone
 - inside a --box (map pixels): every word, whatever the ground looks like; higher ground next to
   the name (a mountain symbol) is kept
 - inside a --flat box: the same, but nothing is kept (for names drawn as hills, like Ressiöknen)
Works on hand-edited maps too; only the words change. Land stays land and sea stays sea.
"""
import sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

Image.MAX_IMAGE_PIXELS = None
args = sys.argv[1:]
boxes = []
for opt in ("--box", "--flat"):
    while opt in args:
        i = args.index(opt)
        boxes.append(tuple(int(v) for v in args[i + 1].split(",")) + (opt == "--flat",))
        args = args[:i] + args[i + 2:]
src, hsrc, out = args

h = np.asarray(Image.open(hsrc).convert("L")).astype(np.float32)
H, W = h.shape
im = Image.open(src).convert("RGB")
if im.size != (W, H):
    im = im.resize((W, H), Image.LANCZOS)
rgb = np.asarray(im, dtype=np.float32) / 255.0
r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
mx, mn = rgb.max(2), rgb.min(2)
L = (mx + mn) / 2
sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
d = np.maximum(mx - mn, 1e-6)
hue = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60

SEA = 120
seaPx = h < SEA + 0.5

ink = (L < 0.30) & (sat < 0.40)
red = ((sat > 0.45) & ((hue < 22) | (hue > 330)) & (L < 0.72)) | ((sat > 0.18) & ((hue < 12) | (hue > 300)))
# the pink halo around red names fades into the blue sea as purple-grey: redder than the water
pink = seaPx & (r > b - 0.02) & (hue > 270) | seaPx & (r > g + 0.03) & (r > b - 0.05)
blue = (sat > 0.45) & (hue > 200) & (hue < 255) & (L < 0.55)
seaDark = seaPx & ((ndi.median_filter(L, 11) - L) > 0.07)
letters = ink | red | blue | pink | seaDark
# letters → words: join along the line of text, then cover the blur around them
words = ndi.binary_closing(letters, structure=np.ones((3, 9), bool), iterations=2)
words = ndi.binary_fill_holes(ndi.binary_dilation(words, iterations=6))

lab, n = ndi.label(words)
objs = ndi.find_objects(lab)
inBox = np.zeros((H, W), bool)
for x0, y0, x1, y1, _ in boxes:
    inBox[max(0, y0):y1, max(0, x0):x1] = True

def fill(sub, mask, known, steps=300):
    """Harmonic fill of sub[mask] from the known pixels at its edge."""
    idx = ndi.distance_transform_edt(~known, return_distances=False, return_indices=True)
    f = sub[tuple(idx)].copy()
    for _ in range(steps):
        avg = (np.roll(f, 1, 0) + np.roll(f, -1, 0) + np.roll(f, 1, 1) + np.roll(f, -1, 1)) / 4
        f = np.where(mask, avg, f)
    return f

h0 = h.astype(np.uint8)
res = h.copy()
cleaned = {"sea": 0, "land": 0, "box": 0}
for k, sl in enumerate(objs, 1):
    if sl is None:
        continue
    ys, xs = sl
    if (ys.stop - ys.start) * (xs.stop - xs.start) > 400000:
        continue                                   # not a word
    pad = 8
    y0, y1 = max(0, ys.start - pad), min(H, ys.stop + pad)
    x0, x1 = max(0, xs.start - pad), min(W, xs.stop + pad)
    comp = lab[y0:y1, x0:x1] == k
    sub = h[y0:y1, x0:x1]
    ring = ndi.binary_dilation(comp, iterations=4) & ~comp & ~words[y0:y1, x0:x1]
    boxed = inBox[y0:y1, x0:x1][comp].mean() > 0.5
    # a name on the sea whose letters came out as specks of land: the specks become sea
    if (sub[comp] < SEA + 0.5).mean() > 0.4:
        specks, ns = ndi.label(comp & (sub > SEA + 0.5))
        if ns:
            outside = ndi.sum(~comp & (sub > SEA + 0.5) & ndi.binary_dilation(specks > 0, iterations=2), specks, np.arange(1, ns + 1))
            size = ndi.sum(np.ones_like(comp), specks, np.arange(1, ns + 1))
            inked = ndi.mean(letters[y0:y1, x0:x1], specks, np.arange(1, ns + 1))
            # specks that are letters (not a real islet drawn next to the name)
            drop = np.zeros(ns + 1, bool); drop[1:] = (outside == 0) & (size < 4000) & (inked > 0.4)
            sub = np.where(drop[specks], SEA - 1, sub)
            h[y0:y1, x0:x1] = sub; res[y0:y1, x0:x1] = np.where(drop[specks], SEA - 1, res[y0:y1, x0:x1])
    for isSea in (True, False):
        cls = (sub < SEA + 0.5) if isSea else (sub > SEA + 0.5)
        m = comp & cls
        rk = ring & cls
        if m.sum() < 10 or rk.sum() < 10:
            continue
        if not isSea and not boxed:
            bump = np.median(sub[m]) - np.median(sub[rk])
            spread = np.percentile(sub[rk], 90) - np.percentile(sub[rk], 10)
            # a word-shaped hill standing alone on flat ground is the name itself, however high
            if spread > 8 or (abs(bump) > 12 and spread > 3):
                continue                           # mountains or rough ground under the name
        known = rk | (~comp & cls & ~words[y0:y1, x0:x1])
        f = fill(np.where(cls, sub, np.nan_to_num(np.median(sub[rk]))), m, known)
        # land stays land, sea stays sea
        f = np.clip(f, SEA + 1, 255) if not isSea else np.clip(f, 0, SEA - 1)
        res[y0:y1, x0:x1] = np.where(m, f, res[y0:y1, x0:x1])
        cleaned["box" if boxed and not isSea else ("sea" if isSea else "land")] += 1

# --box: the whole box is filled from its edge (a flattened name can leave a plateau wider than the
# word); higher ground inside it (a mountain drawn next to the name) is kept
for x0, y0, x1, y1, flat in boxes:
    sub = res[y0:y1, x0:x1]
    land = sub > SEA + 0.5
    edge = np.zeros_like(land); edge[[0, -1], :] = True; edge[:, [0, -1]] = True
    base = np.median(sub[edge & land]) if (edge & land).any() else SEA + 1
    m = land & ~edge
    if m.any():
        # the ground is filled in from the edge; anything standing well above the old level
        # (a mountain drawn next to the name) is put back on top of it
        level = np.median(sub[m]) + 6
        f = fill(np.where(land, sub, base), m | (edge & (sub > base + 6)), edge & land & (sub <= base + 6), 2000)
        if not flat:
            f = f + np.maximum(0, sub - level)
        res[y0:y1, x0:x1] = np.where(m, np.clip(np.maximum(f, np.minimum(sub, base)), SEA + 1, 255), sub)
        cleaned["box"] += 1

res = np.clip(np.round(res), 0, 255).astype(np.uint8)
Image.fromarray(res, "L").save(out, optimize=True)
changed = int((res != h0).sum())
print("words cleaned: sea", cleaned["sea"], " land", cleaned["land"], " in boxes", cleaned["box"], " pixels changed", changed)
