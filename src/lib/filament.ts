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

export type Section = { id: string; name: string; scales_with_layers: boolean };
export type ColorRoleDef = { id: string; name: string; default: string };
export type Assembly = { id: string; name: string; description: string };

/** A part's color is exactly one of these shapes. */
export type ColorSpec =
	| { role: string }
	| { fixed: string }
	| { split: { color: string; qty: number }[] }
	| { any: true };

export type Part = {
	id: string;
	name: string;
	quantities: Record<string, number>; // category id -> count per ONE instance of that category
	assembly: string | null;
	variant_group?: string | null; // parts in a group are alternatives chosen per layer
	variant_name?: string | null;
	description: string;
	version: string;
	date_added: string;
	grams: number; // total incl. any support
	support_grams: number; // the support portion of `grams`
	support_used: boolean;
	print_seconds: number;
	color: ColorSpec;
	optional: boolean;
	onshape?: string | null; // link to the source Onshape document, if known
	info?: string | null; // short note surfaced as an inline info popover
	// how the per-layer ('layer') quantity scales: every layer, all but the bottom,
	// or the bottom layer only (for bottom-layer-swapped parts like the foot cover)
	layer_scope?: 'all' | 'non-bottom' | 'bottom-only';
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
};

export const SETTINGS = raw.settings as Settings;
export const SECTIONS = raw.sections as Section[];
export const COLOR_ROLES = raw.color_roles as ColorRoleDef[];
export const ASSEMBLIES = (raw.assemblies ?? []) as Assembly[];
export const PARTS = raw.parts as unknown as Part[];
export const SPOOL_G = 1000;

const sectionById = new Map(SECTIONS.map((s) => [s.id, s]));
const assemblyById = new Map(ASSEMBLIES.map((a) => [a.id, a]));

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

/** Per-color unit breakdown of `catQty` pieces of a part (1 category instance). */
function colorUnits(
	part: Part,
	catQty: number,
	roleColors: Record<string, string>
): { colorId: string | null; count: number }[] {
	const c = part.color;
	if ('split' in c) return c.split.map((s) => ({ colorId: s.color, count: s.qty }));
	if ('fixed' in c) return [{ colorId: c.fixed, count: catQty }];
	if ('role' in c) return [{ colorId: roleColors[c.role] ?? null, count: catQty }];
	return [{ colorId: null, count: catQty }];
}

/** The part's primary resolved color id (for the 3D preview default). */
export function primaryColorId(part: Part, roleColors: Record<string, string>): string | null {
	const c = part.color;
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
	return colorUnits(part, sectionQty(part, sectionId), roleColors).map((u) => ({
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
			for (const u of colorUnits(part, qty, roleColors)) {
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
