#!/usr/bin/env python
"""
Local data-generation step for the Sorter filament calculator.

This runs on YOUR machine (needs OrcaSlicer installed) -- never on Vercel.
For every part in parts.json it:
  - slices the STL headlessly with OrcaSlicer using Spencer's settings
  - reads the SLICER'S OWN gram number (used_g) -- not an estimate
  - renders a thumbnail
  - copies the STL to ../static/stl/ so the site can serve it for download
Then it writes ../src/lib/data/parts.generated.json, which the SvelteKit app
reads to do all the color/layer math in the browser.

Commit the generated JSON, thumbnails, and static STL copies. Re-run this
whenever a part STL changes or you add/remove parts.

Run:  /opt/homebrew/opt/python@3.11/libexec/bin/python filament.py [--force]
See ../notes/TERMINOLOGY.md for terminology.
"""

import argparse
import hashlib
import json
import os
import shutil
import struct
import subprocess
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)

# ---------------------------------------------------------------- config knobs
ORCA = "/Applications/OrcaSlicer.app/Contents/MacOS/OrcaSlicer"
PROFILES = "/Applications/OrcaSlicer.app/Contents/Resources/profiles/BBL"

PRINTER = "Bambu Lab A1 0.4 nozzle"      # printer choice barely affects grams
PROCESS = "0.20mm Standard @BBL A1"
FILAMENT = "Bambu PLA Basic @BBL A1"

INFILL_DENSITY = "15%"
INFILL_PATTERN = "adaptivecubic"          # adaptive cubic
SUPPORT_ENABLE = True
SUPPORT_TYPE = "normal(auto)"             # normal supports, auto-placed
SUPPORT_THRESHOLD = "10"                  # overhang threshold deg (10 = aggressive; default 30)
AUTO_ORIENT = False                        # CLI auto-orient rotates big parts off-bed; use modeled orientation

# outputs
BUILD = os.path.join(HERE, "build")       # gitignored slicer scratch
CACHE = os.path.join(BUILD, "cache")
PROFILE_DIR = os.path.join(BUILD, "profiles")
DATA_OUT = os.path.join(REPO, "src", "lib", "data", "parts.generated.json")
RENDERS_OUT = os.path.join(REPO, "static", "renders")
STL_OUT = os.path.join(REPO, "static", "stl")


# ---------------------------------------------------------------- profile prep
def _load(kind, name):
    p = os.path.join(PROFILES, kind, name + ".json")
    if not os.path.exists(p):
        sys.exit(f"profile not found: {p}\n(is OrcaSlicer installed?)")
    return json.load(open(p))


def _resolve(kind, name):
    d = _load(kind, name)
    inh = d.get("inherits")
    base = _resolve(kind, inh) if inh else {}
    base.update(d)
    return base


def _first(v):
    return v[0] if isinstance(v, list) else v


def lego_hex_map():
    """id -> hex, parsed from the app's lego-colors.ts (single source of truth)."""
    import re
    txt = open(os.path.join(REPO, "src", "lib", "lego-colors.ts")).read()
    return {m.group(1): m.group(2)
            for m in re.finditer(r"id:\s*'([^']+)'.*?hex:\s*'(#[0-9A-Fa-f]{6})'", txt)}


def default_hex(part, role_defaults, hexmap):
    """The part's default-color hex (role default / fixed / first split / gray)."""
    c = part.get("color", {})
    cid = None
    if "split" in c:
        cid = c["split"][0]["color"]
    elif "fixed" in c:
        cid = c["fixed"]
    elif "role" in c:
        cid = role_defaults.get(c["role"])
    return hexmap.get(cid, "#cfd3d6") if cid else "#cfd3d6"


def build_profiles():
    os.makedirs(PROFILE_DIR, exist_ok=True)
    machine_path = os.path.join(PROFILE_DIR, "machine.json")
    # Keep the leaf profile (Orca resolves its `inherits`); only override the bed.
    # Slice on a large virtual bed: filament grams are bed-independent (same
    # nozzle/layer/infill/walls), and the CLI rejects ~240mm parts on the real
    # 256mm bed (it demands edge margin the GUI doesn't). This avoids that.
    shutil.copy(os.path.join(PROFILES, "machine", PRINTER + ".json"), machine_path)
    machine = json.load(open(machine_path))
    machine["printable_area"] = ["0x0", "600x0", "600x600", "0x600"]
    machine["printable_height"] = "600"
    machine["bed_exclude_area"] = []
    json.dump(machine, open(machine_path, "w"), indent=1)

    proc = _resolve("process", PROCESS)
    proc.pop("inherits", None)
    proc["name"] = "sorter process"
    proc["sparse_infill_density"] = INFILL_DENSITY
    proc["sparse_infill_pattern"] = INFILL_PATTERN
    proc["enable_support"] = "1" if SUPPORT_ENABLE else "0"
    proc["support_type"] = SUPPORT_TYPE
    proc["support_threshold_angle"] = SUPPORT_THRESHOLD
    proc["skirt_loops"] = "0"                 # no skirt on any part
    process_path = os.path.join(PROFILE_DIR, "process.json")
    json.dump(proc, open(process_path, "w"), indent=1)

    fil = _resolve("filament", FILAMENT)
    fil.pop("inherits", None)
    fil["name"] = "sorter filament"
    filament_path = os.path.join(PROFILE_DIR, "filament.json")
    json.dump(fil, open(filament_path, "w"), indent=1)

    density = float(_first(fil.get("filament_density", ["1.24"])))
    cost = float(_first(fil.get("filament_cost", ["0"])))
    return (machine_path, process_path, filament_path), density, cost


def settings_signature():
    return json.dumps({
        "printer": PRINTER, "process": PROCESS, "filament": FILAMENT,
        "infill": INFILL_DENSITY, "pattern": INFILL_PATTERN,
        "support": [SUPPORT_ENABLE, SUPPORT_TYPE, SUPPORT_THRESHOLD],
        "orient": AUTO_ORIENT,
    }, sort_keys=True)


BED_CENTER = 300.0   # center of the 600mm virtual bed


def prepare_mesh(stl_abs, out_path):
    """Match what the GUI does on import: weld duplicate vertices, drop the part
    onto the plate (minz->0), and center it. The CLI does NOT auto-drop, so parts
    carrying CAD assembly coordinates (floating / sunk / off-origin) get rejected
    without this. No rotation — the modeled orientation is the print orientation."""
    import trimesh
    m = trimesh.load(stl_abs, process=True)
    m.merge_vertices()
    b = m.bounds
    m.apply_translation([
        BED_CENTER - (b[0][0] + b[1][0]) / 2,
        BED_CENTER - (b[0][1] + b[1][1]) / 2,
        -b[0][2],
    ])
    m.export(out_path)


# ---------------------------------------------------------------- slicing
def slice_part(stl_abs, profiles, force=False):
    machine_path, process_path, filament_path = profiles
    stl_bytes = open(stl_abs, "rb").read()
    key = hashlib.sha1(stl_bytes + settings_signature().encode()).hexdigest()[:16]
    cdir = os.path.join(CACHE, key)
    info_path = os.path.join(cdir, "info.json")
    if os.path.exists(info_path) and not force:
        return json.load(open(info_path))

    os.makedirs(cdir, exist_ok=True)
    prepared = os.path.join(cdir, "prepared.stl")
    try:
        prepare_mesh(stl_abs, prepared)
    except Exception as e:
        print(f"  ! mesh prep failed for {os.path.basename(stl_abs)}: {e}")
        return None

    cmd = [ORCA,
           "--load-settings", f"{machine_path};{process_path}",
           "--load-filaments", filament_path,
           "--orient", "0", "--arrange", "1", "--slice", "0",
           "--export-3mf", "out.3mf", "--outputdir", cdir, prepared]
    with open(os.path.join(cdir, "slice.log"), "w") as log:
        rc = subprocess.run(cmd, stdout=log, stderr=subprocess.STDOUT).returncode
    threemf = os.path.join(cdir, "out.3mf")
    if rc != 0 or not os.path.exists(threemf):
        print(f"  ! slice FAILED for {os.path.basename(stl_abs)} (rc={rc}); see {cdir}/slice.log")
        return None

    info = parse_3mf(threemf)
    json.dump(info, open(info_path, "w"), indent=1)
    return info


def parse_3mf(threemf):
    grams = cm3 = 0.0
    support_used = False
    seconds = 0
    with zipfile.ZipFile(threemf) as z:
        si = z.read("Metadata/slice_info.config").decode("utf-8", "ignore")
        for line in si.splitlines():
            if "support_used" in line and 'value="true"' in line:
                support_used = True
            if "used_g=" in line:
                grams += float(line.split('used_g="', 1)[1].split('"', 1)[0])
        gname = next((n for n in z.namelist() if n.endswith(".gcode")), None)
        if gname:
            with z.open(gname) as gf:
                for _ in range(600):
                    raw = gf.readline()
                    if not raw:
                        break
                    t = raw.decode("utf-8", "ignore")
                    if "filament used [cm3]" in t:
                        cm3 = float(t.split("=")[1])
                    elif "total estimated time:" in t:
                        seconds = _parse_time(t)
    return {"grams": round(grams, 2), "cm3": round(cm3, 2),
            "support_used": support_used, "print_seconds": seconds}


def _parse_time(t):
    seg = t.split("total estimated time:")[-1]
    s = 0
    for tok in seg.replace(";", " ").split():
        if tok.endswith("h"):
            s += int(tok[:-1]) * 3600
        elif tok.endswith("m"):
            s += int(tok[:-1]) * 60
        elif tok.endswith("s"):
            s += int(tok[:-1])
    return s


# ---------------------------------------------------------------- rendering
def render(stl_abs, out_png, hexcolor="#cfd3d6"):
    import numpy as np
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from mpl_toolkits.mplot3d.art3d import Poly3DCollection

    tris = read_triangles(stl_abs)
    base = np.array([int(hexcolor[i:i + 2], 16) / 255 for i in (1, 3, 5)])
    # simple lambert shading so any color (incl. black) shows form
    v0, v1, v2 = tris[:, 0], tris[:, 1], tris[:, 2]
    n = np.cross(v1 - v0, v2 - v0)
    ln = np.linalg.norm(n, axis=1, keepdims=True)
    n = np.divide(n, ln, out=np.zeros_like(n), where=ln != 0)
    light = np.array([0.4, 0.5, 0.85])
    light = light / np.linalg.norm(light)
    shade = 0.45 + 0.55 * np.clip(n @ light, 0, 1)
    facecolors = np.clip(base[None, :] * shade[:, None], 0, 1)
    facecolors = np.concatenate([facecolors, np.ones((len(tris), 1))], axis=1)

    fig = plt.figure(figsize=(3.2, 3.2), dpi=100)
    ax = fig.add_subplot(111, projection="3d")
    ax.add_collection3d(Poly3DCollection(tris, facecolors=facecolors, edgecolor="none"))
    pts = tris.reshape(-1, 3)
    mins, maxs = pts.min(0), pts.max(0)
    ctr = (mins + maxs) / 2
    r = (maxs - mins).max() / 2 or 1
    ax.set_xlim(ctr[0] - r, ctr[0] + r)
    ax.set_ylim(ctr[1] - r, ctr[1] + r)
    ax.set_zlim(ctr[2] - r, ctr[2] + r)
    ax.set_box_aspect((1, 1, 1))
    ax.view_init(elev=22, azim=-60)
    ax.set_axis_off()
    fig.subplots_adjust(left=0, right=1, bottom=0, top=1)
    fig.savefig(out_png, transparent=True)
    plt.close(fig)


def read_triangles(path):
    import numpy as np
    with open(path, "rb") as f:
        head = f.read(80)
        if head[:5] == b"solid" and b"facet" in f.read(200):
            verts = [[float(x) for x in ln.split()[1:4]]
                     for ln in open(path) if ln.strip().startswith("vertex")]
            return np.array(verts, dtype=np.float32).reshape(-1, 3, 3)
        f.seek(80)
        n = struct.unpack("<I", f.read(4))[0]
        data = f.read(n * 50)
    tris = np.empty((n, 9), dtype=np.float32)
    for i in range(n):
        off = i * 50 + 12
        tris[i] = struct.unpack("<9f", data[off:off + 36])
    return tris.reshape(n, 3, 3)


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="re-slice + re-render everything")
    args = ap.parse_args()

    manifest = json.load(open(os.path.join(HERE, "parts.json")))
    profiles, density, cost_per_kg = build_profiles()
    hexmap = lego_hex_map()
    role_defaults = {r["id"]: r["default"] for r in manifest["color_roles"]}
    os.makedirs(RENDERS_OUT, exist_ok=True)
    os.makedirs(STL_OUT, exist_ok=True)
    os.makedirs(os.path.dirname(DATA_OUT), exist_ok=True)

    print(f"settings: {INFILL_DENSITY} {INFILL_PATTERN} | supports "
          f"{'on' if SUPPORT_ENABLE else 'off'} {SUPPORT_TYPE} @{SUPPORT_THRESHOLD}deg | "
          f"{FILAMENT} ({density} g/cm3, ${cost_per_kg}/kg)\n")

    out_parts = []
    zip_members = []
    failed = []
    for p in manifest["parts"]:
        stl_abs = os.path.join(HERE, p["stl"])
        if not os.path.exists(stl_abs):
            print(f"  ! missing STL, skipping: {p['stl']}")
            continue
        info = slice_part(stl_abs, profiles, force=args.force)
        if info is None:
            failed.append(p["id"])
            continue

        png = os.path.join(RENDERS_OUT, p["id"] + ".png")
        if args.force or not os.path.exists(png):
            try:
                render(stl_abs, png, default_hex(p, role_defaults, hexmap))
            except Exception as e:
                print(f"  ! render failed for {p['id']}: {e}")

        stl_name = p["id"] + ".stl"
        shutil.copy(stl_abs, os.path.join(STL_OUT, stl_name))
        zip_members.append((stl_abs, stl_name))

        out_parts.append({
            "id": p["id"],
            "name": p["name"],
            "quantities": p.get("quantities", {}),
            "assembly": p.get("assembly"),
            "description": p.get("description", ""),
            "version": p.get("version", ""),
            "date_added": p.get("date_added", ""),
            "grams": info["grams"],
            "support_used": info["support_used"],
            "print_seconds": info["print_seconds"],
            "color": p.get("color", {"any": True}),
            "optional": p.get("optional", False),
            "stl": f"/stl/{stl_name}",
            "render": f"/renders/{p['id']}.png",
        })
        sup = " +support" if info["support_used"] else ""
        print(f"  {p['name']:<26} {info['grams']:7.1f} g/ea{sup}")

    data = {
        "settings": {
            "printer": PRINTER, "process": PROCESS, "filament": FILAMENT,
            "infill_density": INFILL_DENSITY, "infill_pattern": INFILL_PATTERN,
            "support_enabled": SUPPORT_ENABLE, "support_type": SUPPORT_TYPE,
            "support_threshold_deg": int(SUPPORT_THRESHOLD),
            "density_g_cm3": density, "cost_per_kg": cost_per_kg,
        },
        "sections": manifest["sections"],
        "color_roles": manifest["color_roles"],
        "assemblies": manifest.get("assemblies", []),
        "parts": out_parts,
    }
    json.dump(data, open(DATA_OUT, "w"), indent="\t")

    # bundle every STL into one downloadable zip the site serves
    zip_path = os.path.join(STL_OUT, "all-parts.zip")
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for src, name in zip_members:
            zf.write(src, name)

    print(f"\nwrote {DATA_OUT}")
    print(f"  {len(out_parts)} parts · thumbnails -> static/renders · STLs -> static/stl")
    if failed:
        print(f"  ! {len(failed)} part(s) FAILED to slice: {', '.join(failed)}")


if __name__ == "__main__":
    main()
