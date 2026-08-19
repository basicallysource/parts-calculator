<script lang="ts">
	// A small blue "A" tag marking a part that has an interchangeable alternative
	// (e.g. socket vs button head — either works). Mirrors the docs' red "!"
	// "not in the parts calculator" marker: same 18px footprint, "A" for
	// "alternative" (blue) instead of "!" for warning (red). "A" rather than "i"
	// so it doesn't read as a generic "more info" icon. A bare `true` reads
	// "Alternative"; a string says what the alternative is.
	let { value }: { value?: string | boolean | null } = $props();
	const label = $derived(typeof value === 'string' && value.trim() ? value : 'Alternative');
</script>

{#if value}
	<span
		class="inline-flex h-[18px] min-w-[18px] shrink-0 cursor-help items-center justify-center px-1 text-[0.72rem] font-bold leading-none text-white"
		style="background: var(--color-info)"
		title={label}
		aria-label={label}
	>A</span>
{/if}
