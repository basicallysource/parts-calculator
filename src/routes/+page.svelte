<script lang="ts">
	import {
		PARTS,
		SECTIONS,
		COLOR_ROLES,
		SETTINGS,
		categoryMultiplier,
		partSwatches,
		buyList,
		grams,
		money,
		duration,
		type Part
	} from '$lib/filament';
	import ColorPicker from '$lib/components/ColorPicker.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import StlViewer from '$lib/components/StlViewer.svelte';
	import { zipSync } from 'fflate';
	import { Download, Package, Layers, ZoomIn, Loader } from 'lucide-svelte';

	let layers = $state(1);
	let includeOptional = $state(true);
	let roleColors = $state<Record<string, string>>(
		Object.fromEntries(COLOR_ROLES.map((r) => [r.id, r.default]))
	);
	let selected = $state<Record<string, boolean>>({});
	let zipping = $state(false);

	let viewerOpen = $state(false);
	let viewerPart = $state<Part | null>(null);

	const buy = $derived(buyList(layers, roleColors, includeOptional));

	const sectionRows = $derived(
		SECTIONS.map((s) => {
			const parts = PARTS.filter(
				(p) => p.category === s.id && (includeOptional || !p.optional)
			);
			const perInstance = parts.reduce((sum, p) => sum + p.grams * p.quantity, 0);
			const mult = categoryMultiplier(s.id, layers);
			return { section: s, parts, perInstance, mult };
		}).filter((r) => r.parts.length > 0)
	);

	const visibleParts = $derived(
		PARTS.filter((p) => includeOptional || !p.optional)
	);
	const selectedParts = $derived(visibleParts.filter((p) => selected[p.id]));
	const allSelected = $derived(
		visibleParts.length > 0 && visibleParts.every((p) => selected[p.id])
	);

	function clampLayers(n: number) {
		layers = Math.max(1, Math.min(20, Math.round(n || 1)));
	}
	function toggleAll() {
		const next = !allSelected;
		const m: Record<string, boolean> = {};
		for (const p of visibleParts) m[p.id] = next;
		selected = m;
	}
	function openViewer(p: Part) {
		viewerPart = p;
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
			const blob = new Blob([zipped as BlobPart], { type: 'application/zip' });
			const a = document.createElement('a');
			a.href = URL.createObjectURL(blob);
			a.download = name;
			a.click();
			URL.revokeObjectURL(a.href);
		} finally {
			zipping = false;
		}
	}

	function viewerColor(p: Part): string {
		const sw = partSwatches(p, roleColors).find((s) => s.color);
		return sw?.color?.hex ?? '#0055bf';
	}
</script>

<div class="mx-auto max-w-5xl px-4 py-8 sm:px-6">
	<header class="mb-6 border-b border-border pb-5">
		<h1 class="text-2xl font-bold text-text">Sorter — Filament Calculator</h1>
		<p class="mt-1 text-sm text-text-muted">
			Slicer-exact filament for a build. Pick colors and a layer count; it tells you what to order.
			Grams are OrcaSlicer's own output ({SETTINGS.infill_density}
			{SETTINGS.infill_pattern} infill · supports
			{SETTINGS.support_enabled ? `on @${SETTINGS.support_threshold_deg}°` : 'off'} ·
			{SETTINGS.filament}).
		</p>
	</header>

	<!-- controls -->
	<section class="setup-panel mb-6 grid gap-5 p-4 sm:grid-cols-[auto_1fr_1fr]">
		<div>
			<span class="mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-text-muted">
				<Layers size={13} /> Layers
			</span>
			<div class="flex">
				<button class="setup-button-secondary h-11 w-11 text-lg" onclick={() => clampLayers(layers - 1)}>−</button>
				<input
					class="setup-control h-11 w-16 border-x-0 text-center text-base"
					type="number"
					min="1"
					max="20"
					bind:value={layers}
					onchange={() => clampLayers(layers)}
				/>
				<button class="setup-button-secondary h-11 w-11 text-lg" onclick={() => clampLayers(layers + 1)}>+</button>
			</div>
		</div>
		{#each COLOR_ROLES as role (role.id)}
			<ColorPicker bind:value={roleColors[role.id]} label={`${role.name} color`} />
		{/each}
	</section>

	<!-- what to buy -->
	<section class="mb-8">
		<h2 class="mb-2 flex items-center gap-2 text-base font-semibold text-text">
			<Package size={16} /> What to order
			<span class="text-sm font-normal text-text-muted">· {layers} layer{layers === 1 ? '' : 's'}</span>
		</h2>
		<div class="setup-card-shell border">
			<table class="w-full text-sm">
				<thead>
					<tr class="bg-[var(--color-bg)] text-left text-xs uppercase tracking-wider text-text-muted">
						<th class="px-4 py-2 font-semibold">Color</th>
						<th class="px-4 py-2 text-right font-semibold">Filament</th>
						<th class="px-4 py-2 text-right font-semibold">Spools (1 kg)</th>
						<th class="px-4 py-2 text-right font-semibold">Cost</th>
					</tr>
				</thead>
				<tbody>
					{#each buy.lines as line (line.label)}
						<tr class="border-t border-border">
							<td class="px-4 py-2.5">
								<span class="flex items-center gap-2">
									<span class="h-4 w-4 border border-border" style="background:{line.color?.hex ?? 'repeating-linear-gradient(45deg,#ccc,#ccc 3px,#eee 3px,#eee 6px)'}"></span>
									{line.label}
								</span>
							</td>
							<td class="px-4 py-2.5 text-right tabular-nums">{grams(line.grams)}</td>
							<td class="px-4 py-2.5 text-right font-semibold tabular-nums">{line.spools}</td>
							<td class="px-4 py-2.5 text-right tabular-nums">{money(line.cost)}</td>
						</tr>
					{/each}
				</tbody>
				<tfoot>
					<tr class="border-t-2 border-text/20 bg-[var(--color-bg)] font-semibold">
						<td class="px-4 py-2.5">Total</td>
						<td class="px-4 py-2.5 text-right tabular-nums">{grams(buy.totalGrams)}</td>
						<td class="px-4 py-2.5 text-right tabular-nums">{buy.totalSpools}</td>
						<td class="px-4 py-2.5 text-right tabular-nums">{money(buy.totalCost)}</td>
					</tr>
				</tfoot>
			</table>
		</div>

		<div class="mt-3 flex flex-wrap items-center gap-3">
			<button
				class="setup-button-primary inline-flex h-10 items-center gap-2 px-4 text-sm font-semibold disabled:opacity-50"
				onclick={() => downloadZip(selectedParts, 'sorter-selected-stls.zip')}
				disabled={zipping || selectedParts.length === 0}
			>
				{#if zipping}<Loader size={15} class="animate-spin" />{:else}<Download size={15} />{/if}
				Download selected ({selectedParts.length})
			</button>
			<a class="setup-button-secondary inline-flex h-10 items-center gap-2 px-4 text-sm font-semibold" href="/stl/all-parts.zip" download>
				<Download size={15} /> Download all
			</a>
			<label class="flex items-center gap-2 text-sm text-text-muted">
				<input class="setup-toggle h-4 w-4" type="checkbox" bind:checked={includeOptional} />
				Include optional parts
			</label>
		</div>
	</section>

	<!-- per-section breakdown -->
	{#each sectionRows as { section, parts, perInstance, mult } (section.id)}
		<section class="mb-8">
			<h2 class="mb-1 flex items-baseline gap-2 border-b-2 border-text pb-1 text-base font-semibold text-text">
				{section.name}
				{#if section.scales_with_layers}
					<span class="text-xs font-normal uppercase tracking-wider text-text-muted">× {mult} per machine</span>
				{/if}
			</h2>
			<div class="setup-card-shell border">
				<table class="w-full text-sm">
					<thead>
						<tr class="bg-[var(--color-bg)] text-left text-xs uppercase tracking-wider text-text-muted">
							<th class="w-8 px-3 py-2"></th>
							<th class="px-3 py-2 font-semibold">Part</th>
							<th class="px-3 py-2 text-right font-semibold">g / ea</th>
							<th class="px-3 py-2 text-right font-semibold">Qty</th>
							<th class="px-3 py-2 text-right font-semibold">Subtotal</th>
							<th class="px-3 py-2 text-right font-semibold">STL</th>
						</tr>
					</thead>
					<tbody>
						{#each parts as p (p.id)}
							<tr class="border-t border-border align-middle">
								<td class="px-3 py-2">
									<input class="setup-toggle h-4 w-4" type="checkbox" bind:checked={selected[p.id]} aria-label="Select {p.name}" />
								</td>
								<td class="px-3 py-2">
									<span class="flex items-center gap-3">
										<button
											type="button"
											class="group relative h-12 w-12 shrink-0 border border-border bg-[var(--color-bg)]"
											onclick={() => openViewer(p)}
											title="View {p.name} in 3D"
										>
											<img src={p.render} alt={p.name} class="h-full w-full object-contain" />
											<span class="absolute inset-0 flex items-center justify-center bg-black/40 text-white opacity-0 transition-opacity group-hover:opacity-100">
												<ZoomIn size={18} />
											</span>
										</button>
										<span>
											<span class="flex items-center gap-2 font-medium text-text">
												{p.name}
												{#if p.optional}<span class="border border-warning/50 px-1 text-xs text-warning-dark">optional</span>{/if}
											</span>
											<span class="flex flex-wrap items-center gap-1.5 text-xs text-text-muted">
												{#each partSwatches(p, roleColors) as sw}
													<span class="inline-flex items-center gap-1">
														<span class="h-3 w-3 border border-border" style="background:{sw.color?.hex ?? 'repeating-linear-gradient(45deg,#ccc,#ccc 2px,#eee 2px,#eee 4px)'}"></span>
														{#if partSwatches(p, roleColors).length > 1}{sw.qty}× {/if}{sw.color?.name ?? 'any'}
													</span>
												{/each}
												{#if p.support_used}· supported{/if}
												· {duration(p.print_seconds)}
											</span>
										</span>
									</span>
								</td>
								<td class="px-3 py-2 text-right tabular-nums">{p.grams.toFixed(1)} g</td>
								<td class="px-3 py-2 text-right tabular-nums">{p.quantity}</td>
								<td class="px-3 py-2 text-right tabular-nums">{grams(p.grams * p.quantity)}</td>
								<td class="px-3 py-2 text-right">
									<a class="inline-flex items-center text-primary hover:text-primary-hover" href={p.stl} download title="Download {p.name}.stl">
										<Download size={16} />
									</a>
								</td>
							</tr>
						{/each}
					</tbody>
					<tfoot>
						<tr class="border-t border-border bg-[var(--color-bg)] text-text-muted">
							<td></td>
							<td class="px-3 py-2 text-xs uppercase tracking-wider" colspan="3">Per {section.name.toLowerCase()}</td>
							<td class="px-3 py-2 text-right font-semibold text-text tabular-nums" colspan="2">{grams(perInstance)}</td>
						</tr>
					</tfoot>
				</table>
			</div>
		</section>
	{/each}

	<div class="mb-8">
		<button class="text-sm text-primary hover:text-primary-hover" onclick={toggleAll}>
			{allSelected ? 'Deselect all' : 'Select all parts'}
		</button>
	</div>

	<footer class="mt-10 border-t border-border pt-4 text-xs text-text-muted">
		Grams are OrcaSlicer output for {SETTINGS.printer} · {SETTINGS.process} ·
		{SETTINGS.density_g_cm3} g/cm³ · {money(SETTINGS.cost_per_kg)}/kg. A machine =
		1 feeder + 1 interface + 1 chute + classification channel + N × (distribution frame + bins).
		Regenerate data with <code class="font-mono">slicer/filament.py</code>.
	</footer>
</div>

<Modal bind:open={viewerOpen} title={viewerPart?.name}>
	{#if viewerPart}
		<StlViewer url={viewerPart.stl} color={viewerColor(viewerPart)} />
		{#if viewerPart.description}
			<p class="px-4 py-3 text-sm text-text-muted">{viewerPart.description}</p>
		{/if}
	{/if}
</Modal>
