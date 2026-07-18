/**
 * Filament math. Everything downstream of `grams` comes from the slicer
 * (slicer/filament.py) — this module only multiplies by quantities and groups
 * by color. No estimation happens here.
 */
import raw from '$lib/data/parts.generated.json';
import platesRaw from '$lib/data/plates.generated.json';
import { getBambuColor, type BambuColor } from '$lib/bambu-colors';

export type PlatePart = { name: string; count: number; part_id: string | null };
export type Plate = { id: string; name: string; download: string; thumbs: string[]; parts: PlatePart[] };
export const PLATES = platesRaw as Plate[];
const _platesByPart = new Map<string, Plate[]>();
for (const pl of PLATES)
	for (const pp of pl.parts)
		if (pp.part_id) (_platesByPart.get(pp.part_id) ?? _platesByPart.set(pp.part_id, []).get(pp.part_id)!).push(pl);
export function platesForPart(id: string): Plate[] {
	return _platesByPart.get(id) ?? [];
}

export type Section = {
	id: string;
	name: string;
	scales_with_layers: boolean;
	experimental?: boolean; // early / subject to heavy change — surfaced with a warning
	experimental_note?: string | null;
};
export type ColorRoleDef = { id: string; name: string; default: string };

/** One BOM line of an assembly: a child part or sub-assembly with a quantity.
 *  qty 'per-layer' multiplies by the total configured layer count;
 *  'middle-layers' by (count − 2) — the layers between the two interfaces. */
export type AssemblyLine = {
	part?: string;
	assembly?: string;
	qty: number | 'per-layer' | 'middle-layers';
};

/** Assemblies double as (a) legacy flat groupings the parts list rolls up under
 *  and (b) nodes of the experimental machine tree (when they carry `lines`).
 *  status: 'stub' = placeholder with nothing inside yet, 'partial' = some lines
 *  filled in but not everything the real assembly contains. */
export type Assembly = {
	id: string;
	name: string;
	description: string;
	status?: 'stub' | 'partial';
	lines?: AssemblyLine[];
};

/** Hardware committed to a single physical part (heat inserts, press-fit
 *  bearings). Scales automatically with the part count. */
export type Requirement = { part: string; qty: number };

export type Vendor = {
	region: string;
	vendor?: string;
	url: string;
	price?: number;
	currency?: string; // absent = USD
	pack_qty?: number;
	as_of?: string;
	note?: string;
};

/** A COTS (off-the-shelf) part: no STL, carries sourcing instead.
 *  sheet_qty/sheet_qty_text are transitional hand counts from the BOM sheet,
 *  kept until each part is placed as requires/lines in the assembly tree. */
export type Hardware = {
	id: string;
	kind: 'cots';
	cots?: { type: string; size?: string; variant?: string } | null;
	name: string;
	category?: string | null;
	description: string;
	note?: string | null;
	created_at: string;
	updated_at: string;
	attributes: { label: string; value: string }[];
	sheet_qty?: { per_machine?: number; per_layer?: number } | null;
	sheet_qty_text?: string | null;
	sourcing?: { vendors: Vendor[] } | null;
	image: string | null; // content-addressed bucket URL
};

/** A part's color is exactly one of these shapes. `by_section` lets a part that
 *  lives in multiple sections resolve a different color per section. */
export type ColorSpec =
	| { role: string }
	| { fixed: string }
	| { split: { color: string; qty: number }[] }
	| { by_section: Record<string, ColorSpec> }
	| { any: true };

/** One entry in a part archetype's version history. `commit` ties the version to
 *  a real git commit (null = pending an upcoming clean commit). OnShape links live
 *  at the version level: `onshape_doc` is the live document, `onshape_version` the
 *  immutable OnShape version this STL was exported from. */
export type PartVersion = {
	version: string;
	date: string;
	message: string;
	commit: string | null;
	onshape_doc?: string | null;
	onshape_version?: string | null;
	// archived assets for this version (old geometry pulled from git); the current
	// version reuses the live part asset. grams may be null if it couldn't slice.
	stl?: string;
	render?: string;
	grams?: number | null;
};

export type Part = {
	id: string;
	name: string;
	quantities: Record<string, number>; // category id -> count per ONE instance of that category
	assembly: string | null;
	variant_group?: string | null; // parts in a group are alternatives chosen per layer
	variant_name?: string | null;
	description: string;
	version: string;
	created_at: string;
	updated_at: string;
	versions?: PartVersion[]; // archetype history, newest last
	attributes?: { label: string; value: string }[]; // variant characteristics shown in the app
	grams: number; // total incl. any support
	support_grams: number; // the support portion of `grams`
	support_used: boolean; // slicer used support to slice this (may be auto-forced)
	support_intentional?: boolean; // the part *opts into* support in the manifest (vs. auto-forced)
	print_seconds: number;
	color: ColorSpec;
	optional: boolean;
	onshape?: string | null; // link to the source Onshape document, if known
	info?: string | null; // short note surfaced as an inline info popover
	suspicious?: boolean; // flagged as subject-to-change / possibly problematic
	suspicious_note?: string | null; // optional specifics for the suspicious warning
	low_tolerance?: boolean; // tight/precise fit — little tolerance for dimensional error, so a test print is worth doing
	low_tolerance_note?: string | null; // optional specifics for the low-tolerance warning
	// how the per-layer ('layer') quantity scales: every layer, all but the bottom,
	// or the bottom layer only (for bottom-layer-swapped parts like the foot cover)
	layer_scope?: 'all' | 'non-bottom' | 'bottom-only';
	requires?: Requirement[]; // hardware committed to this physical part
	stl: string;
	render: string;
};
export type Settings = {
	printer: string;
	process: string;
	filament: string;
	infill_density: string;
	infill_pattern: string;
	support_enabled: boolean;
	support_type: string;
	support_threshold_deg: number;
	density_g_cm3: number;
	cost_per_kg: number;
	commit_base_url?: string; // e.g. https://github.com/owner/repo/commit/
	all_parts_zip?: string; // content-addressed bucket URL for the every-part bundle
};

/** Full URL for a version's commit, or null when the commit isn't known yet. */
export function commitUrl(commit: string | null | undefined): string | null {
	const base = SETTINGS.commit_base_url;
	return commit && base ? `${base}${commit}` : null;
}

export const SETTINGS = raw.settings as Settings;
export const SECTIONS = raw.sections as Section[];
export const COLOR_ROLES = raw.color_roles as ColorRoleDef[];
export const ASSEMBLIES = (raw.assemblies ?? []) as Assembly[];
export const PARTS = raw.parts as unknown as Part[];
export const HARDWARE = ((raw as Record<string, unknown>).hardware ?? []) as Hardware[];
export const SPOOL_G = 1000;

const sectionById = new Map(SECTIONS.map((s) => [s.id, s]));
const assemblyById = new Map(ASSEMBLIES.map((a) => [a.id, a]));
const partById = new Map(PARTS.map((p) => [p.id, p]));
const hardwareById = new Map(HARDWARE.map((h) => [h.id, h]));

export function getPart(id: string): Part | undefined {
	return partById.get(id);
}
export function getHardware(id: string): Hardware | undefined {
	return hardwareById.get(id);
}

/** Resolve an assembly line's quantity. Total layer count n includes the top
 *  and bottom interface levels; 'middle-layers' is the n−2 between them. */
export function lineQty(line: AssemblyLine, layers: number): number {
	if (line.qty === 'per-layer') return layers;
	if (line.qty === 'middle-layers') return Math.max(0, layers - 2);
	return line.qty;
}

/** Sum every `requires` of every printed part reachable from an assembly,
 *  multiplied down the tree — the design doc's resolver, restricted to the
 *  hardware group. Returns hardware id -> total count. */
export function resolveHardwareTotals(root: string, layers: number): Map<string, number> {
	const acc = new Map<string, number>();
	const walk = (id: string, mult: number) => {
		for (const line of assemblyById.get(id)?.lines ?? []) {
			const q = lineQty(line, layers) * mult;
			if (line.assembly) walk(line.assembly, q);
			else if (line.part) {
				for (const r of partById.get(line.part)?.requires ?? []) {
					acc.set(r.part, (acc.get(r.part) ?? 0) + r.qty * q);
				}
			}
		}
	};
	walk(root, 1);
	return acc;
}

export function categoryMultiplier(categoryId: string, layers: number): number {
	return sectionById.get(categoryId)?.scales_with_layers ? layers : 1;
}

/** Layer multiplier for a part in a category, honoring its `layer_scope`.
 *  Distribution-frame ('layer') parts can apply to all layers, all but the
 *  bottom (standard brackets), or the bottom layer only (the foot cover). */
export function effectiveMult(part: Part, categoryId: string, layers: number): number {
	if (categoryId === 'layer') {
		if (part.layer_scope === 'non-bottom') return Math.max(0, layers - 1);
		if (part.layer_scope === 'bottom-only') return layers >= 1 ? 1 : 0;
	}
	return categoryMultiplier(categoryId, layers);
}

export function getAssembly(id: string | null): Assembly | undefined {
	return id ? assemblyById.get(id) : undefined;
}

/** The part's current OnShape links, taken from its latest version (a part-level
 *  `onshape` link is honored as a legacy document fallback). */
export function partOnshape(part: Part): { doc: string | null; version: string | null } {
	const v = part.versions?.[part.versions.length - 1];
	return {
		doc: v?.onshape_doc ?? part.onshape ?? null,
		version: v?.onshape_version ?? null
	};
}

/** Count of this part within one instance of a given category. */
export function sectionQty(part: Part, sectionId: string): number {
	return part.quantities[sectionId] ?? 0;
}

/** Total count of this part across a whole machine. */
export function machineQty(part: Part, layers: number): number {
	let n = 0;
	for (const [cat, qty] of Object.entries(part.quantities)) {
		n += qty * effectiveMult(part, cat, layers);
	}
	return n;
}

/** Count to show/charge for a part in a given section, honoring variant overrides. */
export function displayCount(
	part: Part,
	sectionId: string,
	layers: number,
	variantCount: (id: string) => number | null
): number {
	const vc = variantCount(part.id);
	if (vc !== null) return vc; // variant parts (e.g. funnels) are counted per layer-choice
	return sectionQty(part, sectionId) * effectiveMult(part, sectionId, layers);
}

/** Resolve a `by_section` color to the spec for one section (falls back to the
 *  first section's spec when the section isn't listed / isn't given). */
function resolveColor(c: ColorSpec, sectionId?: string): Exclude<ColorSpec, { by_section: unknown }> {
	if ('by_section' in c) {
		const sub = (sectionId && c.by_section[sectionId]) || Object.values(c.by_section)[0];
		return resolveColor(sub, sectionId);
	}
	return c;
}

/** Per-color unit breakdown of `catQty` pieces of a part (1 category instance). */
function colorUnits(
	part: Part,
	catQty: number,
	roleColors: Record<string, string>,
	sectionId?: string
): { colorId: string | null; count: number }[] {
	const c = resolveColor(part.color, sectionId);
	if ('split' in c) return c.split.map((s) => ({ colorId: s.color, count: s.qty }));
	if ('fixed' in c) return [{ colorId: c.fixed, count: catQty }];
	if ('role' in c) return [{ colorId: roleColors[c.role] ?? null, count: catQty }];
	return [{ colorId: null, count: catQty }];
}

/** The part's primary resolved color id (for the 3D preview default). */
export function primaryColorId(part: Part, roleColors: Record<string, string>): string | null {
	const c = resolveColor(part.color);
	if ('split' in c) return c.split[0]?.color ?? null;
	if ('fixed' in c) return c.fixed;
	if ('role' in c) return roleColors[c.role] ?? null;
	return null;
}

/** Swatches to display for a part within a section (resolved against roles). */
export function partSwatches(
	part: Part,
	sectionId: string,
	roleColors: Record<string, string>
): { color: BambuColor | null; qty: number }[] {
	return colorUnits(part, sectionQty(part, sectionId), roleColors, sectionId).map((u) => ({
		color: u.colorId ? getBambuColor(u.colorId) : null,
		qty: u.count
	}));
}

// Bambu Lab PLA Matte, with-spool pricing (same tiers as Basic). Bulk discount keys off the TOTAL roll
// count in the order (mix-and-match across colors). From the Bambu US store.
export const STORE_URL = 'https://us.store.bambulab.com/collections/filament-bulk-sale';
export const PRICE_TIERS = [
	{ minSpools: 6, pricePerSpool: 16.99 },
	{ minSpools: 4, pricePerSpool: 17.99 },
	{ minSpools: 1, pricePerSpool: 24.99 }
];
export function pricePerSpool(totalSpools: number): number {
	return (PRICE_TIERS.find((t) => totalSpools >= t.minSpools) ?? PRICE_TIERS.at(-1)!).pricePerSpool;
}

export type BuyLine = {
	colorId: string | null;
	color: BambuColor | null;
	label: string;
	grams: number;
	spools: number;
	cost: number;
};

/** Grams counted for a part: total when its support is included, else object-only. */
export function effectiveGrams(part: Part, inclSupport: boolean): number {
	return inclSupport ? part.grams : part.grams - part.support_grams;
}

/** Group the SELECTED parts' filament by resolved color, with bulk-tier pricing.
 *  `inclSupport(id)` decides whether a part's support material counts.
 *  `surplusPct` adds a buffer (incidental parts / failed prints) before spool counts. */
export function buyList(
	layers: number,
	roleColors: Record<string, string>,
	isSelected: (id: string) => boolean,
	inclSupport: (id: string) => boolean,
	variantCount: (id: string) => number | null,
	surplusPct = 0
): {
	lines: BuyLine[];
	totalGrams: number;
	totalSpools: number;
	totalCost: number;
	perSpool: number;
} {
	const byColor = new Map<string, number>();
	for (const part of PARTS) {
		if (!isSelected(part.id)) continue;
		const each = effectiveGrams(part, inclSupport(part.id));
		const vc = variantCount(part.id);
		if (vc !== null) {
			// variant part (e.g. funnel): total machine count chosen per layer
			for (const u of colorUnits(part, vc, roleColors)) {
				const key = u.colorId ?? '__any__';
				byColor.set(key, (byColor.get(key) ?? 0) + each * u.count);
			}
			continue;
		}
		for (const [cat, qty] of Object.entries(part.quantities)) {
			const mult = effectiveMult(part, cat, layers);
			for (const u of colorUnits(part, qty, roleColors, cat)) {
				const key = u.colorId ?? '__any__';
				byColor.set(key, (byColor.get(key) ?? 0) + each * u.count * mult);
			}
		}
	}
	const buffer = 1 + surplusPct / 100;
	const rows = [...byColor.entries()].map(([key, raw]) => {
		const grams = raw * buffer;
		return { key, grams, spools: Math.max(1, Math.ceil(grams / SPOOL_G)) };
	});
	const totalSpools = rows.reduce((a, e) => a + e.spools, 0);
	const perSpool = pricePerSpool(totalSpools);
	const lines: BuyLine[] = rows
		.map((e) => {
			const colorId = e.key === '__any__' ? null : e.key;
			const color = colorId ? getBambuColor(colorId) : null;
			return {
				colorId,
				color,
				label: color ? color.name : 'Any color',
				grams: e.grams,
				spools: e.spools,
				cost: e.spools * perSpool
			};
		})
		.sort((a, b) => b.grams - a.grams);
	const totalGrams = rows.reduce((a, e) => a + e.grams, 0);
	return { lines, totalGrams, totalSpools, totalCost: totalSpools * perSpool, perSpool };
}

export function grams(n: number): string {
	return n >= 1000 ? `${(n / 1000).toFixed(2)} kg` : `${Math.round(n)} g`;
}
export function money(n: number): string {
	return `$${n.toFixed(2)}`;
}
/** Format an ISO date (YYYY-MM-DD) as e.g. "Jul 8, 2026". Empty in -> "". */
export function fmtDate(iso: string | undefined | null): string {
	if (!iso) return '';
	const [y, m, d] = iso.split('-').map(Number);
	if (!y || !m || !d) return iso;
	const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
	return `${months[m - 1]} ${d}, ${y}`;
}
export function duration(sec: number): string {
	const h = Math.floor(sec / 3600);
	const m = Math.round((sec % 3600) / 60);
	return h ? `${h}h ${m}m` : `${m}m`;
}
/** Longer-form for big totals: days + hours past 2 days, else h + m. */
export function durationLong(sec: number): string {
	const totalH = sec / 3600;
	if (totalH >= 48) {
		const d = Math.floor(totalH / 24);
		const h = Math.round(totalH - d * 24);
		return `${d}d ${h}h`;
	}
	return duration(sec);
}
