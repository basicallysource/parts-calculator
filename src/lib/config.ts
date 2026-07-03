/**
 * Browser-persisted user configuration. The page mirrors its reactive state into
 * here on change and reloads it at boot, so a refresh keeps your build setup.
 */
import { browser } from '$app/environment';

export const CONFIG_KEY = 'sorter-filament-config-v1';

// Note: layer configuration lives in layers.svelte.ts (shared across tabs), not here.
export type StoredConfig = {
	roleColors: Record<string, string>;
	printBins: boolean;
	surplus: number;
	selected: Record<string, boolean>;
	inclSupport: Record<string, boolean>;
};

export function loadConfig(): Partial<StoredConfig> | null {
	if (!browser) return null;
	try {
		const raw = localStorage.getItem(CONFIG_KEY);
		return raw ? (JSON.parse(raw) as Partial<StoredConfig>) : null;
	} catch {
		return null;
	}
}

export function saveConfig(c: StoredConfig): void {
	if (!browser) return;
	try {
		localStorage.setItem(CONFIG_KEY, JSON.stringify(c));
	} catch {
		/* storage full / disabled — ignore */
	}
}

export function clearConfig(): void {
	if (!browser) return;
	try {
		localStorage.removeItem(CONFIG_KEY);
	} catch {
		/* ignore */
	}
}
