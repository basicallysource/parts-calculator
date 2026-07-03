<script lang="ts">
	import {
		PARTS,
		SECTIONS,
		COLOR_ROLES,
		SETTINGS,
		STORE_URL,
		categoryMultiplier,
		sectionQty,
		getAssembly,
		partSwatches,
		primaryColorId,
		effectiveGrams,
		displayCount,
		machineQty,
		buyList,
		grams,
		money,
		duration,
		durationLong,
		PLATES,
		platesForPart,
		type Part
	} from '$lib/filament';
	import { getBambuColor } from '$lib/bambu-colors';
	import ColorPicker from '$lib/components/ColorPicker.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import StlViewer from '$lib/components/StlViewer.svelte';
	import BuildPlates from '$lib/components/BuildPlates.svelte';
	import { zipSync } from 'fflate';
	import { onMount } from 'svelte';
	import { loadConfig, saveConfig, clearConfig } from '$lib/config';
	import { layerStore, addLayer as addLayerStore, removeLayerAt, setSize, setSizes } from '$lib/layers.svelte';
	import Popover from '$lib/components/Popover.svelte';
	import { Download, Package, ZoomIn, Loader, Info, Plus, X, RotateCcw, Clock, Layers3, ExternalLink } from 'lucide-svelte';

	// ---- defaults (also used by "reset to default") -----------------------------
	const defaultFunnelSizes = (): ('third' | 'half')[] => ['third', 'third', 'half'];
	const defaultRoleColors = () => Object.fromEntries(COLOR_ROLES.map((r) => [r.id, r.default]));
	const defaultSelected = () =>
		Object.fromEntries(PARTS.map((p) => [p.id, !('bins' in p.quantities)]));
	const defaultInclSupport = () =>
		Object.fromEntries(PARTS.filter((p) => p.support_grams > 0).map((p) => [p.id, p.id === 'stator']));

	// per-layer size list is the shared source of truth (also used by the framing tab)
	const funnelSizes = $derived(layerStore.sizes);
	const layers = $derived(funnelSizes.length);
	function addLayer() {
		addLayerStore();
	}
	function removeLayer(i: number) {
		removeLayerAt(i);
	}
	let roleColors = $state<Record<string, string>>(defaultRoleColors());
	let selected = $state<Record<string, boolean>>(defaultSelected());
	let surplus = $state(15);
	let printBins = $state(false); // top-level: print bins or not (auto-selects the right bins)
	const partsById = new Map(PARTS.map((p) => [p.id, p]));
	// bins are governed by the printBins toggle (+ per-layer size); everything else by its checkbox
	function isIncluded(id: string): boolean {
		const p = partsById.get(id);
		if (p && 'bins' in p.quantities) return printBins;
		return selected[id];
	}
	// include each part's support material in totals — default on for the stator only
	let inclSupport = $state<Record<string, boolean>>(defaultInclSupport());

	// ---- persistence: load saved config at boot, save on change ----------------
	let configLoaded = $state(false);
	onMount(() => {
		const c = loadConfig();
		if (c) {
			if (c.roleColors) roleColors = { ...roleColors, ...c.roleColors };
			if (typeof c.printBins === 'boolean') printBins = c.printBins;
			if (typeof c.surplus === 'number') surplus = c.surplus;
			if (c.selected) selected = { ...selected, ...c.selected };
			if (c.inclSupport) inclSupport = { ...inclSupport, ...c.inclSupport };
		}
		configLoaded = true;
	});
	$effect(() => {
		const snapshot = { roleColors, printBins, surplus, selected, inclSupport };
		if (configLoaded) saveConfig($state.snapshot(snapshot));
	});
	function resetToDefaults() {
		setSizes(defaultFunnelSizes());
		roleColors = defaultRoleColors();
		selected = defaultSelected();
		inclSupport = defaultInclSupport();
		surplus = 15;
		printBins = false;
		clearConfig();
	}
	let zipping = $state(false);
	let activeTab = $state<'parts' | 'plates'>('parts');
	let platesModalOpen = $state(false);
	let platesModalPartId = $state<string | null>(null);
	function openPlatesModal(id: string) {
		platesModalPartId = id;
		platesModalOpen = true;
	}
	let viewerOpen = $state(false);
	let viewerPart = $state<Part | null>(null);
	let viewerColorId = $state('ash-gray');

	// the per-layer size drives both the funnel and the bin set for that layer
	function variantCount(id: string): number | null {
		const nThird = funnelSizes.filter((s) => s === 'third').length;
		const nHalf = funnelSizes.filter((s) => s === 'half').length;
		switch (id) {
			case 'funnel-third': return nThird;
			case 'funnel-half': return nHalf;
			case 'bin-half-left':
			case 'bin-half-right': return nHalf * 6; // 6 per section, 6 sections, per half layer
			case 'bin-third-left':
			case 'bin-third-center':
			case 'bin-third-rightback': return nThird * 6; // 18 per third layer (3 × 6)
			default: return null;
		}
	}

	// per-layer size 'half' = 12 bins, 'third' = 18 bins
	const sizePreview = {
		half: { count: 12, bins: ['bin-half-left', 'bin-half-right'], funnel: 'funnel-half' },
		third: { count: 18, bins: ['bin-third-left', 'bin-third-center', 'bin-third-rightback'], funnel: 'funnel-third' }
	} as const;
	function render(id: string): string {
		return partsById.get(id)?.render ?? '';
	}

	const buy = $derived(
		buyList(layers, roleColors, isIncluded, (id) => !!inclSupport[id], variantCount, surplus)
	);

	// theoretical total print time: every included part printed alone, sequentially,
	// on one printer (one part per plate — no batching)
	const totalPrintSeconds = $derived(
		PARTS.reduce((sum, p) => {
			if (!isIncluded(p.id)) return sum;
			const vc = variantCount(p.id);
			const count = vc !== null ? vc : machineQty(p, layers);
			return sum + p.print_seconds * count;
		}, 0)
	);

	const sectionRows = $derived(
		SECTIONS.map((s) => {
			const parts = PARTS.filter((p) => sectionQty(p, s.id) > 0);
			const mult = categoryMultiplier(s.id, layers);
			const selectedGrams = parts
				.filter((p) => isIncluded(p.id))
				.reduce(
					(sum, p) => sum + effectiveGrams(p, !!inclSupport[p.id]) * displayCount(p, s.id, layers, variantCount),
					0
				);
			return { section: s, parts, mult, selectedGrams };
		}).filter((r) => r.parts.length > 0)
	);

	const selectedParts = $derived(PARTS.filter((p) => isIncluded(p.id)));
	const allSelected = $derived(PARTS.every((p) => selected[p.id]));

	const prettyPattern = SETTINGS.infill_pattern.replace('adaptivecubic', 'adaptive cubic');
	const settingsRows: [string, string][] = [
		['Printer', 'Bambu Lab A1 · 0.4 mm'],
		['Layer height', '0.20 mm'],
		['Infill', `${SETTINGS.infill_density} ${prettyPattern}`],
		['Supports', `Off (per part; stator: normal ≤${SETTINGS.support_threshold_deg}°)`],
		['Skirt', 'None'],
		['Filament', `${SETTINGS.filament} · ${SETTINGS.density_g_cm3} g/cm³`]
	];

	function setAll(v: boolean) {
		selected = Object.fromEntries(PARTS.map((p) => [p.id, v]));
	}

	type Block = { kind: 'part'; part: Part } | { kind: 'assembly'; id: string; parts: Part[] };
	function groupBlocks(parts: Part[]): Block[] {
		const blocks: Block[] = [];
		let cur: { kind: 'assembly'; id: string; parts: Part[] } | null = null;
		for (const p of parts) {
			if (p.assembly) {
				if (!cur || cur.id !== p.assembly) {
					cur = { kind: 'assembly', id: p.assembly, parts: [] };
					blocks.push(cur);
				}
				cur.parts.push(p);
			} else {
				cur = null;
				blocks.push({ kind: 'part', part: p });
			}
		}
		return blocks;
	}
	function openViewer(p: Part) {
		viewerPart = p;
		viewerColorId = primaryColorId(p, roleColors) ?? 'ash-gray';
		viewerOpen = true;
	}
	async function downloadZip(parts: Part[], name: string) {
		if (!parts.length) return;
		zipping = true;
		try {
			const files: Record<string, Uint8Array> = {};
			for (const p of parts) {
				const res = await fetch(p.stl);
				files[`${p.id}.stl`] = new Uint8Array(await res.arrayBuffer());
			}
			const zipped = zipSync(files, { level: 6 });
			const a = document.createElement('a');
			a.href = URL.createObjectURL(new Blob([zipped as BlobPart], { type: 'application/zip' }));
			a.download = name;
			a.click();
			URL.revokeObjectURL(a.href);
		} finally {
			zipping = false;
		}
	}
</script>

<div class="mx-auto max-w-6xl px-4 py-8 sm:px-6">
	<header class="mb-5">
		<h1 class="text-2xl font-bold text-text">3D printed parts</h1>
		<p class="mt-1 text-sm text-text-muted">
			Configure a build to get per-color filament quantities and download the STLs. Filament
			estimates from OrcaSlicer outputs.
		</p>
	</header>

	<!-- print settings -->
	<table class="mb-6 w-full max-w-xl border border-border text-sm">
		<tbody>
			{#each settingsRows as [k, v], i (k)}
				<tr class={i % 2 ? 'bg-[var(--color-bg)]' : ''}>
					<td class="w-40 border-r border-border px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-text-muted">{k}</td>
					<td class="px-3 py-1.5 text-text">{v}</td>
				</tr>
			{/each}
		</tbody>
	</table>

	<!-- BUILD OPTIONS = colors + layer configuration -->
	<section class="mb-8">
		<div class="mb-3 flex items-center justify-between">
			<h2 class="text-base font-semibold text-text">Build options</h2>
			<button
				class="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text"
				onclick={resetToDefaults}
				title="Reset all build options to defaults"
			>
				<RotateCcw size={14} /> Reset to default
			</button>
		</div>

		<!-- colors -->
		<div class="setup-panel mb-4 p-4">
			<div class="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-text-muted">
				Colors
				<Popover width="w-72" label="About the color options">
					Each color picker sets every part in that group. Parts that must be a specific color —
					stators, rotors, light post caps, the classification dome, the lazy-Susan chute mount — keep
					their required color and aren't affected.
				</Popover>
			</div>
			<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
				{#each COLOR_ROLES as role (role.id)}
					<ColorPicker bind:value={roleColors[role.id]} label={role.name} />
				{/each}
			</div>
		</div>

		<!-- layer configuration -->
		<div class="setup-panel p-4">
			<div class="mb-3 flex flex-wrap items-center justify-between gap-3">
				<span class="text-xs font-semibold uppercase tracking-wider text-text-muted">
					Layers <span class="font-normal normal-case text-text-muted">· {layers} layer{layers === 1 ? '' : 's'}, bins per layer</span>
				</span>
				<label class="flex cursor-pointer items-center gap-2 text-sm">
					<input class="setup-toggle h-4 w-4" type="checkbox" bind:checked={printBins} />
					<span class="font-medium text-text">Print bins</span>
					<span class="text-xs text-text-muted">— include bins (size/qty per layer below)</span>
				</label>
			</div>
			<div class="flex flex-col gap-2">
				{#each funnelSizes as size, i (i)}
					{@const pv = sizePreview[size]}
					<div class="group setup-card-shell flex flex-wrap items-center gap-3 border px-3 py-2">
						<span class="w-16 shrink-0 text-sm font-medium text-text">Layer {i + 1}</span>
						<div class="flex">
							<button class="setup-button-secondary h-9 px-3 text-sm {size === 'half' ? 'setup-button-primary' : ''}" onclick={() => setSize(i, 'half')}>12 bins</button>
							<button class="setup-button-secondary h-9 border-l-0 px-3 text-sm {size === 'third' ? 'setup-button-primary' : ''}" onclick={() => setSize(i, 'third')}>18 bins</button>
						</div>
						<div class="ml-auto flex items-center gap-1.5">
							{#each pv.bins as b (b)}
								<img src={render(b)} alt={b} class="h-9 w-9 border border-border bg-[var(--color-bg)] object-contain {printBins ? '' : 'opacity-30'}" title={partsById.get(b)?.name} />
							{/each}
							<span class="px-1 text-text-muted">+</span>
							<img src={render(pv.funnel)} alt="funnel" class="h-9 w-9 border border-primary/40 bg-[var(--color-bg)] object-contain" title="{size} funnel" />
						</div>
						{#if layers > 1}
							<button
								class="flex h-7 w-7 shrink-0 items-center justify-center text-text-muted opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
								onclick={() => removeLayer(i)}
								aria-label="Remove layer {i + 1}"
								title="Remove layer"
							>
								<X size={16} />
							</button>
						{/if}
					</div>
				{/each}
				<button
					class="setup-button-secondary flex h-10 w-full items-center justify-center gap-1.5 text-sm font-medium"
					onclick={addLayer}
				>
					<Plus size={16} /> Add layer
				</button>
			</div>
		</div>
	</section>

	{#snippet partRow(p: Part, sectionId: string, mult: number, indent: boolean)}
		{@const n = displayCount(p, sectionId, layers, variantCount)}
		{@const sw = partSwatches(p, sectionId, roleColors)}
		{@const eff = effectiveGrams(p, !!inclSupport[p.id])}
		<tr class="border-b border-border align-middle last:border-b-0">
			<td class="w-8 py-2 {indent ? 'border-l-2 border-primary/40 pl-5' : 'pl-3'}">
				{#if 'bins' in p.quantities}
					<input class="setup-toggle h-4 w-4" type="checkbox" checked={printBins} onchange={() => (printBins = !printBins)} aria-label="Print bins (set in Build options)" title="Controlled by the Print bins toggle in Build options" />
				{:else}
					<input class="setup-toggle h-4 w-4" type="checkbox" bind:checked={selected[p.id]} aria-label="Select {p.name}" />
				{/if}
			</td>
			<td class="py-2 pl-2">
				<button
					type="button"
					class="group relative h-12 w-12 shrink-0 border border-border bg-[var(--color-bg)]"
					onclick={() => openViewer(p)}
					title="View {p.name} in 3D"
				>
					<img src={p.render} alt={p.name} class="h-full w-full object-contain" />
					<span class="absolute inset-0 flex items-center justify-center bg-black/40 text-white opacity-0 transition-opacity group-hover:opacity-100"><ZoomIn size={18} /></span>
				</button>
			</td>
			<td class="py-2 pl-3 pr-2">
				<span class="flex flex-wrap items-center gap-2 font-medium text-text">
					{p.name}
					{#if p.optional}<span class="border border-warning/50 px-1 text-xs text-warning-dark">optional</span>{/if}
					{#if p.support_used}<span class="border border-info/50 px-1 text-xs text-info" title="Sliced with support material — included in this part's grams">supports</span>{/if}
						{#if platesForPart(p.id).length}<button type="button" class="inline-flex items-center gap-0.5 border border-border px-1 text-xs text-text-muted hover:border-primary hover:text-primary" onclick={() => openPlatesModal(p.id)} title="Show plates with this part"><Layers3 size={11} /> {platesForPart(p.id).length} plate{platesForPart(p.id).length === 1 ? '' : 's'}</button>{/if}{#if p.onshape}<a href={p.onshape} target="_blank" rel="noopener" class="inline-flex items-center gap-0.5 border border-border px-1 text-xs text-text-muted hover:border-primary hover:text-primary" title="Open the source Onshape document">Onshape <ExternalLink size={11} /></a>{/if}{#if p.info}<Popover width="w-64" label="About {p.name}" text={p.info} />{/if}
				</span>
				<span class="flex flex-wrap items-center gap-1.5 text-xs text-text-muted">
					{#each sw as s}
						<span class="inline-flex items-center gap-1">
							<span class="h-3 w-3 border border-border" style="background:{s.color?.hex ?? 'repeating-linear-gradient(45deg,#ccc,#ccc 2px,#eee 2px,#eee 4px)'}"></span>
							{#if sw.length > 1}{s.qty}× {/if}{s.color?.name ?? 'any'}
						</span>
					{/each}
					· {duration(p.print_seconds)}
				</span>
				{#if p.support_grams > 0}
					<label class="mt-0.5 flex w-fit cursor-pointer items-center gap-1.5 text-xs text-text-muted">
						<input class="setup-toggle h-3.5 w-3.5" type="checkbox" bind:checked={inclSupport[p.id]} />
						total {p.grams.toFixed(0)} g · support {p.support_grams.toFixed(0)} g
						<span class="opacity-70">({inclSupport[p.id] ? 'included' : 'excluded'})</span>
					</label>
				{/if}
			</td>
			<td class="whitespace-nowrap py-2 pr-2 text-right text-xs text-text-muted">{eff.toFixed(0)} g × {n}</td>
			<td class="whitespace-nowrap py-2 pr-2 text-right tabular-nums">{grams(eff * n)}</td>
			<td class="py-2 pr-3 text-right">
				<a class="inline-flex items-center text-primary hover:text-primary-hover" href={p.stl} download title="Download {p.name}.stl"><Download size={15} /></a>
			</td>
		</tr>
	{/snippet}

	<div class="grid gap-6 lg:grid-cols-[1fr_340px]">
		<!-- LEFT: parts by section -->
		<div>
			<div class="mb-3 flex items-center justify-between border-b border-border">
				<div class="flex gap-1">
					<button class="border-b-2 px-3 py-2 text-sm font-semibold {activeTab === 'parts' ? 'border-text text-text' : 'border-transparent text-text-muted hover:text-text'}" onclick={() => (activeTab = 'parts')}>Parts</button>
					<button class="border-b-2 px-3 py-2 text-sm font-semibold {activeTab === 'plates' ? 'border-text text-text' : 'border-transparent text-text-muted hover:text-text'}" onclick={() => (activeTab = 'plates')}>Build plates{PLATES.length ? ` (${PLATES.length})` : ''}</button>
				</div>
				{#if activeTab === 'parts'}
					<span class="text-sm text-text-muted">
						{selectedParts.length}/{PARTS.length} selected ·
						<button class="text-primary hover:text-primary-hover" onclick={() => setAll(!allSelected)}>
							{allSelected ? 'deselect all' : 'select all'}
						</button>
					</span>
				{/if}
			</div>

			{#if activeTab === 'parts'}
				{#each sectionRows as { section, parts, mult, selectedGrams } (section.id)}
				<section class="mb-6">
					<h3 class="mb-1 flex items-baseline gap-2 border-b-2 border-text pb-1 text-sm font-semibold text-text">
						{section.name}
						{#if section.scales_with_layers}
							<span class="text-xs font-normal uppercase tracking-wider text-text-muted">× {mult} layer{mult === 1 ? '' : 's'}</span>
						{/if}
						<span class="ml-auto text-xs font-normal text-text-muted">{grams(selectedGrams)}</span>
					</h3>
					<div class="setup-card-shell border">
						<table class="w-full text-sm">
							<tbody>
								{#each groupBlocks(parts) as block}
									{#if block.kind === 'assembly'}
										<tr>
											<td colspan="6" class="border-l-2 border-primary/40 bg-[var(--color-bg)] py-1.5 pl-3 text-xs font-semibold uppercase tracking-wider text-text-muted" title={getAssembly(block.id)?.description}>
												{getAssembly(block.id)?.name} · assembly
											</td>
										</tr>
										{#each block.parts as p (p.id)}
											{@render partRow(p, section.id, mult, true)}
										{/each}
									{:else}
										{@render partRow(block.part, section.id, mult, false)}
									{/if}
								{/each}
							</tbody>
						</table>
					</div>
				</section>
			{/each}
			{:else}
				<BuildPlates highlightPartId={null} />
			{/if}
		</div>

		<!-- RIGHT: order summary -->
		<aside class="self-start lg:sticky lg:top-6">
			<h2 class="mb-2 flex items-center gap-2 text-base font-semibold text-text">
				<Package size={16} /> What to order
			</h2>
			<div class="mb-2 flex items-center gap-2">
				<label for="surplus" class="text-sm text-text">Extra filament</label>
				<div class="flex items-center">
					<input
						id="surplus"
						class="setup-control h-8 w-14 text-center text-sm"
						type="number"
						min="0"
						max="100"
						bind:value={surplus}
						onchange={() => (surplus = Math.max(0, Math.min(100, Math.round(surplus || 0))))}
					/>
					<span class="ml-1 text-sm text-text-muted">%</span>
				</div>
			</div>
			<p class="mb-2 text-xs text-text-muted">Buffer for incidental parts &amp; failed prints.</p>
			<div class="setup-card-shell border">
				<table class="w-full text-sm">
					<thead>
						<tr class="bg-[var(--color-bg)] text-left text-xs uppercase tracking-wider text-text-muted">
							<th class="px-3 py-2 font-semibold">Color</th>
							<th class="px-3 py-2 text-right font-semibold">Spools</th>
							<th class="px-3 py-2 text-right font-semibold">Cost</th>
						</tr>
					</thead>
					<tbody>
						{#each buy.lines as line (line.colorId ?? '__any__')}
							<tr class="border-t border-border">
								<td class="px-3 py-2">
									<span class="flex items-center gap-2">
										<span class="h-4 w-4 border border-border" style="background:{line.color?.hex ?? 'repeating-linear-gradient(45deg,#ccc,#ccc 3px,#eee 3px,#eee 6px)'}"></span>
										<span class="leading-tight">{line.label}<br><span class="text-xs text-text-muted">{grams(line.grams)}</span></span>
									</span>
								</td>
								<td class="px-3 py-2 text-right font-semibold tabular-nums">{line.spools}</td>
								<td class="px-3 py-2 text-right tabular-nums">{money(line.cost)}</td>
							</tr>
						{:else}
							<tr><td colspan="3" class="px-3 py-4 text-center text-sm text-text-muted">Nothing selected.</td></tr>
						{/each}
					</tbody>
					<tfoot>
						<tr class="border-t-2 border-text/20 bg-[var(--color-bg)] font-semibold">
							<td class="px-3 py-2">Total · {grams(buy.totalGrams)}</td>
							<td class="px-3 py-2 text-right tabular-nums">{buy.totalSpools}</td>
							<td class="px-3 py-2 text-right tabular-nums">{money(buy.totalCost)}</td>
						</tr>
					</tfoot>
				</table>
			</div>

			<!-- pricing note -->
			<div class="mt-2 flex gap-2 border border-border/60 bg-[var(--color-bg)] p-2.5 text-xs text-text-muted">
				<Info size={14} class="mt-0.5 shrink-0" />
				<span>
					Uses <a class="text-primary hover:text-primary-hover" href={STORE_URL} target="_blank" rel="noopener">Bambu Lab bulk pricing ↗</a>
					(PLA Matte, w/ spool): $24.99 ea, $17.99 at 4+, $16.99 at 6+. You're at
					<b>{money(buy.perSpool)}/spool</b> ({buy.totalSpools} roll{buy.totalSpools === 1 ? '' : 's'}).
				</span>
			</div>

			<div class="mt-2 flex items-center justify-between border border-border bg-[var(--color-bg)] px-3 py-2.5">
				<div class="flex items-center gap-2 text-sm text-text">
					<Clock size={15} class="text-text-muted" /> Total print time
				</div>
				<div class="text-right">
					<div class="text-base font-semibold tabular-nums text-text">{durationLong(totalPrintSeconds)}</div>
					<div class="text-xs text-text-muted">1 printer · 1 part/plate</div>
				</div>
			</div>

			<div class="mt-3 grid gap-2">
				<button
					class="setup-button-primary inline-flex h-10 items-center justify-center gap-2 px-4 text-sm font-semibold disabled:opacity-50"
					onclick={() => downloadZip(selectedParts, 'sorter-stls.zip')}
					disabled={zipping || selectedParts.length === 0}
				>
					{#if zipping}<Loader size={15} class="animate-spin" />{:else}<Download size={15} />{/if}
					Download selected ({selectedParts.length})
				</button>
				<a class="setup-button-secondary inline-flex h-10 items-center justify-center gap-2 px-4 text-sm font-semibold" href="/stl/all-parts.zip" download>
					<Download size={15} /> Download all ({PARTS.length})
				</a>
			</div>
		</aside>
	</div>

	<footer class="mt-10 border-t border-border pt-4 text-xs text-text-muted">
		A machine = 1 feeder + 1 classification channel + 1 interface + 1 chute + 1 lazy Susan +
		N × (distribution frame + bins + funnels). Distribution frame, bins and funnels are per layer.
		Grams from OrcaSlicer; regenerate with <code class="font-mono">slicer/filament.py</code>.
	</footer>
</div>

<Modal bind:open={viewerOpen} title={viewerPart?.name}>
	{#if viewerPart}
		<StlViewer url={viewerPart.stl} color={getBambuColor(viewerColorId).hex} />
		<div class="flex flex-wrap items-end justify-between gap-3 px-4 py-3">
			{#if viewerPart.description}
				<p class="max-w-md text-sm text-text-muted">{viewerPart.description}</p>
			{:else}
				<span></span>
			{/if}
			<div class="w-44 shrink-0">
				<ColorPicker bind:value={viewerColorId} label="Preview color" />
			</div>
		</div>
	{/if}
</Modal>

<Modal bind:open={platesModalOpen} title="Build plates · {partsById.get(platesModalPartId ?? '')?.name ?? ''}">
	<div class="p-4">
		<BuildPlates highlightPartId={platesModalPartId} />
	</div>
</Modal>
