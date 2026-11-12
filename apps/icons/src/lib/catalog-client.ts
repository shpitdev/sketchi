import { decodeIconManifest, type IconManifest } from "@sketchi/icon-catalog";

import { decodeDrawings, DRAWINGS_PATH, type IconDrawings } from "./drawings.js";
import { decodePackIcons, packIconsPath, type PackIcon } from "./packs.js";

/** A published JSON file, revalidated: a copy cached before a deploy may predate fields a page reads. */
async function loadPublished(path: string, what: string, signal: AbortSignal): Promise<unknown> {
	const response = await fetch(path, { cache: "no-cache", signal });
	if (!response.ok) throw new Error(`${what} returned HTTP ${response.status}.`);
	return response.json();
}

export function loadIconManifest(signal: AbortSignal): Promise<IconManifest> {
	return loadPublished("/icons-manifest.json", "Icon library", signal).then(decodeIconManifest);
}

export function loadDrawings(signal: AbortSignal): Promise<IconDrawings> {
	return loadPublished(DRAWINGS_PATH, "Drawings", signal).then(decodeDrawings);
}

/** One pack's drawn marks: a pack page loads these, not the whole catalog. */
export function loadPackIcons(id: string, signal: AbortSignal): Promise<PackIcon[]> {
	return loadPublished(packIconsPath(id), "Pack icons", signal).then(decodePackIcons);
}
