/**
 * CSV export of the hardware list.
 *
 * The point is that the file stands on its own: someone should be able to hand
 * it to an assistant and ask "which screw multipacks cover 90% of this?" and
 * have every fact needed to answer — thread, length, head type, counts, pack
 * sizes, prices, and where each item is used. So it carries the detail the
 * page shows, not just id and quantity.
 */
import {
	hardwareLengthLabel,
	usagePaths,
	type Hardware,
	type Vendor
} from '$lib/filament';

/** The machine this list was resolved for. Only the release is fixed today;
 *  configuration (layer count) is the part that actually varies. */
export type ExportSpec = { release: string; layers: number; date: string };

const COLUMNS = [
	'id',
	'name',
	'category',
	'type',
	'thread',
	'length_mm',
	'head',
	'qty_needed',
	'qty_source',
	'buy_units',
	'unit',
	'vendor',
	'region',
	'unit_price_usd',
	'pack_qty',
	'packs_to_buy',
	'est_cost_usd',
	'price_as_of',
	'url',
	'description',
	'note',
	'specs',
	'used_in'
] as const;

/** RFC 4180: quote everything with a comma, quote, or newline; double inner quotes. */
function cell(v: unknown): string {
	if (v == null) return '';
	const s = String(v);
	return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Where an item lives, as a readable path — "machine > feeder > c-channel",
 *  with the printed part named when the hardware is committed to one. */
function usedIn(h: Hardware, layers: number): string {
	return usagePaths(h.id, layers)
		.map((p) => {
			const chain = p.steps.map((s) => s.assembly.name).join(' > ');
			return `${chain}${p.via ? ` > ${p.via.name}` : ''} (${p.qty})`;
		})
		.join(' | ');
}

export function toCsv(
	items: Hardware[],
	opts: {
		layers: number;
		qty: (h: Hardware) => number | null;
		qtySource: (h: Hardware) => string | null;
		buyUnits: (h: Hardware, qty: number | null) => number | null;
		vendor: (h: Hardware) => Vendor | null;
		packs: (v: Vendor, qty: number) => number;
	}
): string {
	const rows = items.map((h) => {
		const qty = opts.qty(h);
		const units = opts.buyUnits(h, qty);
		const v = opts.vendor(h) ?? h.sourcing?.vendors?.[0] ?? null;
		// only meaningful when the listing actually sells in packs; otherwise the
		// buyer is counting individual pieces and "1 pack" would be a lie
		const packs = v?.pack_qty && units != null ? opts.packs(v, units) : null;
		const cost = v?.price != null && packs != null ? +(packs * v.price).toFixed(2) : null;
		return [
			h.id,
			h.name,
			h.category,
			h.cots?.type,
			h.cots?.size,
			h.cots?.length_mm,
			h.cots?.variant,
			qty,
			opts.qtySource(h),
			units,
			h.stock ? h.stock.unit_label : 'each',
			v?.vendor ?? v?.region,
			v?.region,
			v?.currency && v.currency !== 'USD' ? '' : v?.price,
			v?.pack_qty,
			packs,
			cost,
			v?.as_of,
			v?.url,
			h.description,
			h.note,
			(h.attributes ?? []).map((a) => `${a.label}: ${a.value}`).join('; '),
			usedIn(h, opts.layers)
		].map(cell);
	});
	return [COLUMNS.join(','), ...rows.map((r) => r.join(','))].join('\n') + '\n';
}

/** Self-describing filename: what machine, what configuration, what day. */
export function csvFilename(spec: ExportSpec): string {
	return `sorter-${spec.release}-hardware-${spec.layers}-layer-${spec.date}.csv`;
}

/** A header the reader (human or otherwise) can orient from before the table. */
export function csvPreamble(spec: ExportSpec, count: number): string {
	return (
		`# Sorter ${spec.release} — hardware list\n` +
		`# Configuration: ${spec.layers} distribution layers\n` +
		`# Generated: ${spec.date} from parts-calculator.basically.website\n` +
		`# Items: ${count}. Quantities marked qty_source=tree are summed from the\n` +
		`# machine assembly tree; sheet means a hand count not yet placed in it.\n`
	);
}
