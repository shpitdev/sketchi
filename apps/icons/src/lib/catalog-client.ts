import { decodeIconManifest, type IconManifest } from "@sketchi/icon-catalog";

import { decodeDrawings, DRAWINGS_PATH, type IconDrawings } from "./drawings.js";

export async function loadIconManifest(signal: AbortSignal): Promise<IconManifest> {
	// Revalidate: a manifest cached before a deploy may predate fields this page reads.
	const response = await fetch("/icons-manifest.json", { cache: "no-cache", signal });
	if (!response.ok) {
		throw new Error(`Icon library returned HTTP ${response.status}.`);
	}
	const payload: unknown = await response.json();
	return decodeIconManifest(payload);
}

export async function loadDrawings(signal: AbortSignal): Promise<IconDrawings> {
	const response = await fetch(DRAWINGS_PATH, { cache: "no-cache", signal });
	if (!response.ok) throw new Error(`Drawings returned HTTP ${response.status}.`);
	return decodeDrawings(await response.json());
}
