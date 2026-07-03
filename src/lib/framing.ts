// Aluminium framing pieces for the machine — 2020 T-slot extrusion (20×20 mm,
// 6 mm slot), cut from 1 m black-anodized bars.
//
// Pieces split into two kinds, mirroring how the machine is built:
//   • per-layer — quantity scales with the layer count N
//   • const     — one set per machine, independent of N (the interface/base)
//
// Tolerance-sensitive pieces (C, D, E, F) are cut 6 mm short so the frame
// doesn't pinch the chute — 6 mm (vs ¼″) keeps every length a whole number.
// The short interface spoke (H) stays at CAD length, same as the layer spoke (B).

export const STOCK_MM = 1000;
export const CLEARANCE_MM = 6; // trim on tolerance-sensitive pieces (was ¼″; 6 mm keeps lengths whole)

export type FramingPiece = {
	letter: string;
	name: string;
	len: number; // mm
	category: 'per-layer' | 'const';
	from: string; // human note on where the quantity/length comes from
	qtyFor: (n: number) => number;
};

export const FRAMING_PIECES: FramingPiece[] = [
	// ---- per layer (×N) ----
	{ letter: 'A', name: 'Outer horizontal', len: 320, category: 'per-layer', from: '6 per layer', qtyFor: (n) => 6 * n },
	{ letter: 'B', name: 'Spoke', len: 158, category: 'per-layer', from: '6 per layer', qtyFor: (n) => 6 * n },
	{
		letter: 'C',
		name: 'Layer vertical support',
		len: 160 - CLEARANCE_MM,
		category: 'per-layer',
		from: '160 − 6 mm · top N−2 layers (bottom 2 joined into D)',
		qtyFor: (n) => 6 * Math.max(0, n - 2)
	},
	// ---- const (per machine) ----
	{ letter: 'D', name: 'Foot extension', len: 1.5 * (160 - CLEARANCE_MM), category: 'const', from: '1.5 × C · bottom 2 layers joined', qtyFor: (n) => (n >= 2 ? 6 : 0) },
	{ letter: 'E', name: 'Interface spoke (long)', len: 244 - CLEARANCE_MM, category: 'const', from: '244 − 6 mm', qtyFor: () => 6 },
	{ letter: 'F', name: 'Interface vertical support', len: 280 - CLEARANCE_MM, category: 'const', from: '280 − 6 mm', qtyFor: () => 6 },
	{ letter: 'G', name: 'Horizontal interface frame', len: 320, category: 'const', from: 'per machine', qtyFor: () => 6 },
	{ letter: 'H', name: 'Interface spoke (short)', len: 158, category: 'const', from: 'per machine · same as spoke B', qtyFor: () => 6 }
];

export type LengthGroup = {
	len: number;
	qty: number;
	letters: string[];
	names: string[];
	label: string; // "A/G"
	category: 'per-layer' | 'const' | 'mixed';
};

// Collapse pieces that share a length into one bundle, using the layer count to
// resolve per-layer quantities. Pieces with zero quantity at this N are dropped.
export function lengthGroups(n: number, pieces: FramingPiece[] = FRAMING_PIECES): LengthGroup[] {
	const byLen = new Map<string, LengthGroup>();
	for (const p of pieces) {
		const qty = p.qtyFor(n);
		if (qty <= 0) continue;
		const key = p.len.toFixed(3);
		let g = byLen.get(key);
		if (!g) {
			g = { len: p.len, qty: 0, letters: [], names: [], label: '', category: p.category };
			byLen.set(key, g);
		}
		g.qty += qty;
		g.letters.push(p.letter);
		g.names.push(p.name);
		if (g.category !== p.category) g.category = 'mixed';
	}
	const groups = [...byLen.values()];
	for (const g of groups) g.label = g.letters.join('/');
	groups.sort((a, b) => b.len - a.len); // longest first
	return groups;
}
