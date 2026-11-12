/**
 * Writes sketchi.app's link-preview card, public/media/sketchi-card.png.
 *
 * The diagram on the card is real Sketchi output: sketchi-card.excalidraw came
 * from `sketchi generate`, and sketchi-card-diagram.png is Excalidraw's own PNG
 * export of it (`sketchi export <id> --format png`). Re-export that PNG if you
 * replace the diagram, then run `pnpm nx run web:social-card`.
 */
import { readFileSync, writeFileSync } from "node:fs";
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
} from "@sketchi/social-card";

import { OG_IMAGE } from "../src/lib/site-meta.js";

const media = resolve(import.meta.dirname, "../public/media");
const diagram = readFileSync(resolve(media, "sketchi-card-diagram.png"));
const { width, height } = pngSize(diagram);

// The diagram sits on its own sheet at the right, as tall as the card allows.
const margin = 30;
const sheetPadding = 14;
const drawnHeight = CARD_HEIGHT - 2 * (margin + sheetPadding);
const drawnWidth = (width / height) * drawnHeight;
const sheetWidth = drawnWidth + 2 * sheetPadding;
const sheetX = CARD_WIDTH - margin - sheetWidth;

const body = [
	`<rect x="${sheetX}" y="${margin}" width="${sheetWidth}" height="${CARD_HEIGHT - 2 * margin}" rx="22" fill="${CARD_COLORS.card}" stroke="${CARD_COLORS.line}" stroke-width="2"/>`,
	`<image x="${sheetX + sheetPadding}" y="${margin + sheetPadding}" width="${drawnWidth}" height="${drawnHeight}" href="data:image/png;base64,${diagram.toString("base64")}"/>`,
	tile({ x: 72, y: 80, size: 76 }),
	wordmark({ x: 166, y: 76, height: 84 }),
	text({ x: 72, y: 300, lines: ["Excalidraw diagrams", "from a description"], size: 54 }),
	text({
		x: 72,
		y: 432,
		lines: ["Flowcharts, architecture and sequences,", "drawn with product logos, ready to edit."],
		size: 26,
		weight: 500,
		fill: CARD_COLORS.ink2,
		lineHeight: 1.35,
	}),
	text({ x: 72, y: 556, lines: ["sketchi.app"], size: 28, fill: CARD_COLORS.accentInk }),
].join("");

writeFileSync(
	resolve(media, "sketchi-card.png"),
	await renderCard(card(body, { title: OG_IMAGE.alt })),
);

function pngSize(png: Buffer): { width: number; height: number } {
	return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}
