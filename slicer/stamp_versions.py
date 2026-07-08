#!/usr/bin/env python
"""Backfill `commit: null` version entries in parts.json with real git commit hashes.

The workflow the version system assumes:
  1. Author a new version entry in parts.json with `"commit": null` (pending).
  2. Commit ONLY that part's files, with a clear message (the version's changelog).
  3. Run this script. For each part it looks at the git history of the part's STL,
     finds the newest commit not already referenced by an older version entry, and
     stamps it onto the part's newest pending (null-commit) version.
  4. Commit the resulting parts.json (+ re-run filament.py) as a small "stamp" commit.

Unchanged parts are left alone (their newest STL commit is already recorded), so
this is safe to run repeatedly. Run:
  /opt/homebrew/opt/python@3.11/libexec/bin/python stamp_versions.py [--dry-run]
"""
import argparse
import collections
import json
import os
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
MANIFEST = os.path.join(HERE, "parts.json")


def stl_commits(stl_rel):
    """Newest-first list of short commit hashes that touched this STL."""
    out = subprocess.run(
        ["git", "-C", HERE, "log", "--follow", "--format=%h", "--", stl_rel],
        capture_output=True, text=True).stdout
    return [h for h in out.splitlines() if h.strip()]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="report, don't write")
    args = ap.parse_args()

    d = json.load(open(MANIFEST), object_pairs_hook=collections.OrderedDict)
    stamped = []
    for p in d["parts"]:
        versions = p.get("versions")
        stl = p.get("stl")
        if not versions or not stl:
            continue
        used = {v.get("commit") for v in versions if v.get("commit")}
        # git logs the short hash; compare on the same short form the manifest uses.
        commits = stl_commits(stl)
        fresh = next((c for c in commits if not any(c.startswith(u) or u.startswith(c)
                                                    for u in used)), None)
        if not fresh:
            continue
        # stamp the newest pending version
        for v in reversed(versions):
            if not v.get("commit"):
                v["commit"] = fresh
                stamped.append((p["id"], v.get("version"), fresh))
                break

    if not stamped:
        print("nothing to stamp — all versions already tied to commits.")
        return
    for pid, ver, commit in stamped:
        print(f"  {pid} v{ver} -> {commit}")
    if args.dry_run:
        print(f"\n(dry run) would stamp {len(stamped)} version(s).")
        return
    json.dump(d, open(MANIFEST, "w"), indent=2, ensure_ascii=False)
    open(MANIFEST, "a").write("\n")
    print(f"\nstamped {len(stamped)} version(s) into parts.json. "
          f"Re-run filament.py and commit parts.json + parts.generated.json.")


if __name__ == "__main__":
    main()
