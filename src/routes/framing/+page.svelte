<script lang="ts">
	import ExtrusionScene from '$lib/components/ExtrusionScene.svelte';
	import LayerControl from '$lib/components/LayerControl.svelte';
	import CutPlan from '$lib/components/CutPlan.svelte';
</script>

<svelte:head><title>Sorter Parts Calculator — Aluminium framing</title></svelte:head>

<div class="mx-auto max-w-6xl px-4 py-8 sm:px-6">
	<header class="mb-5">
		<h1 class="text-2xl font-bold text-text">Aluminium framing</h1>
		<p class="mt-1 text-sm text-text-muted">
			2020 T-slot extrusion, cut from 1 m bars. Below is the piece family at a glance, then a cut
			plan that packs the pieces into bars with the least waste.
		</p>
	</header>

	<section class="mb-6">
		<LayerControl />
	</section>

	<section class="mb-8">
		<ExtrusionScene />
	</section>

	<section>
		<h2 class="mb-3 text-base font-semibold text-text">Cut plan</h2>
		<CutPlan />
	</section>
</div>
