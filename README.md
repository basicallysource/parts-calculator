# Sorter v2 — Filament Calculator

A small web tool for the [Sorter](https://basically.website) build. Pick your
**frame** and **core** colors and a **layer count**, and it tells you exactly how
much filament to order — plus lets you **download the current known-good STLs**.

The grams are not estimates: every part is sliced with OrcaSlicer and the tool
reads the slicer's own filament weight.

## How it works

Two pieces:

1. **`slicer/`** — a local Python step (needs OrcaSlicer installed). It slices
   every part once, reads `used_g`, renders a thumbnail, copies the STL, and
   writes the data the site reads. **This never runs on Vercel.**
2. **SvelteKit app** (`src/`) — reads the generated data and does all the
   color/layer math in the browser. Fully static; deploys to Vercel as-is.

```
slicer/
  parts.json            # manifest: every part, its section(s), qty, color role
  parts/<section>/*.stl # source STLs (the known-good iteration)
  filament.py           # the local data-generation step
src/lib/data/parts.generated.json   # GENERATED, committed — the app's input
static/renders/*.png                # GENERATED, committed — thumbnails
static/stl/*.stl, all-parts.zip     # GENERATED, committed — downloads
```

## Updating parts

1. Drop new STLs into `slicer/parts/<section>/` (sections: `feeder`,
   `interface-top`, `interface-bottom`, `layer`).
2. Add/edit entries in `slicer/parts.json` — set `quantities`, `color_role`
   (`frame` / `core` / `any`, or `fixed` + `fixed_color`), and `optional`.
3. Run the slicer:
   ```
   /opt/homebrew/opt/python@3.11/libexec/bin/python slicer/filament.py
   ```
   (add `--force` to re-slice/re-render everything)
4. Commit the changes (STLs go to Git LFS automatically) and push. Vercel redeploys.

Slicer settings live at the top of `slicer/filament.py` (printer, infill,
supports, etc.). Terminology is in `slicer/PARTS_CONTEXT.md`.

## Dev

```
npm install
npm run dev
```

STLs are stored with **Git LFS** (`git lfs install` once per machine).

## Build plates

Drop pre-arranged `.3mf` plates into `slicer/plates/` (auto-discovered). `filament.py`
copies each to `static/plates/` for download, pulls its embedded plate previews, and
reads the parts it contains. To cross-link a plate's parts to the catalog, set a part's
`source` field in `parts.json` to the part's original filename as it appears in the 3mf.
