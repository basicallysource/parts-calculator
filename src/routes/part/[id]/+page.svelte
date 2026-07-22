<script lang="ts">
	import PartDetail from '$lib/components/PartDetail.svelte';
	import Seo from '$lib/components/Seo.svelte';
	import { colorStore } from '$lib/colors.svelte';
	import { SECTIONS, sectionQty, primaryColorId, type PartVersion } from '$lib/filament';
	import { ChevronLeft, ChevronRight } from 'lucide-svelte';

	// Standalone page for a single printed part — the shareable, unfurlable form of
	// the dashboard modal. Same PartDetail component, rendered under the normal
	// toolbar with a back link + breadcrumb so it reads as a sub-page of the section
	// the part belongs to.
	let { data } = $props();
	const part = $derived(data.part);

	// The section this part sits in on the dashboard — the breadcrumb context. A part
	// can appear in more than one; the first is enough to say "you're inside <group>".
	const section = $derived(SECTIONS.find((s) => sectionQty(part, s.id) > 0) ?? null);

	// Seed the preview to the shared colour choices + newest version, matching the
	// modal. Not URL-synced: the page URL is already the shareable thing.
	let colorId = $state('ash-gray');
	let version = $state<PartVersion | null>(null);
	let seededId: string | null = null;
	$effect(() => {
		if (part && part.id !== seededId) {
			seededId = part.id;
			colorId = primaryColorId(part, colorStore.roles) ?? 'ash-gray';
			version = part.versions?.[part.versions.length - 1] ?? null;
		}
	});
</script>

<Seo title={part.name} description={part.description || undefined} image={part.render} type="article" />

<div class="mx-auto max-w-4xl px-4 py-6 sm:px-6">
	<!-- breadcrumb: back to the dashboard, with the part's section for context -->
	<nav class="mb-3 flex flex-wrap items-center gap-1 text-sm text-text-muted">
		<a href="/" class="inline-flex items-center gap-1 hover:text-text">
			<ChevronLeft size={15} /> 3D printed parts
		</a>
		{#if section}
			<ChevronRight size={13} class="opacity-60" />
			<span>{section.name}</span>
		{/if}
		<ChevronRight size={13} class="opacity-60" />
		<span class="text-text">{part.name}</span>
	</nav>

	<h1 class="mb-4 text-2xl font-bold text-text">{part.name}</h1>

	<div class="setup-card-shell overflow-hidden border">
		<PartDetail {part} bind:colorId bind:version variant="page" />
	</div>
</div>
