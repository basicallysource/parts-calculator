<script lang="ts">
	import { ExternalLink } from 'lucide-svelte';
	import DownloadButton from '$lib/components/DownloadButton.svelte';
	import { LASER_CUT_PARTS, type LaserCutPart } from '$lib/lasercut';
	import { fmtDate } from '$lib/filament';

	// group by assembly (parts without one stand alone), preserving list order
	const groups: { assembly?: string; parts: LaserCutPart[] }[] = [];
	for (const p of LASER_CUT_PARTS) {
		const last = groups[groups.length - 1];
		if (p.assembly && last?.assembly === p.assembly) last.parts.push(p);
		else groups.push({ assembly: p.assembly, parts: [p] });
	}
</script>

<svelte:head><title>Sorter Parts Calculator — Laser cut parts</title></svelte:head>

<div class="mx-auto max-w-6xl px-4 py-8 sm:px-6">
	<header class="mb-5">
		<h1 class="text-2xl font-bold text-text">Laser cut parts</h1>
		<p class="mt-1 text-sm text-text-muted">
			Flat plywood parts, cut from the DXFs below. Thicknesses are quoted in the imperial size the
			sheet is sold as, with the nearest full-mm equivalent the CAD expects.
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
						<div class="flex flex-1 flex-col gap-2 px-4 py-3">
							<div class="flex items-baseline justify-between gap-2">
								<h3 class="text-sm font-semibold text-text">{p.name}</h3>
								<span class="text-xs text-text-muted">{p.qty} needed</span>
							</div>
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
						</div>
					</div>
				{/each}
			</div>
		</section>
	{/each}
</div>
