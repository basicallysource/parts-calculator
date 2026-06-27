/**
 * Filament math. All numbers downstream of `grams` come from the slicer
 * (see slicer/filament.py) — this module only multiplies by quantities and
 * groups by color. No estimation happens here.
 */
import raw from '$lib/data/parts.generated.json';
import { getLegoColor, type LegoColor } from '$lib/lego-colors';

export type Section = { id: string; name: string; scales_with_layers: boolean };
export type ColorRoleDef = { id: string; name: string; default: string };
export type Part = {
	id: string;
	name: string;
	grams: number;
	support_used: boolean;
	print_seconds: number;
	color_role: string; // 'frame' | 'core' | 'any' | role id; fixed parts use fixed_color
	fixed_color: string | null;
	optional: boolean;
	quantities: Record<string, number>;
	stl: string;
	render: string;
	notes: string;
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

/** How many of `part` a whole machine needs, given a layer count. */
export function machineQty(part: Part, layers: number): number {
	let n = 0;
	for (const s of SECTIONS) {
		const q = part.quantities[s.id] ?? 0;
		n += q * (s.scales_with_layers ? layers : 1);
	}
	return n;
}

/** Quantity of `part` within one instance of a given section. */
export function sectionQty(part: Part, sectionId: string): number {
	return part.quantities[sectionId] ?? 0;
}

/** Resolve the LEGO color id a part will be printed in. */
export function resolveColorId(part: Part, roleColors: Record<string, string>): string | null {
	if (part.fixed_color) return part.fixed_color;
	if (part.color_role in roleColors) return roleColors[part.color_role];
	return null; // "any color" — user's choice per build
}

export type BuyLine = {
	colorId: string | null;
	color: LegoColor | null;
	label: string;
	grams: number;
	spools: number; // whole 1 kg spools to buy
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
		const qty = machineQty(part, layers);
		if (qty <= 0) continue;
		const cid = resolveColorId(part, roleColors);
		const key = cid ?? '__any__';
		byColor.set(key, (byColor.get(key) ?? 0) + part.grams * qty);
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
