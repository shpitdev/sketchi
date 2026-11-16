export const SKETCHI_WEB_HOME_URL = "https://sketchi.app";
/** The icons site's production origin, for absolute URLs crawlers follow. */
export const ICONS_SITE_URL = "https://icons.sketchi.app";
export const PLAYGROUND_URL = "https://playground.sketchi.app";
export const REPO_URL = "https://github.com/shpitdev/sketchi";

/** The site's link-preview card. */
export const SITE_CARD_PATH = "/card.png";

export const SITE_TITLE = "Sketchi Icons: hand-drawn icons for Excalidraw";

export const SITE_DESCRIPTION =
	"Product icons and logos drawn by hand for Excalidraw. Copy one into a drawing, download its SVG, or add a whole pack to your Excalidraw library.";

export const COMMUNITY_DESCRIPTION =
	"Hand-drawn icons people made with the Sketchi CLI and published. Copy any of them into Excalidraw.";

export const SITE_CARD_ALT =
	"The Sketchi Icons wordmark beside a grid of hand-drawn product icons for Excalidraw.";

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
