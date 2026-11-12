/**
 * Link-preview cards for Sketchi's sites: the 1200 by 630 images Slack, X,
 * iMessage and other crawlers show for a shared link. This package owns the
 * brand pieces every card shares (the paper, the tile, the hand-written
 * wordmark and the site's typeface) and renders a finished card to PNG. Each
 * app composes its own card from these and writes it at build time.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { initWasm, Resvg } from "@resvg/resvg-wasm";
import {
	WORDMARK_HEIGHT,
	WORDMARK_PATH,
	WORDMARK_WIDTH,
} from "@sketchi/ui/components/sketchi-wordmark-ink";

import { TILE_PATHS } from "./tile.js";

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;

/** The site's light palette (packages/diagram/ui/src/theme.css). */
export const CARD_COLORS = {
	paper: "#f6f1e7",
	card: "#fffdf8",
	ink: "#1a1712",
	ink2: "#4c4639",
	line: "#e7ddc9",
	accent: "#8f707f",
	accentInk: "#6a4e5c",
} as const;

/** The site's typeface, Hanken Grotesk, in the weights cards use. */
export const CARD_FONT = "Hanken Grotesk";

export function escapeXml(text: string): string {
	return text.replace(/[<>&"']/gu, (character) => `&#${character.codePointAt(0)};`);
}

/** The Sketchi tile at (x, y), `size` units square, with the site's rounded corners. */
export function tile({ x, y, size }: { x: number; y: number; size: number }): string {
	const radius = (7 / 30) * 1024;
	const paths = TILE_PATHS.map(({ d, fill }) => `<path fill="${fill}" d="${d}"/>`).join("");
	return `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 1024 1024"><clipPath id="tile-corners"><rect width="1024" height="1024" rx="${radius}"/></clipPath><g clip-path="url(#tile-corners)">${paths}</g></svg>`;
}

/** The width of the wordmark when drawn `height` units tall. */
export function wordmarkWidth(height: number): number {
	return (height * WORDMARK_WIDTH) / WORDMARK_HEIGHT;
}

/** The hand-written wordmark with its top-left corner at (x, y). */
export function wordmark({
	x,
	y,
	height,
	fill = CARD_COLORS.ink,
}: {
	x: number;
	y: number;
	height: number;
	fill?: string;
}): string {
	return `<svg x="${x}" y="${y}" width="${wordmarkWidth(height)}" height="${height}" viewBox="0 0 ${WORDMARK_WIDTH} ${WORDMARK_HEIGHT}"><path fill="${fill}" d="${WORDMARK_PATH}"/></svg>`;
}

/** Lines of text set in the site's typeface, the first baseline at `y`. */
export function text({
	x,
	y,
	lines,
	size,
	weight = 700,
	fill = CARD_COLORS.ink,
	lineHeight = 1.15,
}: {
	x: number;
	y: number;
	lines: readonly string[];
	size: number;
	weight?: 500 | 700;
	fill?: string;
	lineHeight?: number;
}): string {
	return lines
		.map(
			(line, index) =>
				`<text x="${x}" y="${y + index * size * lineHeight}" font-family="${CARD_FONT}" font-weight="${weight}" font-size="${size}" fill="${fill}">${escapeXml(line)}</text>`,
		)
		.join("");
}

/** A whole card: the site's paper with its faint dot grid, then `body` on top. */
export function card(body: string, { title }: { title: string }): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}"><title>${escapeXml(title)}</title><defs><pattern id="paper-dots" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="${CARD_COLORS.ink}" opacity="0.06"/></pattern></defs><rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="${CARD_COLORS.paper}"/><rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="url(#paper-dots)"/>${body}</svg>`;
}

const require = createRequire(import.meta.url);

let ready: Promise<Uint8Array[]> | undefined;
function siteFonts(): Promise<Uint8Array[]> {
	ready ??= (async () => {
		try {
			await initWasm(readFileSync(require.resolve("@resvg/resvg-wasm/index_bg.wasm")));
		} catch (error) {
			// Another module in this process (a pack preview, say) loaded it first.
			if (!String(error).includes("Already initialized")) throw error;
		}
		return [500, 700].map(
			(weight) =>
				new Uint8Array(
					readFileSync(
						require.resolve(
							`@fontsource/hanken-grotesk/files/hanken-grotesk-latin-${weight}-normal.woff2`,
						),
					),
				),
		);
	})();
	return ready;
}

/**
 * Renders a card's SVG to PNG at its own size. `fonts` adds faces the card's
 * other text uses, such as Excalifont in a drawn icon.
 */
export async function renderCard(
	svg: string,
	{ fonts = [] }: { fonts?: readonly Uint8Array[] } = {},
): Promise<Uint8Array> {
	const rasterizer = new Resvg(svg, {
		font: { defaultFontFamily: CARD_FONT, fontBuffers: [...(await siteFonts()), ...fonts] },
		shapeRendering: 2,
		textRendering: 2,
	});
	try {
		const rendered = rasterizer.render();
		try {
			return Uint8Array.from(rendered.asPng());
		} finally {
			rendered.free();
		}
	} finally {
		rasterizer.free();
	}
}
