<script lang="ts">
	import { Box, ExternalLink, Hammer, Zap } from 'lucide-svelte';
	import Seo from '$lib/components/Seo.svelte';
	import DownloadButton from '$lib/components/DownloadButton.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import HandCutTopPlateGuide from '$lib/components/HandCutTopPlateGuide.svelte';
	import { LASER_CUT_PARTS, type LaserCutPart } from '$lib/lasercut';
	import { fmtDate } from '$lib/filament';

	// group by assembly (parts without one stand alone), preserving list order
	const groups: { assembly?: string; parts: LaserCutPart[] }[] = [];
	for (const p of LASER_CUT_PARTS) {
		const last = groups[groups.length - 1];
		if (p.assembly && last?.assembly === p.assembly) last.parts.push(p);
		else groups.push({ assembly: p.assembly, parts: [p] });
	}

	// each card offers a second view besides the laser-cut files: the top plate
	// can be cut by hand; the cable cage parts will get 3D-printable options,
	// which aren't ready yet (their tab shows disabled as "Printed").
	type Mode = 'laser' | 'hand';
	const handCutReady = (p: LaserCutPart) => p.id === 'top-plate';
	let mode = $state<Record<string, Mode>>(
		Object.fromEntries(LASER_CUT_PARTS.map((p) => [p.id, 'laser' as Mode]))
	);
	let guideOpen = $state(false);
</script>

<Seo
	title="Laser cut parts"
	description="Laser-cut parts for the Sorter V2 build — DXF downloads with a material and quantity breakdown."
/>

<div class="mx-auto max-w-6xl px-4 py-8 sm:px-6">
	<header class="mb-5">
		<h1 class="text-2xl font-bold text-text">Laser cut parts</h1>
		<p class="mt-1 text-sm text-text-muted">
			Flat plywood parts, cut from the DXFs below. Thicknesses are quoted in the imperial size the
			sheet is sold as, with the nearest full-mm equivalent the CAD expects. No laser? The top
			plate has a “by hand” view; the cable cage parts are getting 3D-printable options.
		</p>
	</header>

	{#each groups as group (group.parts[0].id)}
		<section class="mb-6">
			{#if group.assembly}
				<h2 class="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
					{group.assembly} · assembly
				</h2>
			{/if}
			<div class="grid gap-4 sm:grid-cols-2">
				{#each group.parts as p (p.id)}
					<div class="setup-card-shell flex flex-col border">
						<div class="flex items-center justify-center border-b border-border bg-[var(--color-bg)] p-4">
							<img src={p.preview} alt="{p.name} outline" class="h-48 w-auto max-w-full" />
						</div>
						<div class="flex gap-1 border-b border-border px-2">
							<button
								class="inline-flex items-center gap-1 border-b-2 px-2.5 py-1.5 text-xs font-semibold {mode[p.id] === 'laser'
									? 'border-text text-text'
									: 'border-transparent text-text-muted hover:text-text'}"
								onclick={() => (mode[p.id] = 'laser')}
							>
								<Zap size={12} /> Laser cut
							</button>
							{#if handCutReady(p)}
								<button
									class="inline-flex items-center gap-1 border-b-2 px-2.5 py-1.5 text-xs font-semibold {mode[p.id] === 'hand'
										? 'border-text text-text'
										: 'border-transparent text-text-muted hover:text-text'}"
									onclick={() => (mode[p.id] = 'hand')}
								>
									<Hammer size={12} /> By hand
								</button>
							{:else}
								<span
									class="inline-flex cursor-not-allowed items-center gap-1 border-b-2 border-transparent px-2.5 py-1.5 text-xs font-semibold text-text-muted opacity-40"
									title="Not ready"
								>
									<Box size={12} /> 3D Printed
								</span>
							{/if}
						</div>
						<div class="flex flex-1 flex-col gap-2 px-4 py-3">
							<div class="flex items-baseline justify-between gap-2">
								<h3 class="text-sm font-semibold text-text">{p.name}</h3>
								<span class="text-xs text-text-muted">{p.qty} needed</span>
							</div>
							{#if mode[p.id] === 'laser'}
								<p class="text-sm text-text-muted">{p.description}</p>
								<dl class="grid max-w-sm grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs text-text-muted">
									<dt>Thickness</dt>
									<dd class="text-text">{p.thicknessIn} plywood ({p.thicknessMm} mm)</dd>
									<dt>Cut size</dt>
									<dd class="text-text">{p.widthMm} × {p.heightMm} mm</dd>
									<dt>Updated</dt>
									<dd class="text-text">{fmtDate(p.updated)}</dd>
								</dl>
								<div class="mt-auto flex flex-wrap items-center gap-3 pt-1">
									<DownloadButton href={p.dxf} size="md" label="Download DXF" />
									<a
										href={p.onshape}
										target="_blank"
										rel="noopener"
										class="inline-flex items-center gap-0.5 text-xs text-primary hover:text-primary-hover"
										title="Open the exact OnShape version this DXF came from"
									>
										OnShape <ExternalLink size={11} />
									</a>
								</div>
							{:else}
								<p class="text-sm text-text-muted">
									This plate is a regular hexagon — it can be laid out with a tape measure and cut
									accurately with just a jigsaw and a drill. The five cable slots become single
									22 mm (7/8″) drill holes.
								</p>
								<dl class="grid max-w-sm grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs text-text-muted">
									<dt>Thickness</dt>
									<dd class="text-text">{p.thicknessIn} plywood ({p.thicknessMm} mm)</dd>
									<dt>Stock</dt>
									<dd class="text-text">672.4 × 776.4 mm rectangle (26 15/32″ × 30 9/16″)</dd>
									<dt>Tools</dt>
									<dd class="text-text">jigsaw · drill · tape measure</dd>
								</dl>
								<div class="mt-auto pt-1">
									<button
										class="setup-button-primary inline-flex h-9 items-center gap-1.5 px-3 text-sm font-medium"
										onclick={() => (guideOpen = true)}
									>
										<Hammer size={14} /> Open the step-by-step guide
									</button>
								</div>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		</section>
	{/each}
</div>

<Modal bind:open={guideOpen} title="Cutting the top plate by hand" maxW="max-w-4xl">
	<HandCutTopPlateGuide />
</Modal>
