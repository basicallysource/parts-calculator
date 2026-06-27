# Filament calc — context & terminology

Context for the filament-required calculation for [[sorter-v2]]. Read this before touching `filament.py` or `parts.json`.

## What the machine is

A Lego sorting machine. Two big subsystems stacked vertically:

- **Distribution system** — handles pieces getting placed into bins. Has a big **frame** around it (the "distribution frame"). Pieces drop down through it.
- **Feeder** — actually feeds pieces in. Sits **on top** of the distribution frame.
- **Interface** — the part in between the feeder and the distribution frame. It's modular and contains **some of the frame parts inside it**.

## Modularity (this is the key idea)

The machine is built in **layers**. Each layer adds a circle of bins on top of the last one. Add more layers → more bins → more capacity.

So part counts split into two kinds:
- **Per machine (constant):** 1 feeder, 1 interface. One per machine no matter how many layers.
- **Per layer (scales):** everything in a layer's frame + bins, ×N layers.

A machine with N layers = **1 feeder + 1 interface + N layers**.

## The frame (applies to each layer AND the interface)

Each frame is a hexagonal-ish ring of **6 sections**. Per frame:
- **6 crossbeams** — one between each section.
- **12 90° brackets** — two per section.

There's **one frame per layer** and **one frame per interface**. So crossbeams and 90° brackets are **shared** between the layer and the interface (same parts, counted in both). That's why they live in `parts/shared/`.

The two parts dropped first:
- `frame-crossbeam.stl` (Onshape: `combined_internal_bracket`) — the crossbeam.
- `frame-90deg-bracket.stl` (Onshape: `inner_90_bracket`) — the 90° bracket.

## How the program models this

`parts.json` lists every printed part with:
- `qty_per_layer`, `qty_per_interface`, `qty_per_feeder` — how many in each subsystem.
- `category` — `feeder` / `layer` / `interface` / `shared`. Shared parts have both layer and interface quantities.
- `color` — required print color, or null if any color is fine.
- `optional` — true if not strictly required.

`filament.py` slices each STL once (cached) and reads the **slicer's own gram number** (`used_g` from the sliced 3mf — not an estimate), then totals it per layer / per interface / per machine for a configurable layer count.

## Slicer setup

- **OrcaSlicer** headless CLI (Bambu Studio's own CLI segfaults — known bug in 2.05; Orca is the upstream fork, same Bambu profiles).
- Profiles: **Bambu A1 0.4 nozzle**, **0.20mm Standard**, **Bambu PLA Basic** (1.26 g/cm³, $24.99/kg). Printer choice barely affects grams.
- Overrides: **15% infill, adaptive cubic**. Supports: **normal (auto), overhang threshold 10°** — note 10° is aggressive (default is 30°); it's a one-line knob in `filament.py`.
- Auto-orient on.

## Build config for Danny

1 layer. Color requirements live in the parent note: [[filament required to build a machine]].
