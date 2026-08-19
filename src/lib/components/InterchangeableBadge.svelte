<script lang="ts">
	// A small blue "i" tag marking a part that is interchangeable with another
	// (e.g. socket vs button head — either works). Mirrors the docs' red "!"
	// "not in the parts calculator" marker: same 18px footprint, info (blue)
	// instead of warning (red). The meaning lives in the hover text: a bare
	// `true` reads "Interchangeable", a string says what it swaps with.
	let { value }: { value?: string | boolean | null } = $props();
	const label = $derived(typeof value === 'string' && value.trim() ? value : 'Interchangeable');
</script>

{#if value}
	<span
		class="inline-flex h-[18px] min-w-[18px] shrink-0 cursor-help items-center justify-center px-1 text-[0.72rem] font-bold leading-none text-white"
		style="background: var(--color-info)"
		title={label}
		aria-label={label}
	>i</span>
{/if}
