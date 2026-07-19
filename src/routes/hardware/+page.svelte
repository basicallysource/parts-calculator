<script lang="ts">
	import { ChevronDown, ChevronRight, ExternalLink, ImageOff, ShoppingCart, Zap } from 'lucide-svelte';
	import Badge from '$lib/components/Badge.svelte';
	import HardwareIcon from '$lib/components/HardwareIcon.svelte';
	import Callout from '$lib/components/Callout.svelte';
	import LayerControl from '$lib/components/LayerControl.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import {
		assembliesContaining,
		getHardware,
		getPart,
		HARDWARE,
		hardwareImage,
		SIZE_COLORS,
		usagePaths,
		hardwareLengthLabel,
		JOIN_LABELS,
		lineQty,
		resolveHardwareTotals,
		type Assembly,
		type Hardware,
		type Vendor
	} from '$lib/filament';
	import { layerStore } from '$lib/layers.svelte';
	import { hardwareCsv } from '$lib/hardware-csv';
	import { download, exportSpec, filename } from '$lib/csv';
	import { ArrowUpRight, Download } from 'lucide-svelte';

	// Every off-the-shelf part from the BOM sheet, in the unified data format.
	// Quantities come from the assembly tree wherever a part has been placed in
	// it; the sheet's hand counts (sheet_qty) are the fallback for the rest.
	const layers = $derived(layerStore.sizes.length);

	// categories in manifest order, preserving first-seen order
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

	/** Where a count came from — a hand count carries much less confidence than one
	 *  summed out of the tree, and the difference is worth showing. */
	function qtySource(h: Hardware): 'tree' | 'sheet' | null {
		if (treeTotals.has(h.id)) return 'tree';
		return h.sheet_qty?.per_machine != null || h.sheet_qty?.per_layer != null ? 'sheet' : null;
	}
	const QTY_TITLE = {
		tree: 'Counted from the assembly tree',
		sheet: 'Hand count carried over from the BOM sheet — not yet placed in the assembly tree'
	};

	/** Quantity in the units a vendor actually sells. Stock material is tallied in
	 *  cut pieces but bought as whole lengths, so four 1 ft pieces is one rod —
	 *  every price and pack calculation has to go through here. */
	function buyUnits(h: Hardware, qty: number | null): number | null {
		if (qty == null) return null;
		return h.stock ? Math.ceil(qty / h.stock.pieces_per_unit) : qty;
	}

	// ------------------------------------------------------------------ joints
	// A part that gets soldered/crimped/glued to something else says so here, but
	// the fact lives on the assembly that joins them, not on the part — see
	// `joining` in $lib/filament. This page just reads it back out.
	const jointsOf = (h: Hardware) => assembliesContaining(h.id).filter((a) => a.joining?.length);

	/** An assembly with nothing but bought parts in it — no printed members, no
	 *  sub-assemblies. This page is a shopping list, so only those are ITS kind of
	 *  assembly: buy the pieces, join them, done. A light post is three printed
	 *  parts and some screws; it belongs on the parts tab, not here. */
	const isAllHardware = (a: Assembly) =>
		!!a.lines?.length && a.lines.every((l) => l.part != null && getHardware(l.part) != null);

	/** The other members of an assembly, resolved to a display name and quantity. */
	function siblings(asm: Assembly, selfId: string) {
		return (asm.lines ?? [])
			.filter((l) => l.part && l.part !== selfId)
			.map((l) => {
				const id = l.part!;
				return {
					id,
					name: getHardware(id)?.name ?? getPart(id)?.name ?? id,
					qty: lineQty(l, layers)
				};
			});
	}

	// Bought parts that are joined into one unit collapse to a single rollup row —
	// a Pico and its header pins are one purchase and one soldering job. Only
	// all-hardware assemblies qualify (see isAllHardware): a screw that self-taps
	// into a printed bracket is joined to plastic, not to other hardware, so it
	// stays its own row and explains itself on its detail modal instead.
	type Block = { kind: 'item'; hw: Hardware } | { kind: 'assembly'; asm: Assembly; items: Hardware[] };
	function groupBlocks(items: Hardware[]): Block[] {
		const blocks: Block[] = [];
		const claimed = new Set<string>();
		for (const h of items) {
			if (claimed.has(h.id)) continue;
			// members that live in this same category; the rollup lands where the
			// first one would have been, so category order is otherwise untouched
			const asm = jointsOf(h)
				.filter(isAllHardware)
				.find((a) => items.filter((m) => (a.lines ?? []).some((l) => l.part === m.id)).length > 1);
			if (!asm) {
				blocks.push({ kind: 'item', hw: h });
				continue;
			}
			const members = items.filter((m) => (asm.lines ?? []).some((l) => l.part === m.id));
			members.forEach((m) => claimed.add(m.id));
			blocks.push({ kind: 'assembly', asm, items: members });
		}
		return blocks;
	}

	let expandedAsm = $state<Record<string, boolean>>({});
	const asmAllOn = (items: Hardware[]) => items.every((h) => selected[h.id]);
	const asmSomeOn = (items: Hardware[]) => items.some((h) => selected[h.id]);
	const setAsm = (items: Hardware[], on: boolean) => {
		for (const h of items) selected[h.id] = on;
	};
	/** What the whole joined unit costs at the cheapest US vendor for each member. */
	const asmCost = (items: Hardware[]) =>
		items.reduce((sum, h) => {
			const v = bestUsVendor(h);
			return sum + (v ? (buyCost(v, buyUnits(h, totalQty(h, layers))) ?? 0) : 0);
		}, 0);

	const fmtPrice = (v: Vendor) =>
		v.price == null ? null : v.currency === 'EUR' ? `€${v.price.toFixed(2)}` : `$${v.price.toFixed(2)}`;

	/** Buy cost at a vendor for a total quantity (pack math), USD vendors only. */
	function buyCost(v: Vendor, qty: number | null): number | null {
		if (v.price == null || v.currency === 'EUR') return null;
		if (qty == null) return null;
		return packsNeeded(v, qty) * v.price;
	}

	/** Listings to buy — Amazon counts packs, not units. */
	function packsNeeded(v: Vendor, qty: number): number {
		return v.pack_qty ? Math.ceil(qty / v.pack_qty) : 1;
	}

	/** Cheapest US vendor with a price, which is what the cart and totals use. */
	function bestUsVendor(h: Hardware): Vendor | null {
		const priced = (h.sourcing?.vendors ?? []).filter(
			(v) => v.region === 'US' && v.price != null && v.currency !== 'EUR'
		);
		if (!priced.length) return null;
		return priced.reduce((a, b) => (a.price! <= b.price! ? a : b));
	}

	// ---------------------------------------------------------------- selection
	// Everything starts unselected; the cart is opt-in. Only hardware with a
	// priced US vendor is buyable — "select all" and the total only ever touch
	// those, so an in-house part with no source yet can't end up selected.
	let selected = $state<Record<string, boolean>>({});
	const buyable = $derived(HARDWARE);
	const selectedList = $derived(buyable.filter((h) => selected[h.id]));
	const allSelected = $derived(buyable.every((h) => selected[h.id]));
	const setAll = (on: boolean) => {
		selected = on ? Object.fromEntries(buyable.map((h) => [h.id, true])) : {};
	};

	// ------------------------------------------------------------ detail modal
	let detail = $state<Hardware | null>(null);
	let detailOpen = $state(false);
	function openDetail(h: Hardware) {
		detail = h;
		detailOpen = true;
	}
	// A click anywhere on a row opens its detail modal — except on the row's own
	// interactive controls, so ticking the checkbox or following a link doesn't.
	function rowClickToOpen(e: MouseEvent, h: Hardware) {
		if ((e.target as HTMLElement).closest('button, a, input, label')) return;
		openDetail(h);
	}

	const selectedTotal = $derived.by(() =>
		selectedList.reduce(
			// an item with no priced source contributes nothing rather than throwing —
			// every item is selectable now, sourced or not
			(sum, h) => {
				const v = bestUsVendor(h);
				return sum + (v ? (buyCost(v, buyUnits(h, totalQty(h, layers))) ?? 0) : 0);
			},
			0
		)
	);

	// -------------------------------------------------------------- csv export
	// The file has to stand alone: someone should be able to hand it to an
	// assistant and ask "which multipacks cover 90% of this?" without the page.
	function downloadCsv() {
		const spec = exportSpec(layers);
		const items = selectedList.length ? selectedList : HARDWARE;
		download(
			filename(spec, 'hardware'),
			hardwareCsv(items, spec, {
				qty: (h) => totalQty(h, layers),
				qtySource,
				buyUnits,
				vendor: bestUsVendor,
				packs: packsNeeded
			})
		);
	}

	// ------------------------------------------------------- where it goes
	// The modal answers "where does this live?" one level at a time: start at the
	// paths down to the item, then walk up through the assemblies that contain it.
	let focusAsm = $state<string | null>(null);
	const detailPaths = $derived(detail ? usagePaths(detail.id, layers) : []);
	function assemblyHref(id: string) {
		return `/assembly?focus=${encodeURIComponent(id)}`;
	}

	// ------------------------------------------------------------ amazon cart
	// Amazon's Associates add-to-cart URL takes ASIN/quantity pairs directly, so a
	// static page can build one — no API, no key. It needs the ASIN, which only
	// canonical /dp/<ASIN> links expose; short links (amzn.to) hide it.
	const ASSOCIATE_TAG = 'sorterv2-20';
	const CART_BATCH = 20; // the endpoint rejects very long carts; batch to stay safe

	const asinOf = (url: string): string | null => url.match(/\/dp\/([A-Z0-9]{10})/)?.[1] ?? null;

	type CartLine = { h: Hardware; asin: string; packs: number };
	/** Selected parts split into what can and can't go in an Amazon cart. */
	const cart = $derived.by(() => {
		const lines: CartLine[] = [];
		const excluded: { h: Hardware; why: string }[] = [];
		for (const h of selectedList) {
			const v = bestUsVendor(h);
			const qty = totalQty(h, layers);
			if (!v) {
				excluded.push({ h, why: 'no US Amazon source' });
				continue;
			}
			const asin = asinOf(v.url);
			if (!asin) {
				// no ASIN means either a non-Amazon retailer or a short link that hides it
				excluded.push({
					h,
					why: /(^|\.)amazon\./.test(new URL(v.url).hostname)
						? 'source is a short link with no ASIN'
						: `sold by ${v.vendor ?? 'another retailer'}, not Amazon`
				});
				continue;
			}
			if (qty == null) {
				excluded.push({ h, why: 'quantity not settled' });
				continue;
			}
			lines.push({ h, asin, packs: packsNeeded(v, buyUnits(h, qty)!) });
		}
		const batches: string[] = [];
		for (let i = 0; i < lines.length; i += CART_BATCH) {
			const params = new URLSearchParams({ AssociateTag: ASSOCIATE_TAG });
			lines.slice(i, i + CART_BATCH).forEach((l, n) => {
				params.set(`ASIN.${n + 1}`, l.asin);
				params.set(`Quantity.${n + 1}`, String(l.packs));
			});
			batches.push(`https://www.amazon.com/gp/aws/cart/add.html?${params}`);
		}
		return { lines, excluded, batches };
	});
</script>

<svelte:head><title>Sorter Parts Calculator — Hardware</title></svelte:head>

<!-- One off-the-shelf part. Rendered standalone, or nested under the rollup row
     of the assembly it's joined into. -->
{#snippet hwRow(h: Hardware)}
	{@const qty = totalQty(h, layers)}
	{@const src = qtySource(h)}
	{@const img = hardwareImage(h)}
	{@const lengthLabel = hardwareLengthLabel(h)}
	<div
		class="hw-row setup-card-shell flex cursor-pointer items-start gap-3 border p-3 {selected[h.id]
			? 'border-primary/60'
			: ''}"
		role="button"
		tabindex="0"
		title="View {h.name} details"
		onclick={(e) => rowClickToOpen(e, h)}
		onkeydown={(e) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				openDetail(h);
			}
		}}
	>
		<!-- the checkbox owns selection; its label keeps the hit target generous
		     without making the whole row a toggle. Every item is selectable, sourced
		     or not — an unsourced part still belongs in the exported list. -->
		<label class="mt-0.5 shrink-0 cursor-pointer p-0.5">
			<input
				type="checkbox"
				class="setup-toggle h-4 w-4"
				bind:checked={selected[h.id]}
				aria-label="Select {h.name}"
			/>
		</label>
		{#if img}
			<span class="hw-thumb relative shrink-0">
				<img src={img.src} alt={h.name} class="h-16 w-16 border border-border bg-white object-contain p-1" />
				<!-- A family photo stands in for every length in its family, so the
				     length — the only thing it can't show — is stamped on the corner. -->
				{#if img.shared && lengthLabel}
					<span class="hw-len">{lengthLabel}</span>
				{/if}
				<!-- hover preview; decorative, the thumbnail already carries the alt -->
				<img src={img.src} alt="" aria-hidden="true" class="hw-zoom" />
			</span>
		{:else}
			<div
				class="flex h-16 w-16 shrink-0 items-center justify-center border border-border bg-[var(--color-bg)] text-text-muted"
			>
				<ImageOff size={18} />
			</div>
		{/if}

		<div class="min-w-0 flex-1">
			<div class="flex items-start justify-between gap-3">
				<h3 class="flex items-center gap-1.5 text-sm font-semibold text-text">
						<HardwareIcon hw={h} />{h.name}
					</h3>
				<span
					class="shrink-0 text-right text-xs tabular-nums text-text-muted"
					title={src ? QTY_TITLE[src] : undefined}
				>
					{#if h.sheet_qty_text}
						{h.sheet_qty_text}
					{:else if qty == null}
						qty TBD
					{:else}
						<span class="font-semibold text-text">×{buyUnits(h, qty)}</span>
						{#if h.stock}
							<div>{h.stock.unit_label}</div>
						{:else if src === 'sheet' && h.sheet_qty?.per_layer != null}
							<div>({h.sheet_qty.per_layer}/layer)</div>
						{/if}
					{/if}
				</span>
			</div>
			<p class="mt-0.5 text-xs text-text-muted">{h.description}</p>
			{#if h.attributes?.length}
				<!-- specs that pin down which variant to buy. flex-wrap rather than
				     inline text: each spec stays whole, the row wraps between them. -->
				<div class="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-text-muted">
					{#each h.attributes as a}
						<span>{a.label} <span class="text-text">{a.value}</span></span>
					{/each}
				</div>
			{/if}
			{#if h.note}
				<p class="mt-1 text-xs text-warning-dark">{h.note}</p>
			{/if}

			<div class="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-0.5">
				{#if h.sourcing?.vendors?.length}
					{#each h.sourcing.vendors as v (v.url)}
						{#if v.vendor === 'basically'}
							<!-- in-house part, not shipping yet — no link out, no price to show -->
							<span class="text-xs italic text-text-muted/70">Coming soon to basically</span>
						{:else}
							{@const cost = buyCost(v, buyUnits(h, qty))}
							<span class="inline-flex items-center gap-1 text-xs">
								<a
									href={v.affiliate_url ?? v.url}
									target="_blank"
									rel="noopener"
									class="inline-flex items-center gap-1 font-medium text-primary hover:text-primary-hover"
									title={v.as_of ? `price as of ${v.as_of}` : undefined}
								>
									{v.vendor ?? v.region}
									<span class="font-normal text-text-muted">({v.region})</span>
									<ExternalLink size={11} />
								</a>
								<!-- the untagged link lives on the detail modal, to keep rows terse -->
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
							</span>
						{/if}
					{/each}
				{:else}
					<span class="text-xs text-text-muted">No source picked yet.</span>
				{/if}
			</div>
		</div>
	</div>
{/snippet}

<div class="mx-auto max-w-6xl px-4 py-8 sm:px-6">
	<header class="mb-4">
		<h1 class="text-2xl font-bold text-text">Hardware</h1>
	</header>

	<div class="mb-5">
		<Callout variant="warning" title="Work in progress">
			This list is incomplete and several quantities are unconfirmed. Open any item to see
			where its count comes from and where it goes on the machine.
		</Callout>
	</div>

	<div class="mb-6"><LayerControl /></div>

	<div class="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
		<!-- LEFT: one vertical list, grouped by category -->
		<div>
			<!-- the icons encode head shape + thread size; say so once, here -->
			<div class="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
				<span>Icon shows head shape; colour is thread size:</span>
				{#each Object.entries(SIZE_COLORS) as [sz, c] (sz)}
					<span class="inline-flex items-center gap-1">
						<span class="inline-block h-2.5 w-2.5" style="background:{c}"></span>{sz}
					</span>
				{/each}
			</div>
			<div class="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
				<span class="text-xs font-semibold uppercase tracking-wider text-text-muted">
					Rough US total <span class="font-bold normal-case tracking-normal text-text"
						>${selectedTotal > 0 ? selectedTotal.toFixed(2) : '0.00'}</span
					>
					{#if selectedList.length}selected{/if}
				</span>
				<span class="text-sm text-text-muted">
					{selectedList.length}/{buyable.length} selected ·
					<button class="text-primary hover:text-primary-hover" onclick={() => setAll(!allSelected)}>
						{allSelected ? 'deselect all' : 'select all'}
					</button>
					<button
						class="ml-3 inline-flex items-center gap-1 text-primary hover:text-primary-hover"
						onclick={downloadCsv}
						title="Exports exactly what you have set up here: {selectedList.length ||
							HARDWARE.length} items at {layers} layers, with quantities resolved for that build."
					>
						<Download size={13} /> CSV
						<span class="font-normal text-text-muted"
							>· {selectedList.length ? `${selectedList.length} selected` : `all ${HARDWARE.length}`}, {layers}
							layers</span>
					</button>
				</span>
			</div>

			{#each groups as [cat, items] (cat)}
				<section class="mb-6">
					<h2 class="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">{cat}</h2>
					<div class="flex flex-col gap-2">
						{#each groupBlocks(items) as block (block.kind === 'item' ? block.hw.id : block.asm.id)}
							{#if block.kind === 'assembly'}
								{@const open = expandedAsm[block.asm.id]}
								{@const allOn = asmAllOn(block.items)}
								<div class="flex flex-col">
									<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
									<div
										class="hw-row setup-card-shell flex cursor-pointer items-center gap-3 border p-3 {allOn
											? 'border-primary/60'
											: ''}"
										role="button"
										tabindex="0"
										title={block.asm.description}
										onclick={(e) => {
											if ((e.target as HTMLElement).closest('button, a, input, label')) return;
											expandedAsm[block.asm.id] = !open;
										}}
										onkeydown={(e) => {
											if (e.key === 'Enter' || e.key === ' ') {
												e.preventDefault();
												expandedAsm[block.asm.id] = !open;
											}
										}}
									>
										<label class="shrink-0 cursor-pointer p-0.5">
											<input
												type="checkbox"
												class="setup-toggle h-4 w-4"
												checked={allOn}
												indeterminate={!allOn && asmSomeOn(block.items)}
												onchange={() => setAsm(block.items, !allOn)}
												aria-label="Select every part in {block.asm.name}"
											/>
										</label>
										<!-- fanned thumbnails, same cue the printed-parts rollup uses -->
										<span class="hw-fan shrink-0">
											{#each block.items.slice(0, 3) as m, i (m.id)}
												{@const mi = hardwareImage(m)}
												{#if mi}
													<img src={mi.src} alt={m.name} style="z-index:{3 - i}" />
												{/if}
											{/each}
										</span>
										<div class="min-w-0 flex-1">
											<div class="flex flex-wrap items-center gap-1.5">
												{#if open}<ChevronDown size={15} class="text-text-muted" />{:else}<ChevronRight
														size={15}
														class="text-text-muted"
													/>{/if}
												<h3 class="text-sm font-semibold text-text">{block.asm.name}</h3>
												<Badge variant="info">Assembly</Badge>
												{#each block.asm.joining ?? [] as j (j.method)}
													<Badge variant="warning" title={j.note}>
														<Zap size={10} />{JOIN_LABELS[j.method]}
													</Badge>
												{/each}
											</div>
											<p class="mt-0.5 text-xs text-text-muted">
												{block.items.length} parts · click to {open ? 'collapse' : 'expand'}
											</p>
										</div>
										{#if asmCost(block.items) > 0}
											<span class="shrink-0 text-right text-xs tabular-nums text-text-muted">
												<span class="font-semibold text-text">${asmCost(block.items).toFixed(2)}</span>
												combined
											</span>
										{/if}
									</div>
									{#if open}
										<div class="hw-children mt-2 flex flex-col gap-2 pl-6">
											{#each block.items as m (m.id)}
												{@render hwRow(m)}
											{/each}
										</div>
									{/if}
								</div>
							{:else}
								{@render hwRow(block.hw)}
							{/if}
						{/each}
					</div>
				</section>
			{/each}

			<!-- Affiliate disclosure. Required because the vendor links and the cart
			     carry a referral tag; kept to one muted line at the foot of the page. -->
			<p class="mt-4 border-t border-border pt-3 text-[11px] text-text-muted">
				As an Amazon Associate we earn from qualifying purchases. Open any part for a
				“Not affiliate” link to the same listing without the referral tag.
			</p>
		</div>


		<!-- RIGHT: cart builder -->
		<aside class="setup-card-shell border p-4 lg:sticky lg:top-4">
			<h2
				class="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-text-muted"
			>
				<ShoppingCart size={13} /> Amazon cart
			</h2>

			{#if !selectedList.length}
				<p class="text-sm text-text-muted">
					Tick the parts you want, then build a cart with everything in it.
				</p>
			{:else}
				<div class="mb-3 text-sm text-text">
					<span class="font-semibold tabular-nums">{cart.lines.length}</span>
					{cart.lines.length === 1 ? 'item' : 'items'} ready ·
					<span class="font-semibold tabular-nums">${selectedTotal.toFixed(2)}</span>
				</div>

				{#each cart.batches as url, i (url)}
					<a
						href={url}
						target="_blank"
						rel="noopener"
						class="setup-button-primary mb-2 flex h-9 items-center justify-center gap-1.5 px-3 text-sm font-medium"
					>
						<ShoppingCart size={14} />
						{cart.batches.length > 1 ? `Add batch ${i + 1} of ${cart.batches.length}` : 'Add to Amazon cart'}
					</a>
				{/each}

				{#if cart.batches.length > 1}
					<p class="mb-2 text-[11px] text-text-muted">
						Split into batches — Amazon caps how many items one cart link can carry. Open each.
					</p>
				{/if}

				{#if cart.lines.length}
					<p class="text-[11px] text-text-muted">
						Quantities are whole packs, not individual pieces.
					</p>
				{/if}

				{#if cart.excluded.length}
					<div class="mt-3 border-t border-border pt-2">
						<p class="text-[11px] font-semibold text-warning-dark">
							{cart.excluded.length} can’t be added automatically
						</p>
						<ul class="mt-1 space-y-0.5">
							{#each cart.excluded as e (e.h.id)}
								<li class="text-[11px] text-text-muted">{e.h.name} — {e.why}</li>
							{/each}
						</ul>
					</div>
				{/if}
			{/if}
		</aside>
	</div>
</div>

<Modal bind:open={detailOpen} title={detail?.name} maxW="max-w-4xl">
	{#if detail}
		{@const qty = totalQty(detail, layers)}
		{@const dimg = hardwareImage(detail)}
		<!-- Modal supplies no padding of its own; every caller wraps its body. -->
		<div class="p-4">
		<div class="flex flex-col gap-4 sm:flex-row">
			{#if dimg}
				<img
					src={dimg.src}
					alt={detail.name}
					class="h-72 w-72 shrink-0 self-start border border-border bg-white object-contain p-2 sm:h-80 sm:w-80"
				/>
			{/if}
			<div class="min-w-0 flex-1">
				<p class="text-sm text-text-muted">{detail.description}</p>
				{#if detail.note}
					<p class="mt-2 border border-warning/50 bg-warning/[0.08] p-2 text-sm text-warning-dark">
						{detail.note}
					</p>
				{/if}

				<dl class="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
					<dt class="text-text-muted">Needed</dt>
					<dd class="text-text">
						{#if detail.sheet_qty_text}
							{detail.sheet_qty_text}
						{:else if qty == null}
							not settled yet
						{:else}
							{buyUnits(detail, qty)}{#if detail.stock}&nbsp;×&nbsp;{detail.stock.unit_label}{/if}
							{#if qtySource(detail) === 'tree'}
								<span class="text-text-muted">— summed from the assembly tree</span>
							{:else}
								<span class="text-warning-dark">
									— hand count from the BOM sheet, not placed in the assembly tree yet
									{#if detail.sheet_qty?.per_layer != null}({detail.sheet_qty.per_layer} per layer
										× {layers} layers){/if}
								</span>
							{/if}
						{/if}
					</dd>
					{#if detail.stock}
						<dt class="text-text-muted">Cut into</dt>
						<dd class="text-text">
							{qty} × {detail.stock.piece_label}
						</dd>
					{/if}
					{#each detail.attributes ?? [] as a}
						<dt class="text-text-muted">{a.label}</dt>
						<dd class="text-text">{a.value}</dd>
					{/each}
				</dl>
			</div>
		</div>

		{#if detailPaths.length}
			<h4 class="mt-5 text-xs font-semibold uppercase tracking-wider text-text-muted">
				Where it goes
			</h4>
			<div class="mt-2 space-y-2">
				{#each detailPaths as path, pi (pi)}
					{@const inner = path.steps[path.steps.length - 1].assembly}
					<div class="border border-border p-3">
						<div class="flex items-start justify-between gap-3">
							<div class="min-w-0">
								<!-- innermost first: the assembly you'd actually be holding -->
								<div class="flex flex-wrap items-baseline gap-x-1.5">
									<span class="text-sm font-semibold text-text">{inner.name}</span>
									{#if path.via}
										<span class="text-xs text-text-muted">in the {path.via.name}</span>
									{/if}
									<span class="text-xs tabular-nums text-text-muted">· {path.qty} here</span>
								</div>
								<!-- then the walk up, outermost last -->
								<div class="mt-1 flex flex-wrap items-center gap-x-1 text-xs text-text-muted">
									{#each path.steps as step, si (si)}
										{#if si > 0}<span aria-hidden="true">›</span>{/if}
										<a
											href={assemblyHref(step.assembly.id)}
											class="hover:text-primary hover:underline"
											title="Show {step.assembly.name} on the assembly tree"
										>{step.assembly.name}</a>
									{/each}
								</div>
							</div>
							<a
								href={assemblyHref(inner.id)}
								class="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:text-primary-hover"
								title="Open {inner.name} on the assembly tree"
							>
								Go to <ArrowUpRight size={12} />
							</a>
						</div>
					</div>
				{/each}
			</div>
		{/if}

		<!-- how the count was arrived at: jargon the list itself shouldn't carry -->
		<p class="mt-3 text-xs {qtySource(detail) === 'sheet' ? 'text-warning-dark' : 'text-text-muted'}">
			{qtySource(detail) === 'sheet'
				? 'This count is a hand count carried over from the BOM spreadsheet — it has not been placed in the assembly tree yet, so it may not match the machine.'
				: qtySource(detail) === 'tree'
					? 'This count is summed from the machine assembly tree.'
					: 'No count settled for this item yet.'}
		</p>

		{#each jointsOf(detail) as asm (asm.id)}
			<h4 class="mt-5 text-xs font-semibold uppercase tracking-wider text-text-muted">
				Goes together with
			</h4>
			<div class="mt-2 border border-border p-3">
				<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
					<span class="text-sm font-semibold text-text">{asm.name}</span>
					{#each asm.joining ?? [] as j (j.method)}
						<Badge variant="warning"><Zap size={10} />{JOIN_LABELS[j.method]}</Badge>
					{/each}
				</div>
				<p class="mt-1 text-xs text-text-muted">{asm.description}</p>
				<ul class="mt-2 space-y-0.5 text-sm text-text">
					{#each siblings(asm, detail.id) as s (s.id)}
						<li class="tabular-nums">
							<span class="text-text-muted">×{s.qty}</span>
							{s.name}
						</li>
					{/each}
				</ul>
				{#each asm.joining ?? [] as j (j.method)}
					{#if j.note}
						<p class="mt-2 text-xs text-warning-dark">{j.note}</p>
					{/if}
				{/each}
			</div>
		{/each}

		<h4 class="mt-5 text-xs font-semibold uppercase tracking-wider text-text-muted">Where to buy</h4>
		<div class="mt-2 divide-y divide-border border border-border">
			{#each detail.sourcing?.vendors ?? [] as v (v.url)}
				{#if v.vendor === 'basically'}
					<!-- in-house part, not shipping yet — no link out, no price to show -->
					<div class="p-2 text-sm italic text-text-muted/70">Coming soon to basically</div>
				{:else}
					{@const cost = buyCost(v, buyUnits(detail, qty))}
					<div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 p-2 text-sm">
						<span class="inline-flex items-center gap-2">
							<a
								href={v.affiliate_url ?? v.url}
								target="_blank"
								rel="noopener"
								class="inline-flex items-center gap-1 font-medium text-primary hover:text-primary-hover"
							>
								{v.vendor ?? v.region} <ExternalLink size={12} />
							</a>
							<span class="text-xs text-text-muted">{v.region}</span>
							{#if v.affiliate_url}
								<a
									href={v.url}
									target="_blank"
									rel="noopener"
									class="text-xs text-text-muted underline decoration-dotted underline-offset-2 hover:text-text"
									title="The same listing, without the referral tag">Not affiliate</a
								>
							{/if}
						</span>
						<span class="tabular-nums text-text-muted">
							{#if fmtPrice(v)}
								{fmtPrice(v)}{v.pack_qty && v.pack_qty > 1 ? ` for ${v.pack_qty}` : ''}
								{#if cost != null && v.pack_qty && qty != null}
									· buy <span class="text-text">{packsNeeded(v, buyUnits(detail, qty)!)}</span> =
									<span class="font-semibold text-text">${cost.toFixed(2)}</span>
								{/if}
							{:else}
								no price recorded
							{/if}
							{#if v.as_of}<span class="ml-2 text-xs">as of {v.as_of}</span>{/if}
						</span>
						{#if v.note}<span class="w-full text-xs text-text-muted">{v.note}</span>{/if}
					</div>
				{/if}
			{:else}
				<p class="p-2 text-sm text-text-muted">No source picked yet.</p>
			{/each}
		</div>

		{#if bestUsVendor(detail)}
			<label class="mt-4 flex cursor-pointer items-center gap-2 text-sm text-text">
				<input type="checkbox" class="setup-toggle h-4 w-4" bind:checked={selected[detail.id]} />
				Include in the Amazon cart
			</label>
		{/if}
		</div>
	{/if}
</Modal>

<style>
	/* same hover as the 3D parts rows — the whole row is clickable, so it says so */
	.hw-row {
		transition: background-color 120ms;
	}
	.hw-row:hover {
		background: color-mix(in oklab, var(--color-bg) 55%, transparent);
	}

	/* the rollup row stands in for several parts, so its thumbnails overlap into a
	   small fan — the same "this is more than one thing" cue the printed list uses */
	.hw-fan {
		display: inline-flex;
	}
	.hw-fan :global(img) {
		position: relative;
		width: 2.75rem;
		height: 2.75rem;
		object-fit: contain;
		padding: 0.125rem;
		background: #fff;
		border: 1px solid var(--color-border);
	}
	.hw-fan :global(img + img) {
		margin-left: -1rem;
	}

	/* members sit on a tint and indent under the rollup, so an expanded assembly
	   still reads as one block rather than loose rows in the category */
	.hw-children {
		border-left: 2px solid var(--color-border);
		margin-left: 0.75rem;
	}

	/* One family photo covers every length in the family, so the length rides in
	   the thumbnail's corner. Small and quiet — the row states it in full below. */
	.hw-len {
		position: absolute;
		right: -1px;
		bottom: -1px;
		padding: 0 0.2rem;
		font-size: 9px;
		font-weight: 600;
		line-height: 1.35;
		font-variant-numeric: tabular-nums;
		color: var(--color-text);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
	}

	/* thumbnails are small enough that the part is hard to make out, so hovering
	   one blows it up beside the row. It takes pointer events (rather than
	   passing them through) so that moving the cursor onto the enlarged image
	   itself still counts as hovering — :hover cascades up to .hw-thumb from
	   any descendant the pointer is actually over, so the preview only closes
	   once the cursor leaves the image too, not the instant it crosses off the
	   64px thumbnail underneath it. */
	.hw-zoom {
		position: absolute;
		left: calc(100% + 0.5rem);
		top: 50%;
		width: 28rem;
		height: 28rem;
		/* the reset's img{max-width:100%} would clamp this to the 64px thumb box */
		max-width: none;
		padding: 0.5rem;
		object-fit: contain;
		background: #fff;
		border: 1px solid var(--color-border);
		box-shadow: 0 12px 32px rgb(0 0 0 / 0.22);
		opacity: 0;
		pointer-events: none;
		transform: translateY(-50%) scale(0.97);
		transition:
			opacity 120ms ease,
			transform 120ms ease;
		z-index: 40;
	}
	/* hover-capable pointers only, so a tap on touch doesn't leave it stuck open */
	@media (hover: hover) {
		.hw-thumb:hover .hw-zoom {
			opacity: 1;
			pointer-events: auto;
			transform: translateY(-50%) scale(1);
		}
	}
	/* On a narrow screen there is nowhere to put a 28rem preview, and being
	   absolutely positioned it still stretched the page's scroll width. The row
	   is tappable and the modal shows the image full size, so it just goes. */
	@media (max-width: 767px) {
		.hw-zoom {
			display: none;
		}
	}
</style>
