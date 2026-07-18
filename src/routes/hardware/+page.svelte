<script lang="ts">
	import { ExternalLink, ImageOff, ShoppingCart } from 'lucide-svelte';
	import LayerControl from '$lib/components/LayerControl.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import { HARDWARE, resolveHardwareTotals, type Hardware, type Vendor } from '$lib/filament';
	import { layerStore } from '$lib/layers.svelte';

	// Every off-the-shelf part from the BOM sheet, in the unified data format.
	// Quantities are still the sheet's hand counts (sheet_qty) — they become
	// derived from the assembly tree as parts get placed there.
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
	// Everything starts unselected; the cart is opt-in.
	let selected = $state<Record<string, boolean>>({});
	const selectedList = $derived(HARDWARE.filter((h) => selected[h.id]));
	const allSelected = $derived(HARDWARE.every((h) => selected[h.id]));
	const setAll = (on: boolean) => {
		selected = on ? Object.fromEntries(HARDWARE.map((h) => [h.id, true])) : {};
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
		selectedList.reduce((sum, h) => sum + (buyCost(bestUsVendor(h)!, totalQty(h, layers)) ?? 0), 0)
	);

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
				excluded.push({ h, why: 'source is a short link with no ASIN' });
				continue;
			}
			if (qty == null) {
				excluded.push({ h, why: 'quantity not settled' });
				continue;
			}
			lines.push({ h, asin, packs: packsNeeded(v, qty) });
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

<div class="mx-auto max-w-6xl px-4 py-8 sm:px-6">
	<header class="mb-5">
		<h1 class="text-2xl font-bold text-text">Hardware</h1>
	</header>

	<div class="mb-6"><LayerControl /></div>

	<div class="grid items-start gap-6 lg:grid-cols-[1fr_320px]">
		<!-- LEFT: one vertical list, grouped by category -->
		<div>
			<div class="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
				<span class="text-xs font-semibold uppercase tracking-wider text-text-muted">
					Rough US total <span class="font-bold normal-case tracking-normal text-text"
						>${selectedTotal > 0 ? selectedTotal.toFixed(2) : '0.00'}</span
					>
					{#if selectedList.length}selected{/if}
				</span>
				<span class="text-sm text-text-muted">
					{selectedList.length}/{HARDWARE.length} selected ·
					<button class="text-primary hover:text-primary-hover" onclick={() => setAll(!allSelected)}>
						{allSelected ? 'deselect all' : 'select all'}
					</button>
				</span>
			</div>

			{#each groups as [cat, items] (cat)}
				<section class="mb-6">
					<h2 class="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">{cat}</h2>
					<div class="flex flex-col gap-2">
						{#each items as h (h.id)}
							{@const qty = totalQty(h, layers)}
							<div
								class="setup-card-shell flex cursor-pointer items-start gap-3 border p-3 transition-colors {selected[
									h.id
								]
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
								     without making the whole row a toggle -->
								<label class="mt-0.5 shrink-0 cursor-pointer p-0.5">
									<input
										type="checkbox"
										class="setup-toggle h-4 w-4"
										bind:checked={selected[h.id]}
										aria-label="Select {h.name}"
									/>
								</label>
								{#if h.image}
									<img
										src={h.image}
										alt={h.name}
										class="h-16 w-16 shrink-0 border border-border bg-white object-contain p-1"
									/>
								{:else}
									<div
										class="flex h-16 w-16 shrink-0 items-center justify-center border border-border bg-[var(--color-bg)] text-text-muted"
									>
										<ImageOff size={18} />
									</div>
								{/if}

								<div class="min-w-0 flex-1">
									<div class="flex items-start justify-between gap-3">
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
									{#if h.attributes?.length}
										<!-- specs that pin down which variant to buy. flex-wrap rather than
										     inline text: each spec stays whole, the row wraps between them. -->
										<div class="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-text-muted">
											{#each h.attributes as a (a.label)}
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
												{@const cost = buyCost(v, qty)}
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
													{#if v.affiliate_url}
														<!-- the same listing without the referral tag -->
														<a
															href={v.url}
															target="_blank"
															rel="noopener"
															class="text-text-muted underline decoration-dotted underline-offset-2 hover:text-text"
															title="Same listing without the affiliate tag">plain</a
														>
													{/if}
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
											{/each}
										{:else}
											<span class="text-xs text-text-muted">No source picked yet.</span>
										{/if}
									</div>
								</div>
							</div>
						{/each}
					</div>
				</section>
			{/each}

			<!-- Affiliate disclosure. Required because the vendor links and the cart
			     carry a referral tag; kept to one muted line at the foot of the page. -->
			<p class="mt-4 border-t border-border pt-3 text-[11px] text-text-muted">
				Amazon links are affiliate links. The “plain” link beside each one is the same listing
				without the tag.
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

<Modal bind:open={detailOpen} title={detail?.name}>
	{#if detail}
		{@const qty = totalQty(detail, layers)}
		<div class="flex flex-col gap-4 sm:flex-row">
			{#if detail.image}
				<img
					src={detail.image}
					alt={detail.name}
					class="h-40 w-40 shrink-0 self-start border border-border bg-white object-contain p-2"
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
						{:else if qty != null}
							{qty}
							{#if detail.sheet_qty?.per_layer != null}
								<span class="text-text-muted"
									>({detail.sheet_qty.per_layer} per layer × {layers} layers)</span
								>
							{/if}
						{:else}
							not settled yet
						{/if}
					</dd>
					{#each detail.attributes ?? [] as a (a.label)}
						<dt class="text-text-muted">{a.label}</dt>
						<dd class="text-text">{a.value}</dd>
					{/each}
				</dl>
			</div>
		</div>

		<h4 class="mt-5 text-xs font-semibold uppercase tracking-wider text-text-muted">Where to buy</h4>
		<div class="mt-2 divide-y divide-border border border-border">
			{#each detail.sourcing?.vendors ?? [] as v (v.url)}
				{@const cost = buyCost(v, qty)}
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
								title="Same listing without the affiliate tag">plain</a
							>
						{/if}
					</span>
					<span class="tabular-nums text-text-muted">
						{#if fmtPrice(v)}
							{fmtPrice(v)}{v.pack_qty && v.pack_qty > 1 ? ` for ${v.pack_qty}` : ''}
							{#if cost != null && v.pack_qty && qty != null}
								· buy <span class="text-text">{packsNeeded(v, qty)}</span> =
								<span class="font-semibold text-text">${cost.toFixed(2)}</span>
							{/if}
						{:else}
							no price recorded
						{/if}
						{#if v.as_of}<span class="ml-2 text-xs">as of {v.as_of}</span>{/if}
					</span>
					{#if v.note}<span class="w-full text-xs text-text-muted">{v.note}</span>{/if}
				</div>
			{:else}
				<p class="p-2 text-sm text-text-muted">No source picked yet.</p>
			{/each}
		</div>

		<label class="mt-4 flex cursor-pointer items-center gap-2 text-sm text-text">
			<input type="checkbox" class="setup-toggle h-4 w-4" bind:checked={selected[detail.id]} />
			Include in the Amazon cart
		</label>
	{/if}
</Modal>
