<script lang="ts">
	import { ArrowLeft, Box, Boxes, Layers3 } from 'lucide-svelte';
	import Badge from '$lib/components/Badge.svelte';
	import Seo from '$lib/components/Seo.svelte';
	import { ASSEMBLIES, CHANGES, PARTS, SECTIONS, type ChangeTargetKind, type Part, type PlannedChange } from '$lib/filament';

	const partNames = new Map(PARTS.map((part) => [part.id, part.name]));
	const assemblyNames = new Map(ASSEMBLIES.map((assembly) => [assembly.id, assembly.name]));
	const sectionNames = new Map(SECTIONS.map((section) => [section.id, section.name]));
	const ordered = [...CHANGES].sort((a, b) => a.priority.localeCompare(b.priority));

	function targetName(kind: ChangeTargetKind, id: string): string {
		return (kind === 'parts' ? partNames : kind === 'assemblies' ? assemblyNames : sectionNames).get(id) ?? id;
	}
	function targetHref(kind: ChangeTargetKind, id: string): string {
		if (kind === 'parts') return `/part/${id}`;
		return kind === 'assemblies' ? `/#assembly-${id}` : `/#section-${id}`;
	}
	function modelsFor(change: PlannedChange): Part[] {
		const ids = new Set(change.targets.parts ?? []);
		for (const assembly of change.targets.assemblies ?? [])
			for (const part of PARTS) if (part.assembly === assembly) ids.add(part.id);
		for (const section of change.targets.sections ?? [])
			for (const part of PARTS) if (section in part.quantities) ids.add(part.id);
		return [...ids].map((id) => PARTS.find((part) => part.id === id)).filter((part): part is Part => !!part);
	}
	const targetLabels: Record<ChangeTargetKind, string> = {
		parts: 'Parts', assemblies: 'Assembly', sections: 'Section'
	};
</script>

<Seo title="Intended Changes — Sorter Parts Calculator" description="Planned improvements to Sorter V2 parts and assemblies, ordered by priority." />

<main class="mx-auto max-w-6xl px-4 py-8 sm:px-6">
	<a href="/" class="mb-5 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:text-primary-hover"><ArrowLeft size={15} /> Printed parts</a>
	<div class="mb-6">
		<h1 class="text-3xl font-bold tracking-tight text-text">Intended Changes</h1>
		<p class="mt-2 max-w-3xl text-sm text-text-muted">Known fixes and planned improvements. P0 comes first, followed by P1 and P2; P3 is a nice-to-have rather than Subject to Change. Click any part thumbnail to inspect its current interactive 3D model.</p>
	</div>

	<div class="overflow-x-auto border border-border bg-surface">
		<table class="w-full min-w-[850px] border-collapse text-sm">
			<thead>
				<tr class="border-b border-border bg-[var(--color-bg)] text-left text-xs uppercase tracking-wider text-text-muted">
					<th class="w-20 px-3 py-2 font-semibold">Priority</th>
					<th class="w-[42%] px-3 py-2 font-semibold">Change</th>
					<th class="px-3 py-2 font-semibold">Affected current parts</th>
				</tr>
			</thead>
			<tbody>
				{#each ordered as change (change.id)}
					{@const models = modelsFor(change)}
					<tr id={change.id} class="scroll-mt-6 border-b border-border align-top last:border-b-0 hover:bg-primary/[0.025]">
						<td class="px-3 py-3">
							<Badge variant={change.priority === 'P0' ? 'danger' : 'warning'}>{change.priority}</Badge>
							{#if change.condition === 'broken'}<div class="mt-1 text-[10px] font-semibold uppercase leading-tight tracking-wide text-danger">Broken feature</div>{/if}
						</td>
						<td class="px-3 py-3">
							<h2 class="font-bold leading-tight text-text">{change.name}</h2>
							<p class="mt-1 text-xs leading-relaxed text-text-muted">{change.description}</p>
							<div class="mt-2 flex flex-wrap gap-x-3 gap-y-1">
								{#each Object.entries(change.targets) as [kind, ids]}
									{@const targetKind = kind as ChangeTargetKind}
									{#each ids ?? [] as id}
										<a href={targetHref(targetKind, id)} class="inline-flex items-center gap-1 text-[11px] text-primary hover:text-primary-hover">
											{#if targetKind === 'parts'}<Box size={11} />{:else if targetKind === 'assemblies'}<Boxes size={11} />{:else}<Layers3 size={11} />{/if}
											<span class="text-text-muted">{targetLabels[targetKind]}:</span> {targetName(targetKind, id)}
										</a>
									{/each}
								{/each}
							</div>
						</td>
						<td class="px-3 py-3">
							<div class="flex flex-wrap gap-2">
								{#each models as part (part.id)}
									<a href="/part/{part.id}" class="group w-20" title="Open current 3D model for {part.name}">
										<span class="flex h-14 w-20 items-center justify-center overflow-hidden border border-border bg-[var(--color-bg)] group-hover:border-primary">
											<img src={part.render} alt={part.name} class="h-full w-full object-contain transition-transform group-hover:scale-105" />
										</span>
										<span class="mt-1 block truncate text-[10px] leading-tight text-text-muted group-hover:text-primary">{part.name}</span>
									</a>
								{/each}
								{#if !models.length}<span class="text-xs italic text-text-muted">No printed model yet</span>{/if}
							</div>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</main>
