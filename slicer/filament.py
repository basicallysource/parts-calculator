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
FILAMENT = "Bambu PLA Matte @BBL A1"

INFILL_DENSITY = "15%"
INFILL_PATTERN = "adaptivecubic"          # adaptive cubic
# Supports are OFF by default and enabled PER PART via "support": true in parts.json.
# These settings apply only when a part opts in (currently just the stator).
SUPPORT_TYPE = "normal(auto)"             # normal supports, auto-placed
SUPPORT_THRESHOLD = "10"                  # overhang threshold deg
AUTO_ORIENT = False                        # CLI auto-orient is unreliable; use the modeled orientation

# outputs
BUILD = os.path.join(HERE, "build")       # gitignored slicer scratch
CACHE = os.path.join(BUILD, "cache")
PROFILE_DIR = os.path.join(BUILD, "profiles")
DATA_OUT = os.path.join(REPO, "src", "lib", "data", "parts.generated.json")
RENDERS_OUT = os.path.join(REPO, "static", "renders")
STL_OUT = os.path.join(REPO, "static", "stl")
# per-version archival: old STLs pulled from git so the app can preview/download them
VERS_STL_OUT = os.path.join(STL_OUT, "versions")
VERS_RENDERS_OUT = os.path.join(RENDERS_OUT, "versions")
# build plates: pre-arranged .3mf files you drop in slicer/plates/ (auto-discovered)
PLATES_SRC = os.path.join(HERE, "plates")
PLATES_OUT = os.path.join(REPO, "static", "plates")
PLATE_THUMB_OUT = os.path.join(REPO, "static", "plate-thumbs")
PLATES_DATA = os.path.join(REPO, "src", "lib", "data", "plates.generated.json")


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
    """id -> hex, parsed from the app's bambu-colors.ts (single source of truth)."""
    import re
    txt = open(os.path.join(REPO, "src", "lib", "bambu-colors.ts")).read()
    return {m.group(1): m.group(2)
            for m in re.finditer(r"id:\s*'([^']+)'.*?hex:\s*'(#[0-9A-Fa-f]{6})'", txt)}


def normalize_versions(part):
    """Always return a versions list. If the manifest declares `versions`, pass it
    through; otherwise synthesize a single entry from created_at/version so the app
    can render history uniformly."""
    vs = part.get("versions")
    if vs:
        return vs
    date = part.get("created_at", part.get("date_added", ""))
    entry = {"version": part.get("version", "1"), "date": date,
             "message": "Initial version.", "commit": None}
    # a single-version part can still carry OnShape links at the part level
    if part.get("onshape_version"):
        entry["onshape_version"] = part["onshape_version"]
    if part.get("onshape_doc"):
        entry["onshape_doc"] = part["onshape_doc"]
    return [entry]


def git_show_bytes(commit, repo_rel):
    """Raw bytes of a file at a past commit, or None if it didn't exist there."""
    r = subprocess.run(["git", "-C", REPO, "show", f"{commit}:{repo_rel}"],
                       capture_output=True)
    return r.stdout if r.returncode == 0 and r.stdout else None


def is_lfs_pointer(data):
    return data is not None and data[:40].startswith(b"version https://git-lfs")


def archive_versions(parts_by_id, out_parts, profiles, hexmap, role_defaults, force):
    """Give every part version a previewable/downloadable STL. A version's geometry
    is the file state right *before* the next version's commit changed it (the newest
    version is just the current working-tree file). That view sidesteps the git-LFS
    era (old commits stored pointers, not meshes) since the un-LFS'd bytes live in the
    later commit's parent. Versions whose geometry equals the current part reuse the
    live asset; distinct old geometry is sliced + rendered under static/*/versions/."""
    os.makedirs(VERS_STL_OUT, exist_ok=True)
    os.makedirs(VERS_RENDERS_OUT, exist_ok=True)
    archived = 0
    for out in out_parts:
        p = parts_by_id[out["id"]]
        versions = out.get("versions") or []
        stl_abs = os.path.join(HERE, p["stl"])
        repo_rel = os.path.relpath(stl_abs, REPO)
        current = open(stl_abs, "rb").read() if os.path.exists(stl_abs) else b""
        for i, v in enumerate(versions):
            if i == len(versions) - 1:
                data = current                      # newest version == working tree
            else:
                nxt = versions[i + 1].get("commit")  # state just before the next version
                data = git_show_bytes(nxt + "~1", repo_rel) if nxt else None
            if data is None or is_lfs_pointer(data) or data == current:
                # current / unavailable geometry -> reuse the live part asset
                if out.get("stl"):
                    v["stl"], v["render"], v["grams"] = out["stl"], out["render"], out["grams"]
                continue
            vid = f"{out['id']}-v{v['version']}"
            tmp = os.path.join(CACHE, vid + ".stl")
            os.makedirs(CACHE, exist_ok=True)
            with open(tmp, "wb") as f:
                f.write(data)
            info = slice_part(tmp, profiles, support=bool(p.get("support", False)), force=force)
            shutil.copy(tmp, os.path.join(VERS_STL_OUT, vid + ".stl"))
            png = os.path.join(VERS_RENDERS_OUT, vid + ".png")
            if force or not os.path.exists(png):
                try:
                    render(tmp, png, default_hex(p, role_defaults, hexmap))
                except Exception as e:
                    print(f"  ! version render failed for {vid}: {e}")
            v["stl"] = f"/stl/versions/{vid}.stl"
            v["render"] = f"/renders/versions/{vid}.png"
            v["grams"] = info["grams"] if info else None
            archived += 1
    print(f"  {archived} historical part version(s) archived -> static/*/versions")


def git_commit_base_url():
    """`https://github.com/owner/repo/commit/` derived from origin, else None."""
    try:
        url = subprocess.run(["git", "-C", REPO, "config", "--get", "remote.origin.url"],
                             capture_output=True, text=True).stdout.strip()
    except Exception:
        return None
    if not url:
        return None
    if url.startswith("git@github.com:"):
        url = "https://github.com/" + url[len("git@github.com:"):]
    if url.endswith(".git"):
        url = url[:-4]
    return url.rstrip("/") + "/commit/" if "github.com" in url else None


def default_hex(part, role_defaults, hexmap):
    """The part's default-color hex (role default / fixed / first split / gray)."""
    c = part.get("color", {})
    if "by_section" in c:                       # resolve to the first section's spec
        c = next(iter(c["by_section"].values()), {})
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
    proc["skirt_loops"] = "0"                 # no skirt on any part
    # support OFF variant (default)
    proc["enable_support"] = "0"
    process_off = os.path.join(PROFILE_DIR, "process.json")
    json.dump(proc, open(process_off, "w"), indent=1)
    # support ON variant (opt-in parts)
    proc["enable_support"] = "1"
    proc["support_type"] = SUPPORT_TYPE
    proc["support_threshold_angle"] = SUPPORT_THRESHOLD
    process_on = os.path.join(PROFILE_DIR, "process_support.json")
    json.dump(proc, open(process_on, "w"), indent=1)

    fil = _resolve("filament", FILAMENT)
    fil.pop("inherits", None)
    fil["name"] = "sorter filament"
    filament_path = os.path.join(PROFILE_DIR, "filament.json")
    json.dump(fil, open(filament_path, "w"), indent=1)

    density = float(_first(fil.get("filament_density", ["1.24"])))
    cost = float(_first(fil.get("filament_cost", ["0"])))
    return (machine_path, process_off, process_on, filament_path), density, cost


def settings_signature():
    return json.dumps({
        "printer": PRINTER, "process": PROCESS, "filament": FILAMENT,
        "infill": INFILL_DENSITY, "pattern": INFILL_PATTERN,
        "support_params": [SUPPORT_TYPE, SUPPORT_THRESHOLD],
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
def slice_part(stl_abs, profiles, support=False, force=False):
    machine_path, process_off, process_on, filament_path = profiles
    process_path = process_on if support else process_off
    stl_bytes = open(stl_abs, "rb").read()
    sig = settings_signature() + ("|support" if support else "|nosupport")
    key = hashlib.sha1(stl_bytes + sig.encode()).hexdigest()[:16]
    cdir = os.path.join(CACHE, key)
    info_path = os.path.join(cdir, "info.json")
    threemf = os.path.join(cdir, "out.3mf")
    fail_path = os.path.join(cdir, "failed")
    if not force:
        if os.path.exists(info_path):
            info = json.load(open(info_path))
            if "support_grams" in info:        # re-parse if schema changed
                return info
        if os.path.exists(threemf):            # re-parse cached slice, no re-slice
            info = parse_3mf(threemf)
            json.dump(info, open(info_path, "w"), indent=1)
            return info
        if os.path.exists(fail_path):
            return None                        # cached failure

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
    if rc != 0 or not os.path.exists(threemf):
        open(fail_path, "w").close()   # cache the failure
        return None                    # caller decides whether to fall back / report

    info = parse_3mf(threemf)
    json.dump(info, open(info_path, "w"), indent=1)
    return info


def parse_3mf(threemf):
    """Returns total grams, the support portion (from per-feature G-code), cm3, time."""
    grams = cm3 = 0.0
    support_used = False
    seconds = 0
    e_total = e_support = 0.0
    cur_support = False
    relative = True
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
                for raw in gf:
                    t = raw.decode("utf-8", "ignore")
                    if t.startswith("; FEATURE:"):
                        cur_support = "support" in t.lower()
                        continue
                    if t.startswith("M82"):
                        relative = False
                    elif t.startswith("M83"):
                        relative = True
                    elif t.startswith("filament used [cm3]") or "filament used [cm3]" in t:
                        cm3 = float(t.split("=")[1])
                    elif "total estimated time:" in t:
                        seconds = _parse_time(t)
                    elif t[:2] in ("G1", "G0"):
                        m = _ERE.search(t)
                        if m and relative:
                            e = float(m.group(1))
                            if e > 0:
                                e_total += e
                                if cur_support:
                                    e_support += e
    support_grams = round(grams * e_support / e_total, 2) if e_total else 0.0
    return {"grams": round(grams, 2), "support_grams": support_grams,
            "cm3": round(cm3, 2), "support_used": support_used, "print_seconds": seconds}


import re as _re
_ERE = _re.compile(r" E(-?[0-9.]+)")


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

    print(f"settings: {INFILL_DENSITY} {INFILL_PATTERN} | supports per-part "
          f"(off by default; {SUPPORT_TYPE} @{SUPPORT_THRESHOLD}deg when on) | "
          f"{FILAMENT} ({density} g/cm3, ${cost_per_kg}/kg)\n")

    out_parts = []
    zip_members = []
    failed = []
    forced_support = []
    for p in manifest["parts"]:
        stl_abs = os.path.join(HERE, p["stl"])
        if not os.path.exists(stl_abs):
            print(f"  ! missing STL, skipping: {p['stl']}")
            continue
        want = bool(p.get("support", False))
        info = slice_part(stl_abs, profiles, support=want, force=args.force)
        if info is None and not want:
            # Orca makes "floating regions" fatal when support is off. Fall back to
            # support-on so we still get a number; flagged for the user.
            info = slice_part(stl_abs, profiles, support=True, force=args.force)
            if info is not None:
                forced_support.append(p["id"])
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
            "variant_group": p.get("variant_group"),
            "variant_name": p.get("variant_name"),
            "description": p.get("description", ""),
            "version": p.get("version", ""),
            "created_at": p.get("created_at", p.get("date_added", "")),
            "updated_at": p.get("updated_at", p.get("created_at", p.get("date_added", ""))),
            "versions": normalize_versions(p),
            "attributes": p.get("attributes", []),
            "grams": info["grams"],
            "support_grams": info.get("support_grams", 0.0),
            "support_used": info["support_used"],
            # true only when the part *opts into* support in the manifest; the slicer
            # may force support on other parts just to slice, but that isn't surfaced.
            "support_intentional": bool(p.get("support", False)),
            "print_seconds": info["print_seconds"],
            "color": p.get("color", {"any": True}),
            "optional": p.get("optional", False),
            "onshape": p.get("onshape"),
            "info": p.get("info"),
            "suspicious": p.get("suspicious", False),
            "suspicious_note": p.get("suspicious_note"),
            "low_tolerance": p.get("low_tolerance", False),
            "low_tolerance_note": p.get("low_tolerance_note"),
            "layer_scope": p.get("layer_scope", "all"),
            "stl": f"/stl/{stl_name}",
            "render": f"/renders/{p['id']}.png",
        })
        sup = " +support" if info["support_used"] else ""
        print(f"  {p['name']:<26} {info['grams']:7.1f} g/ea{sup}")

    archive_versions({p["id"]: p for p in manifest["parts"]}, out_parts,
                     profiles, hexmap, role_defaults, args.force)

    data = {
        "settings": {
            "printer": PRINTER, "process": PROCESS, "filament": FILAMENT,
            "infill_density": INFILL_DENSITY, "infill_pattern": INFILL_PATTERN,
            "support_enabled": False, "support_type": SUPPORT_TYPE,
            "support_threshold_deg": int(SUPPORT_THRESHOLD),
            "density_g_cm3": density, "cost_per_kg": cost_per_kg,
            "commit_base_url": git_commit_base_url(),
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
    if forced_support:
        print(f"  ~ {len(forced_support)} part(s) needed support to slice (floating regions "
              f"in modeled orientation); sliced WITH support: {', '.join(forced_support)}")
    if failed:
        print(f"  ! {len(failed)} part(s) FAILED to slice: {', '.join(failed)}")

    process_plates(manifest)


def process_plates(manifest):
    """Auto-discover pre-arranged build plates (slicer/plates/*.3mf): copy each for
    download, pull its embedded plate previews, and read the parts it contains
    (cross-linked to manifest parts via each part's optional `source` filename)."""
    import re
    import glob
    import collections
    os.makedirs(PLATES_OUT, exist_ok=True)
    os.makedirs(PLATE_THUMB_OUT, exist_ok=True)
    src_to_id = {p["source"]: p["id"] for p in manifest["parts"] if p.get("source")}
    out = []
    for f in sorted(glob.glob(os.path.join(PLATES_SRC, "*.3mf"))):
        base = os.path.splitext(os.path.basename(f))[0]
        pid = re.sub(r"[^a-z0-9]+", "-", base.lower()).strip("-")
        shutil.copy(f, os.path.join(PLATES_OUT, pid + ".3mf"))
        thumbs = []
        with zipfile.ZipFile(f) as z:
            for name in sorted(n for n in z.namelist() if re.match(r"Metadata/plate_\d+\.png$", n)):
                num = re.search(r"plate_(\d+)", name).group(1)
                tn = f"{pid}-{num}.png"
                with open(os.path.join(PLATE_THUMB_OUT, tn), "wb") as o:
                    o.write(z.read(name))
                thumbs.append(f"/plate-thumbs/{tn}")
            cfg = z.read("Metadata/model_settings.config").decode("utf-8", "ignore")
        raw = re.findall(r'<object\b[^>]*>\s*<metadata key="name" value="([^"]+)"', cfg)
        # Skip decorative/label objects (e.g. embossed "text_shape"); real parts are .stl
        counts = collections.Counter(n for n in raw if n.lower().endswith(".stl"))
        parts = []
        for nm, c in counts.items():
            pretty = nm.rsplit(".stl", 1)[0]
            pretty = pretty.split(" - ", 1)[1] if " - " in pretty else pretty
            parts.append({"name": pretty.replace("_", " ").strip(), "count": c,
                          "part_id": src_to_id.get(nm)})
        parts.sort(key=lambda x: -x["count"])
        out.append({"id": pid, "name": base, "download": f"/plates/{pid}.3mf",
                    "thumbs": thumbs, "parts": parts})
    json.dump(out, open(PLATES_DATA, "w"), indent="\t")
    print(f"  {len(out)} build plate(s) -> static/plates + plates.generated.json")


if __name__ == "__main__":
    main()
