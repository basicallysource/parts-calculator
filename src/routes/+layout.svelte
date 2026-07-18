<script lang="ts">
	import './layout.css';
	import { page } from '$app/stores';
	import { ExternalLink } from 'lucide-svelte';

	let { children } = $props();

	const tabs = [
		{ href: '/', label: '3D printed parts' },
		{ href: '/framing', label: 'Aluminium framing' },
		{ href: '/lasercut', label: 'Laser cut parts' },
		{ href: '/hardware', label: 'Hardware' },
		{ href: '/assembly', label: 'Machine assembly' }
	];

	const isActive = (href: string) =>
		href === '/' ? $page.url.pathname === '/' : $page.url.pathname.startsWith(href);
</script>

<svelte:head><link rel="icon" href="/favicon.ico" /></svelte:head>

<header class="border-b border-border bg-surface">
	<div class="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
		<a href="/" class="flex items-center gap-2 text-lg font-bold tracking-tight text-text">
			<img src="/basically-logo.svg" alt="basically" class="h-5 w-auto" />
			Sorter Parts Calculator
		</a>

		<nav class="flex items-center gap-1">
			{#each tabs as tab (tab.href)}
				<a
					href={tab.href}
					class="border-b-2 px-3 py-2 text-sm font-semibold transition-colors {isActive(tab.href)
						? 'border-primary text-text'
						: 'border-transparent text-text-muted hover:text-text'}"
				>
					{tab.label}
				</a>
			{/each}
		</nav>

		<!-- external tool: visually separated from the in-app tabs -->
		<a
			href="https://bin-gen.basically.website/"
			target="_blank"
			rel="noopener"
			class="ml-auto inline-flex items-center gap-1.5 border border-border bg-[var(--color-bg)] px-3 py-1.5 text-sm text-text-muted transition-colors hover:border-primary hover:text-primary"
		>
			Laser Cut Bin Generator <ExternalLink size={13} />
		</a>
	</div>
</header>

{@render children()}
