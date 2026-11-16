import { ALL_ICONS_PACK_ID, findPack, packCardPath } from "./packs";

export function packCardAlt({ id, name }: { id: string; name: string }): string {
	return id === ALL_ICONS_PACK_ID
		? "Every hand-drawn icon on Sketchi Icons as one pack, with a strip of them."
		: `The ${name} pack on Sketchi Icons, with a strip of its hand-drawn icons.`;
}

/**
 * A pack's description: its count from the build, then the sentence its
 * Excalidraw listing uses, e.g. "93 hand-drawn icons for Palantir's platforms…".
 */
export function packDescription({ id, count }: { id: string; count: number }): string {
	const total = count.toLocaleString("en-US");
	const listing = findPack(id)?.excalidrawListing?.description;
	if (id === ALL_ICONS_PACK_ID || !listing) {
		return `All ${total} hand-drawn icons and logos on Sketchi Icons, as one Excalidraw library to download.`;
	}
	return `${total} ${listing.charAt(0).toLowerCase()}${listing.slice(1)}`;
}

export function packImage(pack: { id: string; name: string }) {
	return { path: packCardPath(pack.id), alt: packCardAlt(pack) };
}
