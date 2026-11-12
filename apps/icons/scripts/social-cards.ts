/**
 * The icons site's link-preview cards, drawn from the catalog at build time so
 * their counts and marks always match what the pages serve: one for the site,
 * and one per pack with its name, its count and a strip of its marks.
 */
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
	CARD_COLORS,
	CARD_HEIGHT,
	CARD_WIDTH,
	card,
	renderCard,
	text,
	tile,
	wordmark,
	wordmarkWidth,
} from "@sketchi/social-card";

import { recipeSvg } from "../src/lib/pack-preview.js";
import type { PackIcon } from "../src/lib/packs.js";
import { RECIPE_PREVIEW_SIZE } from "../src/lib/recipe-drawing.js";
import { packCardAlt, SITE_CARD_ALT } from "../src/lib/site-meta.js";

const fontDirectory = resolve(import.meta.dirname, "../public/fonts/Excalifont");
let excalifont: Promise<Uint8Array[]> | undefined;
/** Some marks letter a word in Excalifont, as Excalidraw does. */
function marksFonts(): Promise<Uint8Array[]> {
	excalifont ??= (async () => {
		const files = (await readdir(fontDirectory)).filter((file) => file.endsWith(".woff2")).sort();
		return Promise.all(
			files.map(async (file) => new Uint8Array(await readFile(resolve(fontDirectory, file)))),
		);
	})();
	return excalifont;
}

const count = (n: number) => n.toLocaleString("en-US");

/** Tile, wordmark and "Icons", the lockup the site's header shows. */
function lockup(x: number, y: number, height: number): string {
	const tileSize = height * 0.9;
	const markX = x + tileSize + height * 0.2;
	const iconsX = markX + wordmarkWidth(height) + height * 0.25;
	return [
		tile({ x, y: y + (height - tileSize) / 2, size: tileSize }),
		wordmark({ x: markX, y, height }),
		text({
			x: iconsX,
			y: y + height * 0.78,
			lines: ["Icons"],
			size: height * 0.66,
			fill: CARD_COLORS.accentInk,
		}),
	].join("");
}

/** A mark on its own card, as the site's grid shows it. */
function markCell(icon: PackIcon, x: number, y: number, size: number): string {
	const inset = size * 0.14;
	const scale = (size - 2 * inset) / RECIPE_PREVIEW_SIZE;
	return `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${size * 0.14}" fill="${CARD_COLORS.card}" stroke="${CARD_COLORS.line}" stroke-width="2"/><g transform="translate(${x + inset} ${y + inset}) scale(${scale})">${recipeSvg(icon.recipe, { ink: "#1e1e1e", paper: CARD_COLORS.card })}</g>`;
}

/** The site's card: what the catalog is, how many marks it draws, and twelve of them. */
export async function siteCard({
	icons,
	packs,
	marks,
}: {
	icons: number;
	packs: number;
	marks: readonly PackIcon[];
}): Promise<Uint8Array> {
	const columns = 4;
	const size = 122;
	const gap = 14;
	const gridWidth = columns * size + (columns - 1) * gap;
	const rows = Math.ceil(marks.length / columns);
	const gridX = CARD_WIDTH - 52 - gridWidth;
	const gridY = (CARD_HEIGHT - (rows * size + (rows - 1) * gap)) / 2;
	const grid = marks.map((icon, index) =>
		markCell(
			icon,
			gridX + (index % columns) * (size + gap),
			gridY + Math.floor(index / columns) * (size + gap),
			size,
		),
	);
	const body = [
		lockup(72, 70, 72),
		text({ x: 72, y: 296, lines: ["Hand-drawn icons", "for Excalidraw"], size: 52 }),
		text({
			x: 72,
			y: 428,
			lines: [
				`${count(icons)} product icons and logos in ${count(packs)} packs.`,
				"Copy one into Excalidraw, or add a",
				"whole pack to your library.",
			],
			size: 25,
			weight: 500,
			fill: CARD_COLORS.ink2,
			lineHeight: 1.36,
		}),
		text({ x: 72, y: 572, lines: ["icons.sketchi.app"], size: 26, fill: CARD_COLORS.accentInk }),
		...grid,
	].join("");
	return renderCard(card(body, { title: SITE_CARD_ALT }), { fonts: await marksFonts() });
}

/** A pack's card: its name, how many marks it holds, and a strip of them. */
export async function packCard({
	id,
	name,
	icons,
	marks,
}: {
	id: string;
	name: string;
	icons: number;
	marks: readonly PackIcon[];
}): Promise<Uint8Array> {
	const size = 150;
	const gap = 22;
	const shown = marks.slice(0, 6);
	const stripWidth = shown.length * size + (shown.length - 1) * gap;
	const stripX = (CARD_WIDTH - stripWidth) / 2;
	const body = [
		lockup(72, 54, 56),
		text({ x: 72, y: 246, lines: [name], size: 76 }),
		text({
			x: 72,
			y: 304,
			lines: [`${count(icons)} hand-drawn icons for Excalidraw`],
			size: 32,
			weight: 500,
			fill: CARD_COLORS.ink2,
		}),
		...shown.map((icon, index) => markCell(icon, stripX + index * (size + gap), 380, size)),
		text({ x: 72, y: 592, lines: ["icons.sketchi.app"], size: 24, fill: CARD_COLORS.accentInk }),
	].join("");
	return renderCard(card(body, { title: packCardAlt({ id, name }) }), {
		fonts: await marksFonts(),
	});
}
