> # ⚠️ This repository has moved
>
> The parts calculator now lives at **[`parts-calculator/` inside
> `basicallysource/sorter-v2`](https://github.com/basicallysource/sorter-v2/tree/main/parts-calculator)**,
> with its full history. This repository is **archived and read-only**. Nothing
> here is maintained, and the code in it is out of date.

# Sorter v2 — Parts Calculator

**→ [Go to the current source](https://github.com/basicallysource/sorter-v2/tree/main/parts-calculator)**
**→ [Use the calculator](https://parts-calculator.basically.website)**

A web tool for the [Sorter](https://basically.website) build: pick your **frame**
and **core** colors and a **layer count**, and it tells you exactly how much
filament to order, plus the STLs to print. The grams are not estimates — every
part is sliced with OrcaSlicer and the tool reads the slicer's own filament
weight.

## What happened

It was merged into `sorter-v2` on 2026-08-20, as one commit tree with all of
this repository's history preserved. It moved for a reason that had become
obvious: the docs site and the calculator each kept their own parts list, they
disagreed, and neither could be the source of truth while they lived in
different repositories. They now share one catalog.

Two things changed with the move, both worth knowing if you have a fork or an
old checkout:

- **The history was rewritten** before the merge, to remove every binary ever
  committed (STL masters, 3MF plates, ~30 revisions of an all-parts zip). That
  took the repository from 376 MB to under a megabyte. Every asset now lives on
  a content-addressed bucket and is pinned by hash from committed JSON. The
  full pre-rewrite history is preserved read-only at
  **[`basicallysource/parts-calculator-archive`](https://github.com/basicallysource/parts-calculator-archive)**.
- **The site moved to Cloudflare Pages**, built out of `sorter-v2`. The Vercel
  project is gone. `parts-calculator.basically.website` is unchanged and still
  the address to use.

## If you have a fork or a clone

There is nothing to rebase onto — this repository's `main` and the merged tree
are different lineages. Clone `sorter-v2` and work in `parts-calculator/`
instead. Open issues and pull requests on `sorter-v2`.
