import { getIconSourcePath } from "@sketchi/icon-catalog/catalog";
import type { SketchiIcon } from "@sketchi/icon-catalog";

export type IconSourceLoader = (request: Request, icon: SketchiIcon) => Promise<string>;

export interface IconAssetsBinding {
	fetch(input: Request | URL | string, init?: RequestInit): Promise<Response>;
}

export function createIconSourceLoader(assets: IconAssetsBinding): IconSourceLoader {
	return async (request, icon) => {
		const sourcePath = getIconSourcePath(icon.slug);
		if (!sourcePath) {
			throw new Error(`Source path not found for ${icon.slug}.`);
		}
		const response = await assets.fetch(new URL(sourcePath, request.url));
		if (!response.ok) {
			throw new Error(`Icon source returned HTTP ${response.status}.`);
		}
		return response.text();
	};
}
