<script lang="ts">
	import {
		PARTS,
		SECTIONS,
		COLOR_ROLES,
		SETTINGS,
		sectionQty,
		resolveColorId,
		buyList,
		grams,
		money,
		duration
	} from '$lib/filament';
	import { getLegoColor } from '$lib/lego-colors';
	import ColorPicker from '$lib/components/ColorPicker.svelte';
	import { Download, Package, Layers, AlertTriangle } from 'lucide-svelte';

	let layers = $state(1);
	let includeOptional = $state(true);
	let roleColors = $state<Record<string, string>>(
		Object.fromEntries(COLOR_ROLES.map((r) => [r.id, r.default]))
	);

	const buy = $derived(buyList(layers, roleColors, includeOptional));

	// parts present in each section (with that section's per-instance qty)
	const sectionRows = $derived(
		SECTIONS.map((s) => {
			const parts = PARTS.filter(
				(p) => sectionQty(p, s.id) > 0 && (includeOptional || !p.optional)
			);
			const perInstance = parts.reduce((sum, p) => sum + p.grams * sectionQty(p, s.id), 0);
			return { section: s, parts, perInstance };
		}).filter((r) => r.parts.length > 0)
	);

	function partColor(p: (typeof PARTS)[number]) {
		const id = resolveColorId(p, roleColors);
		return id ? getLegoColor(id) : null;
	}
	function clampLayers(n: number) {
		layers = Math.max(1, Math.min(20, Math.round(n || 1)));
	}
</script>

<div class="mx-auto max-w-5xl px-4 py-8 sm:px-6">
	<!-- header -->
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

		<div class="mt-3 flex flex-wrap items-center gap-4">
			<a class="setup-button-primary inline-flex h-10 items-center gap-2 px-4 text-sm font-semibold" href="/stl/all-parts.zip" download>
				<Download size={15} /> Download all STLs (.zip)
			</a>
			<label class="flex items-center gap-2 text-sm text-text-muted">
				<input class="setup-toggle h-4 w-4" type="checkbox" bind:checked={includeOptional} />
				Include optional parts
			</label>
		</div>
	</section>

	<!-- per-section breakdown -->
	{#each sectionRows as { section, parts, perInstance } (section.id)}
		<section class="mb-8">
			<h2 class="mb-1 flex items-baseline gap-2 border-b-2 border-text pb-1 text-base font-semibold text-text">
				{section.name}
				{#if section.scales_with_layers}
					<span class="text-xs font-normal uppercase tracking-wider text-text-muted">× {layers} per machine</span>
				{/if}
			</h2>
			<div class="setup-card-shell border">
				<table class="w-full text-sm">
					<thead>
						<tr class="bg-[var(--color-bg)] text-left text-xs uppercase tracking-wider text-text-muted">
							<th class="px-3 py-2 font-semibold">Part</th>
							<th class="px-3 py-2 text-right font-semibold">g / ea</th>
							<th class="px-3 py-2 text-right font-semibold">Qty</th>
							<th class="px-3 py-2 text-right font-semibold">Subtotal</th>
							<th class="px-3 py-2 text-right font-semibold">STL</th>
						</tr>
					</thead>
					<tbody>
						{#each parts as p (p.id)}
							{@const q = sectionQty(p, section.id)}
							{@const c = partColor(p)}
							<tr class="border-t border-border align-middle">
								<td class="px-3 py-2">
									<span class="flex items-center gap-3">
										<img src={p.render} alt={p.name} class="h-12 w-12 shrink-0 object-contain" />
										<span>
											<span class="flex items-center gap-2 font-medium text-text">
												{p.name}
												{#if p.optional}<span class="border border-warning/50 px-1 text-xs text-warning-dark">optional</span>{/if}
											</span>
											<span class="flex items-center gap-1.5 text-xs text-text-muted">
												<span class="h-3 w-3 border border-border" style="background:{c?.hex ?? 'repeating-linear-gradient(45deg,#ccc,#ccc 2px,#eee 2px,#eee 4px)'}"></span>
												{c?.name ?? 'any color'}
												{#if p.support_used}· supported{/if}
												· {duration(p.print_seconds)}
											</span>
										</span>
									</span>
								</td>
								<td class="px-3 py-2 text-right tabular-nums">{p.grams.toFixed(1)} g</td>
								<td class="px-3 py-2 text-right tabular-nums">{q}</td>
								<td class="px-3 py-2 text-right tabular-nums">{grams(p.grams * q)}</td>
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
							<td class="px-3 py-2 text-xs uppercase tracking-wider" colspan="3">
								Per {section.name.toLowerCase()}
							</td>
							<td class="px-3 py-2 text-right font-semibold text-text tabular-nums" colspan="2">{grams(perInstance)}</td>
						</tr>
					</tfoot>
				</table>
			</div>
		</section>
	{/each}

	{#if PARTS.length === 0}
		<p class="setup-panel flex items-center gap-2 p-4 text-sm text-text-muted">
			<AlertTriangle size={16} /> No parts yet. Add STLs in <code class="font-mono">slicer/parts/</code>, list them in <code class="font-mono">slicer/parts.json</code>, then run <code class="font-mono">python filament.py</code>.
		</p>
	{/if}

	<footer class="mt-10 border-t border-border pt-4 text-xs text-text-muted">
		Grams are OrcaSlicer output for {SETTINGS.printer} · {SETTINGS.process} ·
		{SETTINGS.density_g_cm3} g/cm³ · {money(SETTINGS.cost_per_kg)}/kg. A machine =
		1 feeder + 1 top interface + 1 bottom interface + N × distribution frame.
		Regenerate data with <code class="font-mono">slicer/filament.py</code>.
	</footer>
</div>
