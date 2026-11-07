#!/usr/bin/env python3
"""
Builds an admin export (the zip from "Exportera…" in the app) into the standard map shipped with
the app, for the next release.

    tools/apply-export.py <export.zip> [--project .] [--dry-run]

What it does, part by part (only the parts in export.json "changes"):
  height    -> src/main/resources/default-map/height.png, and settings.heightRev in map.json set to
               the revision the export was made at (when exported from the standard map itself), so
               height changes accepted in the app after the export are put back on top on install
  forest    -> default-map/forest.png    ("forest" in map.json)
  ice       -> default-map/ice.png       ("ice" in map.json)
  rivers    -> default-map/rivers.json   ("rivers" in map.json)
  nations   -> default-map/nations.json  ("nations" in map.json)
  ranges    -> default-map/ranges.json   ("ranges" in map.json, mountain ranges)
  roads     -> default-map/roads.json    ("roads" in map.json, roads and paths)
  anchors, leylines, zones, settings -> map.json
  image     -> default-map/map.jpg (only if the export's picture is a JPEG; otherwise just reported)
  regions   -> world/regions/<file>.yaml (a changed built-in region replaces its own file)
"""
import argparse, io, json, os, sys, zipfile


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("zip")
    ap.add_argument("--project", default=".")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    z = zipfile.ZipFile(a.zip)
    man = json.loads(z.read("export.json"))
    if man.get("format") != "eon-weather-export":
        sys.exit("not an Eon Weather export")
    dm = os.path.join(a.project, "src/main/resources/default-map")
    regions_dir = os.path.join(a.project, "world/regions")
    mj_path = os.path.join(dm, "map.json")
    mj = json.load(open(mj_path, encoding="utf-8"))
    ch = man.get("changes", {})
    base = man.get("base", {})
    print(f"export of \"{man['map']['name']}\" (standard map: {man['map']['isDefault']}), app {base.get('appVersion')}, "
          f"bundle {base.get('bundle')}, made {man.get('exportedAt')} by {man.get('exportedBy')}")
    if not man["map"]["isDefault"]:
        print("  NOTE: made from another map than the standard one; check that it shows the same world with the same framing"
              f" ({man['map']['width']}x{man['map']['height']} px)")
    if man.get("emptyOnThisMap"):
        print("  empty on that map (left as they are):", ", ".join(man["emptyOnThisMap"]))
    writes = {}

    if "height" in ch and "file" in ch["height"]:
        writes[os.path.join(dm, "height.png")] = z.read(ch["height"]["file"])
        mj["height"] = "height.png"
        if man["map"]["isDefault"]:
            mj.setdefault("settings", {})["heightRev"] = ch["height"]["rev"]
        print(f"  height map: {ch['height'].get('changedPixels', '?')} pixels changed, rev {ch['height'].get('rev')}")
    if "forest" in ch and "file" in ch["forest"]:
        writes[os.path.join(dm, "forest.png")] = z.read(ch["forest"]["file"])
        mj["forest"] = "forest.png"
        mj.setdefault("settings", {})["forestRelease"] = man.get("exportedAt")
        print(f"  forest map: {ch['forest'].get('forestedPixels', '?')} pixels with trees")
    if "ice" in ch and "file" in ch["ice"]:
        writes[os.path.join(dm, "ice.png")] = z.read(ch["ice"]["file"])
        mj["ice"] = "ice.png"
        mj.setdefault("settings", {})["iceRelease"] = man.get("exportedAt")
        print(f"  ice map: {ch['ice'].get('coveredPixels', '?')} pixels with ice")
    for part in ("rivers", "nations", "ranges", "roads"):
        if part in ch:
            writes[os.path.join(dm, part + ".json")] = z.read(ch[part]["file"])
            mj[part] = part + ".json"
            # newer than what was edited in the app on the standard map: installed once over it
            mj.setdefault("settings", {})[part + "Release"] = man.get("exportedAt")
            print(f"  {part}: {ch[part]['count']}")
    for part in ("anchors", "leylines", "zones"):
        if part in ch:
            mj[part] = ch[part]
            print(f"  {part}: {len(ch[part])}")
    if "settings" in ch:
        st = mj.setdefault("settings", {})
        for k, v in ch["settings"].items():
            if v is None:
                st.pop(k, None)
            else:
                st[k] = v
        print("  settings:", ", ".join(ch["settings"]))
    if "image" in ch:
        f = ch["image"]["file"]
        if f.endswith(".jpg"):
            writes[os.path.join(dm, "map.jpg")] = z.read(f)
            mj["image"] = "map.jpg"
            print("  map picture replaced")
        else:
            print(f"  map picture differs ({f}); not replaced automatically")
    for r in ch.get("regions", []):
        name = r.get("replaces") or os.path.basename(r["file"])
        writes[os.path.join(regions_dir, name)] = z.read(r["file"])
        print(f"  region {r['name']}: {r['status']} -> world/regions/{name}")

    writes[mj_path] = (json.dumps(mj, ensure_ascii=False, indent=1) + "\n").encode("utf-8")
    for path, data in writes.items():
        print(("would write " if a.dry_run else "write ") + os.path.relpath(path, a.project), len(data), "bytes")
        if not a.dry_run:
            with open(path, "wb") as f:
                f.write(data)


if __name__ == "__main__":
    main()
