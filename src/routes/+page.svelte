<script lang="ts">
	import {
		PARTS,
		SECTIONS,
		COLOR_ROLES,
		SETTINGS,
		STORE_URL,
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
	import { Download, Package, Layers, ZoomIn, Loader, Info } from 'lucide-svelte';

	let layers = $state(3);
	let roleColors = $state<Record<string, string>>(
		Object.fromEntries(COLOR_ROLES.map((r) => [r.id, r.default]))
	);
	// default: everything selected EXCEPT bins
	let selected = $state<Record<string, boolean>>(
		Object.fromEntries(PARTS.map((p) => [p.id, p.category !== 'bins']))
	);
	let zipping = $state(false);
	let viewerOpen = $state(false);
	let viewerPart = $state<Part | null>(null);

	const buy = $derived(buyList(layers, roleColors, (id) => selected[id]));

	const sectionRows = $derived(
		SECTIONS.map((s) => {
			const parts = PARTS.filter((p) => p.category === s.id);
			const mult = categoryMultiplier(s.id, layers);
			const selectedGrams = parts
				.filter((p) => selected[p.id])
				.reduce((sum, p) => sum + p.grams * p.quantity * mult, 0);
			return { section: s, parts, mult, selectedGrams };
		}).filter((r) => r.parts.length > 0)
	);

	const selectedParts = $derived(PARTS.filter((p) => selected[p.id]));
	const allSelected = $derived(PARTS.every((p) => selected[p.id]));

	const prettyPattern = SETTINGS.infill_pattern.replace('adaptivecubic', 'adaptive cubic');
	const settingsRows: [string, string][] = [
		['Printer', 'Bambu Lab A1 · 0.4 mm'],
		['Layer height', '0.20 mm'],
		['Infill', `${SETTINGS.infill_density} ${prettyPattern}`],
		[
			'Supports',
			SETTINGS.support_enabled
				? `Normal (auto), ≤${SETTINGS.support_threshold_deg}° overhang`
				: 'Off'
		],
		['Skirt', 'None'],
		['Filament', `${SETTINGS.filament} · ${SETTINGS.density_g_cm3} g/cm³`]
	];

	function clampLayers(n: number) {
		layers = Math.max(1, Math.min(20, Math.round(n || 1)));
	}
	function setAll(v: boolean) {
		selected = Object.fromEntries(PARTS.map((p) => [p.id, v]));
	}
	function openViewer(p: Part) {
		viewerPart = p;
		viewerOpen = true;
	}
	function viewerColor(p: Part): string {
		return partSwatches(p, roleColors).find((s) => s.color)?.color?.hex ?? '#0055bf';
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
		<h1 class="text-2xl font-bold text-text">Sorter — Filament Calculator</h1>
		<p class="mt-1 text-sm text-text-muted">
			Pick colors and a layer count, check the parts you'll print, and it tells you exactly what
			filament to order. Grams are OrcaSlicer's own output — not estimates.
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

	<!-- global controls -->
	<section class="setup-panel mb-6 p-4">
		<div class="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-text-muted">
			Build options
			<span
				class="inline-flex cursor-help text-text-muted"
				title="Each color picker sets every part in that group. Parts that must be a specific color — stators, rotors, light post caps, the classification dome, the lazy-Susan chute mount — keep their required color and are not affected."
			>
				<Info size={14} />
			</span>
		</div>
		<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
			<div>
				<span class="mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-text-muted">
					<Layers size={13} /> Layers
				</span>
				<div class="flex">
					<button class="setup-button-secondary h-11 w-11 text-lg" onclick={() => clampLayers(layers - 1)}>−</button>
					<input class="setup-control h-11 w-full min-w-0 border-x-0 text-center text-base" type="number" min="1" max="20" bind:value={layers} onchange={() => clampLayers(layers)} />
					<button class="setup-button-secondary h-11 w-11 text-lg" onclick={() => clampLayers(layers + 1)}>+</button>
				</div>
			</div>
			{#each COLOR_ROLES as role (role.id)}
				<ColorPicker bind:value={roleColors[role.id]} label={role.name} />
			{/each}
		</div>
	</section>

	<div class="grid gap-6 lg:grid-cols-[1fr_340px]">
		<!-- LEFT: parts by section -->
		<div>
			<div class="mb-2 flex items-center justify-between">
				<h2 class="text-base font-semibold text-text">Parts</h2>
				<span class="text-sm text-text-muted">
					{selectedParts.length}/{PARTS.length} selected ·
					<button class="text-primary hover:text-primary-hover" onclick={() => setAll(!allSelected)}>
						{allSelected ? 'deselect all' : 'select all'}
					</button>
				</span>
			</div>

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
								{#each parts as p (p.id)}
									<tr class="border-b border-border last:border-b-0 align-middle">
										<td class="w-8 py-2 pl-3">
											<input class="setup-toggle h-4 w-4" type="checkbox" bind:checked={selected[p.id]} aria-label="Select {p.name}" />
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
												{#if p.support_used}· supported{/if} · {duration(p.print_seconds)}
											</span>
										</td>
										<td class="whitespace-nowrap py-2 pr-2 text-right text-xs text-text-muted">
											{p.grams.toFixed(0)} g × {p.quantity * mult}
										</td>
										<td class="whitespace-nowrap py-2 pr-2 text-right tabular-nums">{grams(p.grams * p.quantity * mult)}</td>
										<td class="py-2 pr-3 text-right">
											<a class="inline-flex items-center text-primary hover:text-primary-hover" href={p.stl} download title="Download {p.name}.stl"><Download size={15} /></a>
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				</section>
			{/each}
		</div>

		<!-- RIGHT: order summary -->
		<aside class="self-start lg:sticky lg:top-6">
			<h2 class="mb-2 flex items-center gap-2 text-base font-semibold text-text">
				<Package size={16} /> What to order
			</h2>
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
						{#each buy.lines as line (line.label)}
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
					(PLA Basic, w/ spool): $24.99 ea, $17.99 at 4+, $16.99 at 6+. You're at
					<b>{money(buy.perSpool)}/spool</b> ({buy.totalSpools} roll{buy.totalSpools === 1 ? '' : 's'}).
				</span>
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
		<StlViewer url={viewerPart.stl} color={viewerColor(viewerPart)} />
		{#if viewerPart.description}
			<p class="px-4 py-3 text-sm text-text-muted">{viewerPart.description}</p>
		{/if}
	{/if}
</Modal>
