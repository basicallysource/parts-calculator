<script lang="ts">
	import './layout.css';

	let { children } = $props();
</script>

<svelte:head><link rel="icon" href="data:," /></svelte:head>
{@render children()}
