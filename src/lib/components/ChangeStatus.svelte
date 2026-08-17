<script lang="ts">
	import { AlertTriangle, RefreshCw } from 'lucide-svelte';
	import Badge from './Badge.svelte';
	import Popover from './Popover.svelte';
	import { plannedChangesFor, type ChangeTargetKind } from '$lib/filament';

	let { kind, id, name }: { kind: ChangeTargetKind; id: string; name: string } = $props();
	const changes = $derived(plannedChangesFor(kind, id));
	const priority = $derived(changes.map((change) => change.priority).sort()[0] ?? 'P2');
	const hasBrokenFeature = $derived(changes.some((change) => change.condition === 'broken'));
</script>

{#if changes.length}
<Popover width="w-80" label="Why {name} is subject to change">
	{#snippet trigger({ toggle, open })}
		<Badge as="button" variant="warning" onclick={toggle} aria-expanded={open}>
			<RefreshCw size={11} /> Subject to Change · {priority}
		</Badge>
	{/snippet}
	<div class="flex items-start gap-2">
		<AlertTriangle size={14} class="mt-0.5 shrink-0 text-warning-dark" />
		<div>
			<b class="text-text">{hasBrokenFeature ? 'This design has a broken feature that is intended to be fixed.' : 'Works now, but is intended to be replaced shortly with an improvement.'}</b>
			<p class="mt-1"><b>{priority}</b> priority — {priority === 'P0' ? 'do this before lower-priority changes.' : priority === 'P1' ? 'do this after P0 changes.' : 'lower priority.'}</p>
		</div>
	</div>
	{#each changes as change}
		<div class="mt-2 border-t border-border pt-2 text-text">
			<Badge variant="info">{change.priority}</Badge>
			<a class="ml-1 font-semibold text-primary hover:text-primary-hover" href="/changes#{change.id}">{change.name}</a>
			<p class="mt-1">{change.description}</p>
		</div>
	{/each}
</Popover>
{/if}
