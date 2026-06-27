/**
 * Filament math. Everything downstream of `grams` comes from the slicer
 * (slicer/filament.py) — this module only multiplies by quantities and groups
 * by color. No estimation happens here.
 */
import raw from '$lib/data/parts.generated.json';
import { getLegoColor, type LegoColor } from '$lib/lego-colors';

export type Section = { id: string; name: string; scales_with_layers: boolean };
export type ColorRoleDef = { id: string; name: string; default: string };

/** A part's color is exactly one of these shapes. */
export type ColorSpec =
	| { role: string } // user picks a color for this role (frame, core, ...)
	| { fixed: string } // locked to one lego color id
	| { split: { color: string; qty: number }[] } // fixed multi-color (qtys sum to quantity)
	| { any: true }; // any color — user's choice per build

export type Part = {
	id: string;
	name: string;
	category: string;
	description: string;
	version: string;
	date_added: string;
	grams: number;
	support_used: boolean;
	print_seconds: number;
	quantity: number; // per ONE instance of its category
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
export const PARTS = raw.parts as Part[];
export const SPOOL_G = 1000;

const sectionById = new Map(SECTIONS.map((s) => [s.id, s]));

/** How many of a category exist per machine, given a layer count. */
export function categoryMultiplier(categoryId: string, layers: number): number {
	const s = sectionById.get(categoryId);
	return s?.scales_with_layers ? layers : 1;
}

/** Total count of `part` in a whole machine. */
export function machineQty(part: Part, layers: number): number {
	return part.quantity * categoryMultiplier(part.category, layers);
}

/** Break a part's per-instance count into (lego color id | null, qty) portions. */
export function colorPortions(
	part: Part,
	roleColors: Record<string, string>
): { colorId: string | null; qty: number }[] {
	const c = part.color;
	if ('split' in c) return c.split.map((s) => ({ colorId: s.color, qty: s.qty }));
	if ('fixed' in c) return [{ colorId: c.fixed, qty: part.quantity }];
	if ('role' in c) return [{ colorId: roleColors[c.role] ?? null, qty: part.quantity }];
	return [{ colorId: null, qty: part.quantity }]; // any
}

/** Distinct swatches to show for a part (resolved against role choices). */
export function partSwatches(
	part: Part,
	roleColors: Record<string, string>
): { color: LegoColor | null; qty: number }[] {
	return colorPortions(part, roleColors).map((p) => ({
		color: p.colorId ? getLegoColor(p.colorId) : null,
		qty: p.qty
	}));
}

export type BuyLine = {
	colorId: string | null;
	color: LegoColor | null;
	label: string;
	grams: number;
	spools: number;
	cost: number;
};

/** Group the whole machine's filament by resolved color → what to buy. */
export function buyList(
	layers: number,
	roleColors: Record<string, string>,
	includeOptional: boolean
): { lines: BuyLine[]; totalGrams: number; totalSpools: number; totalCost: number } {
	const byColor = new Map<string, number>();
	for (const part of PARTS) {
		if (part.optional && !includeOptional) continue;
		const mult = categoryMultiplier(part.category, layers);
		for (const portion of colorPortions(part, roleColors)) {
			const key = portion.colorId ?? '__any__';
			byColor.set(key, (byColor.get(key) ?? 0) + part.grams * portion.qty * mult);
		}
	}
	const cost = SETTINGS.cost_per_kg;
	const lines: BuyLine[] = [...byColor.entries()]
		.map(([key, grams]) => {
			const colorId = key === '__any__' ? null : key;
			const color = colorId ? getLegoColor(colorId) : null;
			return {
				colorId,
				color,
				label: color ? color.name : 'Any color',
				grams,
				spools: Math.max(1, Math.ceil(grams / SPOOL_G)),
				cost: (grams / 1000) * cost
			};
		})
		.sort((a, b) => b.grams - a.grams);
	const totalGrams = [...byColor.values()].reduce((a, b) => a + b, 0);
	const totalSpools = lines.reduce((a, b) => a + b.spools, 0);
	const totalCost = (totalGrams / 1000) * cost;
	return { lines, totalGrams, totalSpools, totalCost };
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
