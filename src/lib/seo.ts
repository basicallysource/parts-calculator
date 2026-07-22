// Central SEO / OpenGraph config. Link-preview crawlers (Slack, iMessage,
// Discord, X, Facebook) don't run JavaScript and reject relative og:image /
// canonical URLs, so everything resolves against SITE_URL — the production
// origin, baked into the prerendered HTML at build time.

export const SITE_URL = 'https://parts-calculator.basically.website';
export const SITE_NAME = 'Sorter Parts Calculator';

export const DEFAULT_DESCRIPTION =
	'Configure a Sorter V2 build and get exactly what to print and buy: ' +
	'per-colour filament quantities from real sliced weights, plus downloadable STLs.';

// Placeholder hero card. Swap for a dedicated 1200×630 image when one exists;
// the per-part pages already carry the part's own render as their og:image.
export const DEFAULT_OG_IMAGE = '/renders/classification-dome.png';

/** Absolutise a site-relative path; pass through an already-absolute URL. */
export function absUrl(pathOrUrl: string): string {
	if (/^https?:\/\//.test(pathOrUrl)) return pathOrUrl;
	return SITE_URL + (pathOrUrl.startsWith('/') ? '' : '/') + pathOrUrl;
}

/** "<page> — Sorter Parts Calculator", or just the site name for the home page. */
export function pageTitle(title?: string): string {
	return title && title !== SITE_NAME ? `${title} — ${SITE_NAME}` : SITE_NAME;
}
