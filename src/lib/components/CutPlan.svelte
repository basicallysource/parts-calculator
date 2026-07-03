<script lang="ts">
	import { Info } from 'lucide-svelte';
	import { FRAMING_PIECES, STOCK_MM, CLEARANCE_MM } from '$lib/framing';
	import { layerStore } from '$lib/layers.svelte';
	import { ftin, expand, packOptimal, packBundle, planGroups } from '$lib/cutplan';
	import Popover from '$lib/components/Popover.svelte';

	let stock = $state(STOCK_MM);
	let kerf = $state(3);
	let mode = $state<'opt' | 'bun'>('opt');

	const n = $derived(layerStore.sizes.length);
	const pieces = $derived(
		FRAMING_PIECES.map((p) => ({
			letter: p.letter,
			name: p.name,
			cadLen: p.cadLen,
			len: p.len,
			qty: p.qtyFor(n),
			cat: p.category,
			from: p.from
		})).filter((p) => p.qty > 0)
	);
	function lettersFor(len: number): string {
		return pieces.filter((p) => Math.abs(p.len - len) < 0.02).map((p) => p.letter).join('/') || '?';
	}
	// rows grouped by category, with a header injected when the category changes
	const rows = $derived.by(() => {
		let last: string | null = null;
		return pieces.map((p) => {
			const header = p.cat !== last ? p.cat : null;
			last = p.cat;
			return { p, header };
		});
	});

	const units = $derived(expand(pieces));
	const oversize = $derived(units.filter((u) => u.len > stock + 1e-6));
	const bins = $derived(
		oversize.length ? [] : mode === 'opt' ? packOptimal(units, stock, kerf) : packBundle(units, stock, kerf)
	);
	const scrap = $derived(bins.reduce((s, b) => s + (stock - b.consumed), 0));
	const totalLen = $derived(units.reduce((s, u) => s + u.len, 0));

	const metrics = $derived([
		{ k: 'Bars needed', v: `${bins.length}` },
		{ k: 'Stock used', v: `${((bins.length * stock) / 1000).toFixed(2)}`, unit: 'm' },
		{ k: 'Material in parts', v: `${(totalLen / 1000).toFixed(2)}`, unit: 'm' },
		{ k: 'Scrap', v: bins.length ? `${((100 * scrap) / (bins.length * stock)).toFixed(1)}` : '0', unit: '%' }
	]);

	const sheet = $derived(
		planGroups(bins).map((g) => {
			const lens = g.lens;
			const homog = new Set(lens.map((l) => l.toFixed(2))).size === 1;
			let pos = 0;
			const marks: number[] = [];
			for (const L of lens) {
				pos += L;
				marks.push(pos);
				pos += kerf;
			}
			const leftover = stock - marks[marks.length - 1];
			const cnt: Record<string, number> = {};
			for (const l of lens) {
				const key = l.toFixed(3);
				cnt[key] = (cnt[key] || 0) + 1;
			}
			const contents = Object.entries(cnt).map(([l, c]) => ({ c, letters: lettersFor(+l), len: +l }));
			const markRows = lens.map((L, idx) => ({
				i: idx + 1,
				mm: marks[idx],
				ft: ftin(marks[idx]),
				len: L,
				letters: lettersFor(L)
			}));
			return { count: g.count, lens, homog, contents, leftover, scrapW: Math.max(0, leftover), markRows };
		})
	);

	const catLabel = (c: string) =>
		c === 'per-layer' ? `Per layer · ×${n}` : c === 'interface' ? 'Interface · per machine' : 'Feet · per machine';
	const scrapHatch =
		'repeating-linear-gradient(45deg,#f0eee7,#f0eee7 5px,#e2e0db 5px,#e2e0db 10px)';
</script>

<div class="space-y-6">
	<!-- cutting parameters -->
	<div class="setup-panel flex flex-wrap items-end gap-x-6 gap-y-3 p-4">
		<label class="flex flex-col gap-1">
			<span class="text-xs font-semibold uppercase tracking-wider text-text-muted">Stock (mm)</span>
			<input type="number" min="1" step="1" bind:value={stock} class="setup-control h-9 w-28 px-2 text-sm" />
		</label>
		<div class="flex flex-col gap-1">
			<span class="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-text-muted">
				Kerf (mm)
				<Popover
					width="w-64"
					label="What is kerf"
					text="Kerf is the width of material the saw blade removes on each cut. The plan leaves one kerf of spacing between pieces on a bar so every piece finishes at its exact length."
				/>
			</span>
			<input type="number" min="0" step="0.1" bind:value={kerf} class="setup-control h-9 w-28 px-2 text-sm" />
		</div>
		<div class="flex flex-col gap-1">
			<span class="text-xs font-semibold uppercase tracking-wider text-text-muted">Mode</span>
			<div class="flex">
				<button
					class="setup-button-secondary h-9 px-3 text-sm {mode === 'opt' ? 'setup-button-primary' : ''}"
					onclick={() => (mode = 'opt')}>Least waste</button
				>
				<button
					class="setup-button-secondary h-9 border-l-0 px-3 text-sm {mode === 'bun' ? 'setup-button-primary' : ''}"
					onclick={() => (mode = 'bun')}>Easy bundles</button
				>
			</div>
		</div>
	</div>

	<!-- pieces -->
	<div>
		<h3 class="mb-2 text-sm font-semibold text-text">Pieces — {n} layer{n === 1 ? '' : 's'}</h3>
		<div class="setup-card-shell border">
			<table class="w-full text-sm">
				<thead>
					<tr class="border-b border-border text-left text-xs uppercase tracking-wider text-text-muted">
						<th class="w-8 px-3 py-2"></th>
						<th class="px-1 py-2 font-semibold">Piece</th>
						<th class="px-2 py-2 text-right font-semibold">CAD length</th>
						<th class="px-2 py-2 text-right font-semibold">
							<span class="inline-flex items-center justify-end gap-1">
								Cut length
								<Popover
									align="right"
									width="w-72"
									label="Why some cut lengths differ from CAD"
									text={`Some pieces are cut ${CLEARANCE_MM} mm shorter than their CAD length on purpose. Sawn aluminium extrusion holds looser tolerances than 3D-printed parts, so the extra ${CLEARANCE_MM} mm of clearance keeps a slightly-off frame from clamping the chute.`}
								/>
							</span>
						</th>
						<th class="px-2 py-2 font-semibold"></th>
						<th class="px-2 py-2 text-right font-semibold">Qty</th>
						<th class="px-3 py-2 font-semibold">From</th>
					</tr>
				</thead>
				<tbody>
					{#each rows as { p, header } (p.letter)}
						{#if header}
							<tr class="bg-[var(--color-bg)]">
								<td colspan="7" class="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-text-muted">
									<span class="inline-flex items-center gap-1.5">
										{catLabel(header)}
										{#if header === 'feet'}
											<Popover
												width="w-72"
												label="Why the feet span two layers"
												text="The bottom two layers share one continuous length of extrusion that spans both — instead of a separate support per layer — so the wheels can sustain more force."
											/>
										{/if}
									</span>
								</td>
							</tr>
						{/if}
						<tr class="border-t border-border">
							<td class="px-3 py-2">
								<span class="inline-flex h-[22px] w-[22px] items-center justify-center bg-text font-mono text-xs font-semibold text-[var(--color-primary-contrast)]">{p.letter}</span>
							</td>
							<td class="px-1 py-2 text-text">{p.name}</td>
							<td class="whitespace-nowrap px-2 py-2 text-right font-mono tabular-nums text-text-muted">{p.cadLen} mm</td>
							<td class="whitespace-nowrap px-2 py-2 text-right font-mono tabular-nums text-text">{p.len} mm</td>
							<td class="whitespace-nowrap px-2 py-2 font-mono text-xs text-text-muted">{ftin(p.len)}</td>
							<td class="px-2 py-2 text-right font-mono tabular-nums text-text">{p.qty}</td>
							<td class="px-3 py-2 text-xs text-text-muted">{p.from}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>

	<!-- summary -->
	<div>
		<h3 class="mb-2 text-sm font-semibold text-text">Summary</h3>
		<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
			{#each metrics as m (m.k)}
				<div class="setup-card-shell border p-3">
					<div class="text-xs font-semibold uppercase tracking-wider text-text-muted">{m.k}</div>
					<div class="mt-1 font-mono text-xl font-semibold tabular-nums text-text">
						{m.v}{#if m.unit}<span class="ml-1 text-sm font-normal text-text-muted">{m.unit}</span>{/if}
					</div>
				</div>
			{/each}
		</div>
	</div>

	<!-- cut sheet -->
	<div>
		<h3 class="mb-2 text-sm font-semibold text-text">Cut sheet</h3>
		<div class="mb-3 flex gap-2 border border-primary/40 bg-primary/[0.06] px-3 py-2.5 text-sm text-text">
			<Info size={15} class="mt-0.5 shrink-0 text-primary" />
			<span>
				<span class="font-semibold text-primary-dark">How to read it:</span> lay your tape from one clean
				end of the bar (square that end first if it's ragged). Make every mark, then cut each one keeping
				the blade just to the <b>waste side</b> (the higher number) of the line. To cut a stack at once,
				line up the ends and mark/cut the top bar — the rest follow.
			</span>
		</div>

		{#if oversize.length}
			<div class="border border-danger/40 bg-danger/[0.06] px-3 py-2.5 text-sm text-text">
				<span class="font-semibold text-danger-dark">Can't fit:</span>
				{[...new Set(oversize.map((u) => `${u.letter} (${u.len} mm)`))].join(', ')} — longer than a usable
				bar ({stock} mm). Shorten them or use longer stock.
			</div>
		{:else}
			<div class="space-y-3">
				{#each sheet as g, gi (gi)}
					<div class="setup-card-shell border p-4">
						<div class="mb-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
							<span class="font-mono text-base font-semibold text-text">× {g.count} {g.count > 1 ? 'bars' : 'bar'}</span>
							{#if g.count > 1}<span class="text-sm text-text-muted">stack &amp; cut together</span>{/if}
							{#if g.homog}<span class="bg-success/10 px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-success-dark">all same length</span>{/if}
						</div>
						<div class="mb-3 text-sm text-text-muted">
							{#each g.contents as c, i (i)}{i > 0 ? ' · ' : ''}{c.c}× {c.letters}
								<span class="font-mono">({c.len.toFixed(2)} mm)</span>{/each}
						</div>

						<!-- to-scale diagram of one bar -->
						<div class="mb-1 flex h-9 overflow-hidden border border-border bg-white">
							{#each g.lens as L, i (i)}
								<div class="flex min-w-0 items-center justify-center overflow-hidden font-mono text-xs font-semibold text-white {i % 2 ? 'bg-[#3a3a38]' : 'bg-text'}" style="flex: {L} 0 0">{lettersFor(L)}</div>
								<div class="w-[2px] shrink-0 bg-primary"></div>
							{/each}
							{#if g.scrapW > 2}
								<div class="flex items-center justify-center text-xs text-text-muted" style="flex: {g.scrapW} 0 0; background: {scrapHatch}">scrap</div>
							{/if}
						</div>

						<table class="w-full text-sm">
							<thead>
								<tr class="text-left text-xs uppercase tracking-wider text-text-muted">
									<th class="py-1 pr-2 font-semibold">#</th>
									<th class="py-1 pr-2 font-semibold">Mark (mm)</th>
									<th class="py-1 pr-2 font-semibold">ft &amp; in (¹⁄₁₆)</th>
									<th class="py-1 font-semibold">Frees</th>
								</tr>
							</thead>
							<tbody>
								{#each g.markRows as m (m.i)}
									<tr class="border-t border-border">
										<td class="py-1 pr-2"><span class="inline-flex h-5 min-w-[20px] items-center justify-center bg-primary/[0.08] px-1 font-mono text-xs font-semibold text-primary">{m.i}</span></td>
										<td class="py-1 pr-2 font-mono font-semibold text-text">{m.mm.toFixed(1)} mm</td>
										<td class="py-1 pr-2 font-mono text-text-muted">{m.ft}</td>
										<td class="py-1 text-text-muted">→ {m.len.toFixed(2)} mm piece <b class="font-mono text-text">{m.letters}</b></td>
									</tr>
								{/each}
							</tbody>
						</table>
						<div class="mt-2 text-xs text-text-muted">
							{#if g.leftover > kerf + 0.5}Off-cut after last mark ≈ {(g.leftover - kerf).toFixed(0)} mm.{:else}Last piece reaches the bar end — no final cut needed.{/if}
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>

	<!-- notes -->
	<div>
		<h3 class="mb-2 text-sm font-semibold text-text">Notes</h3>
		<ul class="space-y-2 text-sm leading-relaxed text-text-muted">
			<li>
				Pieces that share a cut length stack together at the saw — mark and cut the top bar, the rest
				follow: <b class="text-text">A &amp; G</b> = 320 mm, <b class="text-text">B &amp; H</b> = 158 mm.
			</li>
			<li>
				Where the cut length is under the CAD length, the piece is trimmed {CLEARANCE_MM} mm for
				tolerance (see the <b class="text-text">Cut length</b> note above).
			</li>
		</ul>
	</div>
</div>
