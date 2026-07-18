<script lang="ts">
	import { ExternalLink, ImageOff } from 'lucide-svelte';
	import Callout from '$lib/components/Callout.svelte';
	import LayerControl from '$lib/components/LayerControl.svelte';
	import { HARDWARE, resolveHardwareTotals, type Hardware, type Vendor } from '$lib/filament';
	import { layerStore } from '$lib/layers.svelte';

	// Every off-the-shelf part from the BOM sheet, in the unified data format.
	// Quantities are still the sheet's hand counts (sheet_qty) — they become
	// derived from the assembly tree as parts get placed there.
	const layers = $derived(layerStore.sizes.length);

	// categories in sheet order, preserving first-seen order of the manifest
	const groups = $derived.by(() => {
		const by = new Map<string, Hardware[]>();
		for (const h of HARDWARE) {
			const cat = h.category ?? 'Other';
			if (!by.has(cat)) by.set(cat, []);
			by.get(cat)!.push(h);
		}
		return [...by.entries()];
	});

	// parts already placed in the assembly tree get their count computed from it
	const treeTotals = $derived(resolveHardwareTotals('machine', layers));

	/** Machine total for a part: tree-derived when placed, else the sheet count. */
	function totalQty(h: Hardware, layers: number): number | null {
		const fromTree = treeTotals.get(h.id);
		if (fromTree != null) return fromTree;
		if (h.sheet_qty?.per_machine != null) return h.sheet_qty.per_machine;
		if (h.sheet_qty?.per_layer != null) return h.sheet_qty.per_layer * layers;
		return null;
	}

	const fmtPrice = (v: Vendor) =>
		v.price == null ? null : v.currency === 'EUR' ? `€${v.price.toFixed(2)}` : `$${v.price.toFixed(2)}`;

	/** Buy cost at a vendor for a total quantity (pack math), USD vendors only. */
	function buyCost(v: Vendor, qty: number | null): number | null {
		if (v.price == null || v.currency === 'EUR') return null;
		if (qty == null) return null;
		const packs = v.pack_qty ? Math.ceil(qty / v.pack_qty) : 1;
		return packs * v.price;
	}

	// rough US total: cheapest US-priced vendor per part, pack math included
	const usTotal = $derived.by(() => {
		let sum = 0;
		let priced = 0;
		for (const h of HARDWARE) {
			const qty = totalQty(h, layers);
			const costs = (h.sourcing?.vendors ?? [])
				.filter((v) => v.region === 'US')
				.map((v) => buyCost(v, qty))
				.filter((c): c is number => c != null);
			if (costs.length) {
				sum += Math.min(...costs);
				priced++;
			}
		}
		return { sum, priced };
	});
</script>

<svelte:head><title>Sorter Parts Calculator — Hardware</title></svelte:head>

<div class="mx-auto max-w-6xl px-4 py-8 sm:px-6">
	<header class="mb-5">
		<h1 class="text-2xl font-bold text-text">Hardware</h1>
		<p class="mt-1 max-w-3xl text-sm text-text-muted">
			Everything you buy off the shelf — cameras, motors, bearings, electronics — with sources
			and pack-quantity math. Imported from the Sorter V2 BOM sheet; screws and extrusion live on
			their own tabs.
		</p>
	</header>

	<div class="mb-5">
		<Callout variant="info" title="Quantities are still hand-counted">
			These counts come straight from the BOM spreadsheet. As parts get placed into the machine
			assembly tree they switch to being computed from it, like the heat inserts already are.
		</Callout>
	</div>

	<div class="mb-6"><LayerControl /></div>

	<div class="setup-card-shell mb-6 flex flex-wrap items-baseline justify-between gap-2 border p-4">
		<span class="text-xs font-semibold uppercase tracking-wider text-text-muted">
			Rough US total (cheapest listed source per part, whole packs)
		</span>
		<span class="text-lg font-bold tabular-nums text-text">
			${usTotal.sum.toFixed(2)}
			<span class="text-xs font-normal text-text-muted">across {usTotal.priced} priced parts</span>
		</span>
	</div>

	{#each groups as [cat, items] (cat)}
		<section class="mb-8">
			<h2 class="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">{cat}</h2>
			<div class="grid gap-4 sm:grid-cols-2">
				{#each items as h (h.id)}
					{@const qty = totalQty(h, layers)}
					<div class="setup-card-shell flex flex-col border">
						<div class="flex gap-3 p-3">
							{#if h.image}
								<img
									src={h.image}
									alt={h.name}
									class="h-20 w-20 shrink-0 border border-border bg-white object-contain p-1"
								/>
							{:else}
								<div
									class="flex h-20 w-20 shrink-0 items-center justify-center border border-border bg-[var(--color-bg)] text-text-muted"
								>
									<ImageOff size={20} />
								</div>
							{/if}
							<div class="min-w-0 flex-1">
								<div class="flex items-start justify-between gap-2">
									<h3 class="text-sm font-semibold text-text">{h.name}</h3>
									<span class="shrink-0 text-right text-xs tabular-nums text-text-muted">
										{#if h.sheet_qty_text}
											{h.sheet_qty_text}
										{:else if h.sheet_qty?.per_layer != null}
											<span class="font-semibold text-text">{qty}</span> ({h.sheet_qty.per_layer}/layer)
										{:else if qty != null}
											<span class="font-semibold text-text">×{qty}</span>
										{:else}
											qty TBD
										{/if}
									</span>
								</div>
								<p class="mt-0.5 text-xs text-text-muted">{h.description}</p>
							</div>
						</div>
						{#if h.note}
							<p class="border-t border-border bg-warning/[0.06] px-3 py-2 text-xs text-warning-dark">
								{h.note}
							</p>
						{/if}
						<div class="mt-auto border-t border-border px-3 py-2">
							{#if h.sourcing?.vendors?.length}
								{#each h.sourcing.vendors as v (v.url)}
									{@const cost = buyCost(v, qty)}
									<div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 py-0.5 text-xs">
										<a
											href={v.url}
											target="_blank"
											rel="noopener"
											class="inline-flex items-center gap-1 font-medium text-primary hover:text-primary-hover"
											title={v.note ?? v.as_of ? `${v.note ?? ''}${v.note && v.as_of ? ' · ' : ''}${v.as_of ? `price as of ${v.as_of}` : ''}` : undefined}
										>
											{v.vendor ?? v.region}
											<span class="font-normal text-text-muted">({v.region})</span>
											<ExternalLink size={11} />
										</a>
										<span class="tabular-nums text-text-muted">
											{#if fmtPrice(v)}
												{fmtPrice(v)}{v.pack_qty && v.pack_qty > 1 ? ` / ${v.pack_qty}` : ''}
												{#if cost != null && v.pack_qty && cost !== v.price}
													→ <span class="font-semibold text-text">${cost.toFixed(2)}</span>
												{/if}
											{:else}
												no price
											{/if}
										</span>
									</div>
								{/each}
							{:else}
								<p class="py-0.5 text-xs text-text-muted">No source picked yet.</p>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		</section>
	{/each}
</div>
