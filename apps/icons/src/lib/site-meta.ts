import { ICONS_SITE_URL } from "./home-url.js";
import { ALL_ICONS_PACK_ID, findPack, packCardPath, SITE_CARD_PATH } from "./packs.js";

export const SITE_TITLE = "Sketchi Icons: hand-drawn icons for Excalidraw";

export const SITE_DESCRIPTION =
	"Product icons and logos drawn by hand for Excalidraw. Copy one into a drawing, download its SVG, or add a whole pack to your Excalidraw library.";

export const COMMUNITY_DESCRIPTION =
	"Hand-drawn icons people made with the Sketchi CLI and published. Copy any of them into Excalidraw.";

export const SITE_CARD_ALT =
	"The Sketchi Icons wordmark beside a grid of hand-drawn product icons for Excalidraw.";

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

type MetaTag =
	| { title: string }
	| { name: string; content: string }
	| { property: string; content: string };

/**
 * A page's title, description and link-preview tags. Crawlers need absolute
 * URLs, so the image and page URLs name the production host.
 */
export function pageMeta({
	title,
	description,
	path,
	image,
}: {
	title: string;
	description: string;
	path: string;
	image?: { path: string; alt: string };
}): MetaTag[] {
	const meta: MetaTag[] = [
		{ title },
		{ name: "description", content: description },
		{ property: "og:title", content: title },
		{ property: "og:description", content: description },
		{ property: "og:url", content: `${ICONS_SITE_URL}${path}` },
		{ name: "twitter:title", content: title },
		{ name: "twitter:description", content: description },
	];
	if (image) {
		const url = `${ICONS_SITE_URL}${image.path}`;
		meta.push(
			{ property: "og:image", content: url },
			{ property: "og:image:type", content: "image/png" },
			{ property: "og:image:width", content: "1200" },
			{ property: "og:image:height", content: "630" },
			{ property: "og:image:alt", content: image.alt },
			{ name: "twitter:card", content: "summary_large_image" },
			{ name: "twitter:image", content: url },
			{ name: "twitter:image:alt", content: image.alt },
		);
	}
	return meta;
}

export const SITE_IMAGE = { path: SITE_CARD_PATH, alt: SITE_CARD_ALT };

export function packImage(pack: { id: string; name: string }) {
	return { path: packCardPath(pack.id), alt: packCardAlt(pack) };
}
