import { error } from '@sveltejs/kit';
import { PARTS, getPart } from '$lib/filament';
import type { EntryGenerator, PageLoad } from './$types';

// One prerendered page per part — the whole point of this route: a static URL a
// link-preview crawler can read, carrying the part's own OpenGraph image + name.
// Every part id is known at build time, so we can enumerate them all.
export const prerender = true;

export const entries: EntryGenerator = () => PARTS.map((p) => ({ id: p.id }));

export const load: PageLoad = ({ params }) => {
	const part = getPart(params.id);
	if (!part) error(404, `Unknown part: ${params.id}`);
	return { part };
};
