# CLAUDE.md

Working rules for this repo. Read `notes/UNIFIED-PARTS-SYSTEM.md` before
making structural changes to the parts data model — it is the design spec
for where this is heading (unified registry across this repo, the docs, and
the BOM spreadsheet).

## What this is

A SvelteKit static site that tells you what to print/buy for a Sorter V2
build. Two halves:

- **`slicer/`** — Python + OrcaSlicer. Slices every part, reads the
  slicer's real `used_g`, renders thumbnails, writes the site's data.
  **Never runs on Vercel.** Runs locally on the Mac *or* in CI:
  `.github/workflows/regen-parts.yml` re-runs it (pinned Linux AppImage,
  headless) on any PR/push touching slicer inputs and commits the
  regenerated outputs back to the branch — so agents/bots can change parts
  data with no local slicer, and Vercel previews show the branch's own
  correct data. CI is the canonical slicer environment; slice results are
  memoized per (STL bytes + settings), so warm runs only re-slice what
  changed.
- **`src/`** — the app. Reads generated JSON, does all math in the browser.
  Fully static.

## Deploying

**Pushing/merging to `main` auto-deploys** (Vercel builds `main` on every
push). There is no separate deploy step — a commit that lands on `main` is
live. Treat every push to `main` as a production release.

## PR previews — when they are actually valid

Every branch gets a Vercel preview. **If the PR touched anything under
`slicer/`, that preview is wrong until CI's regen commit lands**: the app
reads the committed `parts.generated.json`, not `parts.json`, so a changed
part shows its old grams and old thumbnail, and a new part is missing.

Budget **~2 minutes** from push to a correct preview for a parts change
(~25 s Vercel on stale data → ~70 s regen → ~25 s Vercel on correct data).
A slicer-settings change re-slices all 84 parts: ~7.5 min. A PR touching
nothing under `slicer/` skips regen entirely: ~25 s. Full table with the
per-part cost is in [README.md](README.md#how-long-until-the-preview-is-right).

Do not report a preview as ready — or screenshot it — on the first green
Vercel check. CI moves the branch head underneath you. Wait for the `regen`
check to succeed, *then* the Vercel deployment on the resulting head SHA.
Do not wait on "all checks green": a commit-back can park a duplicate,
never-executed run in `action_required` on the PR forever.

Sharing a preview *link* early is fine — the URL is stable per branch and
self-corrects once the second build lands.

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
materialize LFS objects, which broke previews and downloads. That
constraint dissolved once the site started reading bucket URLs — Vercel
never needs the bytes at build time, only the JSON manifest.

**But do not migrate history to LFS yet.** Historical part revisions are
not stored anywhere; `archive_versions()` in `slicer/filament.py`
reconstructs them by reading pre-change geometry out of git history
(`git show <commit>~1:<path>`). Under LFS that returns pointer text, the
`is_lfs_pointer()` guard fires, and the revision silently falls back to the
current geometry — wrong data with no error. LFS becomes safe only once
each revision pins its own `stl_hash` in the manifest, making the bucket
authoritative. See `notes/UNIFIED-PARTS-SYSTEM.md` §9 step 9.

Renders (`static/renders/`, ~1.4 MB) stay as normal git blobs — small, and
the site wants them at build time.

## Known stale docs

`README.md`'s three known errors were fixed when CI slicing landed: the
bogus "STLs go to Git LFS automatically" line, the reference to
`slicer/PARTS_CONTEXT.md` (terminology lives in `notes/TERMINOLOGY.md`),
and the 4-item section list (there are 9 sections in `slicer/parts.json`).
