/**
 * Filament math. Everything downstream of `grams` comes from the slicer
 * (slicer/filament.py) — this module only multiplies by quantities and groups
 * by color. No estimation happens here.
 */
import raw from '$lib/data/parts.generated.json';
import { getLegoColor, type LegoColor } from '$lib/lego-colors';

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
	description: string;
	version: string;
	date_added: string;
	grams: number;
	support_used: boolean;
	print_seconds: number;
	color: ColorSpec;
	optional: boolean;
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
export const PARTS = raw.parts as Part[];
export const SPOOL_G = 1000;

const sectionById = new Map(SECTIONS.map((s) => [s.id, s]));
const assemblyById = new Map(ASSEMBLIES.map((a) => [a.id, a]));

export function categoryMultiplier(categoryId: string, layers: number): number {
	return sectionById.get(categoryId)?.scales_with_layers ? layers : 1;
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
		n += qty * categoryMultiplier(cat, layers);
	}
	return n;
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
): { color: LegoColor | null; qty: number }[] {
	return colorUnits(part, sectionQty(part, sectionId), roleColors).map((u) => ({
		color: u.colorId ? getLegoColor(u.colorId) : null,
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
	color: LegoColor | null;
	label: string;
	grams: number;
	spools: number;
	cost: number;
};

/** Group the SELECTED parts' filament by resolved color, with bulk-tier pricing. */
export function buyList(
	layers: number,
	roleColors: Record<string, string>,
	isSelected: (id: string) => boolean
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
		for (const [cat, qty] of Object.entries(part.quantities)) {
			const mult = categoryMultiplier(cat, layers);
			for (const u of colorUnits(part, qty, roleColors)) {
				const key = u.colorId ?? '__any__';
				byColor.set(key, (byColor.get(key) ?? 0) + part.grams * u.count * mult);
			}
		}
	}
	const rows = [...byColor.entries()].map(([key, grams]) => ({
		key,
		grams,
		spools: Math.max(1, Math.ceil(grams / SPOOL_G))
	}));
	const totalSpools = rows.reduce((a, e) => a + e.spools, 0);
	const perSpool = pricePerSpool(totalSpools);
	const lines: BuyLine[] = rows
		.map((e) => {
			const colorId = e.key === '__any__' ? null : e.key;
			const color = colorId ? getLegoColor(colorId) : null;
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
