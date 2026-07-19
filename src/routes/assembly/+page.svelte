<script lang="ts">
	import { ExternalLink, ShoppingCart, Zap } from 'lucide-svelte';
	import Badge from '$lib/components/Badge.svelte';
	import Callout from '$lib/components/Callout.svelte';
	import LayerControl from '$lib/components/LayerControl.svelte';
	import {
		getAssembly,
		getHardware,
		getPart,
		hardwareImage,
		JOIN_LABELS,
		lineQty,
		resolveHardwareTotals,
		type AssemblyLine,
		type Hardware
	} from '$lib/filament';
	import { layerStore } from '$lib/layers.svelte';

	// Experimental view of the unified parts system (notes/UNIFIED-PARTS-SYSTEM.md):
	// the machine as a recursive assembly tree whose lines reference printed parts,
	// sub-assemblies, and (eventually) all the COTS hardware. Most nodes are stubs;
	// the chute core is the first branch carrying real hardware via `requires`.
	const layers = $derived(layerStore.sizes.length);

	type HardwareTotal = { hw: Hardware; qty: number };
	const hardwareTotals: HardwareTotal[] = $derived.by(() =>
		[...resolveHardwareTotals('machine', layers).entries()]
			.map(([id, qty]) => ({ hw: getHardware(id)!, qty }))
			.filter((t) => t.hw)
	);

	const fmtUsd = (n: number) => `$${n.toFixed(2)}`;
</script>

<svelte:head><title>Sorter Parts Calculator — Machine assembly</title></svelte:head>

{#snippet requiresRows(partId: string, mult: number)}
	{@const part = getPart(partId)}
	{#each part?.requires ?? [] as req (req.part)}
		{@const hw = getHardware(req.part)}
		{#if hw}
			{@const img = hardwareImage(hw)}
			<div class="mt-2 flex items-center gap-3 border border-border bg-[var(--color-bg)] p-2">
				{#if img}
					<img src={img.src} alt={hw.name} class="h-10 w-10 shrink-0 object-contain" />
				{/if}
				<div class="min-w-0 flex-1">
					<div class="truncate text-xs font-semibold text-text">{hw.name}</div>
				</div>
				<div class="text-right text-xs tabular-nums text-text">
					<div class="font-semibold">×{req.qty} each</div>
					{#if mult > 1}<div class="text-text-muted">{req.qty * mult} total</div>{/if}
				</div>
			</div>
		{/if}
	{/each}
{/snippet}

<!-- One off-the-shelf line of an assembly: the screws, nuts and bought components
     that belong to the joint rather than to either part it holds together. -->
{#snippet hardwareRow(hw: Hardware, each: number, total: number)}
	{@const img = hardwareImage(hw)}
	<div class="ml-4 mt-2 flex items-center gap-3 border border-border bg-[var(--color-bg)] p-2">
		{#if img}
			<img src={img.src} alt={hw.name} class="h-8 w-8 shrink-0 object-contain" />
		{/if}
		<div class="min-w-0 flex-1 truncate text-xs font-semibold text-text">{hw.name}</div>
		<div class="text-right text-xs tabular-nums text-text">
			<div class="font-semibold">×{each}</div>
			{#if total !== each}<div class="text-text-muted">{total} total</div>{/if}
		</div>
	</div>
{/snippet}

{#snippet node(id: string, qty: AssemblyLine['qty'], mult: number, depth: number)}
	{@const asm = getAssembly(id)}
	{#if asm}
		<div class="border-l-2 border-border {depth > 0 ? 'ml-4 pl-4' : 'pl-4'} py-2">
			<div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
				<span class="text-sm font-semibold text-text">{asm.name}</span>
				<span class="text-xs tabular-nums text-text-muted">
					{#if qty === 'per-layer'}×{layers} (1 per layer)
					{:else if qty === 'middle-layers'}×{Math.max(0, layers - 2)} (layers between the interfaces)
					{:else if qty !== 1}×{qty}{/if}
				</span>
				{#if asm.status === 'stub'}
					<span class="border border-border px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider text-text-muted"
						>stub — not yet detailed</span>
				{:else if asm.status === 'partial'}
					<span class="border border-warning/50 bg-warning/[0.08] px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider text-warning-dark"
						>partial</span>
				{/if}
			</div>
			{#if asm.description}
				<p class="mt-0.5 max-w-2xl text-xs text-text-muted">{asm.description}</p>
			{/if}
			<!-- how these lines become one unit — soldered, self-tapped, friction-held -->
			{#each asm.joining ?? [] as j (j.method)}
				<div class="mt-1 flex max-w-2xl flex-wrap items-baseline gap-x-2">
					<Badge variant="warning"><Zap size={10} />{JOIN_LABELS[j.method]}</Badge>
					{#if j.note}<span class="text-xs text-text-muted">{j.note}</span>{/if}
				</div>
			{/each}
			{#each asm.lines ?? [] as line (line.part ?? line.assembly)}
				{#if line.assembly}
					{@render node(line.assembly, line.qty, lineQty(line, layers) * mult, depth + 1)}
				{:else if line.part && getHardware(line.part)}
					{@render hardwareRow(
						getHardware(line.part)!,
						lineQty(line, layers),
						lineQty(line, layers) * mult
					)}
				{:else if line.part}
					{@const part = getPart(line.part)}
					{#if part}
						{@const total = lineQty(line, layers) * mult}
						<div class="ml-4 mt-2 border border-border bg-surface p-3">
							<div class="flex items-center gap-3">
								<img src={part.render} alt={part.name} class="h-12 w-12 shrink-0 object-contain" />
								<div class="min-w-0 flex-1">
									<div class="flex flex-wrap items-baseline gap-x-2">
										<span class="text-sm font-semibold text-text">{part.name}</span>
										<span class="border border-border px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider text-text-muted"
											>3D printed</span>
									</div>
									<div class="text-xs text-text-muted">{part.grams.toFixed(0)} g each</div>
								</div>
								<div class="text-right text-xs tabular-nums text-text">
									<div class="font-semibold">×{lineQty(line, layers)}</div>
									{#if total !== lineQty(line, layers)}<div class="text-text-muted">{total} total</div>{/if}
								</div>
							</div>
							{@render requiresRows(line.part, total)}
						</div>
					{/if}
				{/if}
			{/each}
		</div>
	{/if}
{/snippet}

<div class="mx-auto max-w-6xl px-4 py-8 sm:px-6">
	<header class="mb-5">
		<h1 class="text-2xl font-bold text-text">Machine assembly</h1>
		<p class="mt-1 max-w-3xl text-sm text-text-muted">
			The whole machine as one assembly tree — printed parts, and the hardware that goes into
			them, resolved from a single registry. Pick a subtree, get everything it needs.
		</p>
	</header>

	<div class="mb-5">
		<Callout variant="info" title="Experimental">
			This tab is the first cut of the unified parts system. Most branches are stubs; the chute
			core is the first part carrying real off-the-shelf hardware. The existing tabs stay
			authoritative until this fills in.
		</Callout>
	</div>

	<div class="mb-6"><LayerControl /></div>

	<div class="grid items-start gap-6 lg:grid-cols-[1fr_minmax(280px,360px)]">
		<section class="setup-card-shell border p-4">
			<h2 class="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
				Assembly tree
			</h2>
			{@render node('machine', 1, 1, 0)}
		</section>

		<aside class="setup-card-shell border p-4">
			<h2 class="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-text-muted">
				<ShoppingCart size={13} /> Hardware to buy
			</h2>
			{#if hardwareTotals.length === 0}
				<p class="text-sm text-text-muted">Nothing yet.</p>
			{/if}
			{#each hardwareTotals as t (t.hw.id)}
				{@const img = hardwareImage(t.hw)}
				<div class="border border-border bg-[var(--color-bg)] p-3">
					<div class="flex items-start gap-3">
						{#if img}
							<img src={img.src} alt={t.hw.name} class="h-14 w-14 shrink-0 object-contain" />
						{/if}
						<div class="min-w-0">
							<div class="text-sm font-semibold text-text">{t.hw.name}</div>
							<p class="mt-0.5 text-xs text-text-muted">{t.hw.description}</p>
						</div>
					</div>
					{#if t.hw.attributes.length}
						<dl class="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-xs text-text-muted">
							{#each t.hw.attributes as a}
								<dt>{a.label}</dt>
								<dd class="text-text">{a.value}</dd>
							{/each}
						</dl>
					{/if}
					<div class="mt-3 border-t border-border pt-2 text-sm text-text">
						<span class="font-semibold tabular-nums">{t.qty}</span> needed
						<span class="text-xs text-text-muted">across every branch below</span>
					</div>
					{#each (t.hw.sourcing?.vendors ?? []).filter((v) => v.price != null && v.pack_qty) as v (v.url)}
						{@const packs = Math.ceil(t.qty / v.pack_qty!)}
						<div class="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
							<a
								href={v.url}
								target="_blank"
								rel="noopener"
								class="inline-flex items-center gap-1 font-medium text-primary hover:text-primary-hover"
							>
								{v.vendor ?? v.region} <ExternalLink size={11} />
							</a>
							<span class="tabular-nums text-text-muted">
								{packs} × {v.pack_qty}-pack = <span class="font-semibold text-text">{fmtUsd(packs * v.price!)}</span>
								{#if v.note}<span> · {v.note}</span>{/if}
							</span>
						</div>
					{/each}
					{#if t.hw.sourcing?.vendors?.length && t.hw.sourcing.vendors[0].as_of}
						<p class="mt-1.5 text-[10px] text-text-muted">
							Prices as of {t.hw.sourcing.vendors[0].as_of}. Counts cover only the branches that
							have been filled in — the tree is still mostly partial.
						</p>
					{/if}
				</div>
			{/each}
		</aside>
	</div>
</div>
