<script lang="ts">
	import { page } from '$app/state';
	import { SITE_NAME, DEFAULT_DESCRIPTION, DEFAULT_OG_IMAGE, absUrl, pageTitle } from '$lib/seo';

	// One place that emits every head tag a link preview needs. Each route renders
	// <Seo …/> with whatever it knows about the page; anything omitted falls back to
	// the site defaults, so every page still ships a complete, crawlable card.
	let {
		title,
		description = DEFAULT_DESCRIPTION,
		image = DEFAULT_OG_IMAGE,
		type = 'website'
	}: {
		title?: string;
		description?: string;
		image?: string;
		type?: string;
	} = $props();

	const fullTitle = $derived(pageTitle(title));
	// pathname (not href): the canonical URL never carries the modal's ?part=… state
	const canonical = $derived(absUrl(page.url.pathname));
	const ogImage = $derived(absUrl(image));
</script>

<svelte:head>
	<title>{fullTitle}</title>
	<meta name="description" content={description} />
	<link rel="canonical" href={canonical} />

	<meta property="og:site_name" content={SITE_NAME} />
	<meta property="og:title" content={fullTitle} />
	<meta property="og:description" content={description} />
	<meta property="og:type" content={type} />
	<meta property="og:url" content={canonical} />
	<meta property="og:image" content={ogImage} />

	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content={fullTitle} />
	<meta name="twitter:description" content={description} />
	<meta name="twitter:image" content={ogImage} />
</svelte:head>
