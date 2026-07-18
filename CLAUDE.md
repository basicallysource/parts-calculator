# CLAUDE.md

Working rules for this repo. Read `notes/UNIFIED-PARTS-SYSTEM.md` before
making structural changes to the parts data model — it is the design spec
for where this is heading (unified registry across this repo, the docs, and
the BOM spreadsheet).

## What this is

A SvelteKit static site that tells you what to print/buy for a Sorter V2
build. Two halves:

- **`slicer/`** — local Python (needs OrcaSlicer). Slices every part, reads
  the slicer's real `used_g`, renders thumbnails, writes the site's data.
  **Never runs on Vercel.**
- **`src/`** — the app. Reads generated JSON, does all math in the browser.
  Fully static.

## Hard rules

**Never hand-edit generated files.** `src/lib/data/parts.generated.json`,
`src/lib/data/plates.generated.json`, and `slicer/artifacts.json` are all
outputs. The authored source of truth is `slicer/parts.json`. Edit that and
re-run the generator.

**Filament weights are measured, never estimated.** Grams come from
OrcaSlicer's own output. Do not compute weight from volume/density.

**Python is invoked by full path** (no venvs):
```
/opt/homebrew/opt/python@3.11/libexec/bin/python slicer/filament.py
```

## Artifacts and the bucket

Large binaries (STLs, 3MFs) sync to a DigitalOcean Space,
**content-addressed** at `stl/<sha256>.stl`:

```
python scripts/sync_bucket.py --dry-run   # report only
python scripts/sync_bucket.py             # upload missing + rewrite manifest
```

Credentials come from `DO_SPACES_KEY` / `DO_SPACES_SECRET` (env, or
`~/.config/do-spaces/sorter-v2-parts.env`). In CI they are repo secrets;
`.github/workflows/sync-bucket.yml` runs the same script on push.

Uploads are idempotent — the key IS the content hash, and the script
head-checks before writing, so re-runs upload nothing and identical bytes
are never stored twice.

### The caching invariant — do not break this

Objects are served `public, max-age=31536000, immutable`. That is safe
**only** because the URL contains the content hash: the bytes at a given URL
can never change, so a cached copy can never go stale. Two rules preserve it:

1. **Never serve a stable-name URL with long-lived cache headers.** A URL
   like `/stl/chute-core.stl`, whose content changes across part revisions,
   must not be cached aggressively. Every public artifact URL is
   hash-addressed. If a friendly-name alias is ever added, it gets a short
   TTL.
2. **Never use presigned URLs for public artifacts** — they expire. These
   are public-read objects at permanent keys.

Origin and CDN hostnames both serve the objects permanently, so switching
between them is not a breaking change. Full rationale:
`notes/UNIFIED-PARTS-SYSTEM.md` §7.

Because hashes are permanent addresses, every historical revision stays
downloadable forever with no archive to maintain — this is what lets a part
revision pin an `stl_hash` and stay retrievable indefinitely.

## Storage layout (in transition)

Current state and target differ; know which you're in.

**Today:** STLs are committed as normal git objects (see `.gitattributes`),
duplicated in `slicer/parts/**` (canonical, 49 MB) and `static/stl/**`
(byte-identical serving copies, 68 MB). `.git` is ~267 MB.

**Target:** the site reads bucket URLs from `slicer/artifacts.json`;
`static/stl/` is deleted; `slicer/parts/**` moves to Git LFS as the archival
copy.

The `.gitattributes` note says LFS is banned because Vercel does not
materialize LFS objects, which broke previews and downloads. **That
constraint dissolves once the site reads bucket URLs** — Vercel then never
needs the bytes at build time, only the JSON manifest, so LFS pointer files
on the deploy are harmless. Do not re-introduce LFS until that rewiring has
shipped and is verified.

Renders (`static/renders/`, ~1.4 MB) stay as normal git blobs — small, and
the site wants them at build time.

## Known stale docs

`README.md` contradicts itself and reality in two places, pending a pass:
it says STLs "go to Git LFS automatically" (they do not — see
`.gitattributes`), and it references `slicer/PARTS_CONTEXT.md`, which does
not exist (terminology lives in `notes/TERMINOLOGY.md`). Its section list
(`feeder`, `interface-top`, `interface-bottom`, `layer`) is also outdated —
there are 9 sections in `slicer/parts.json`.
