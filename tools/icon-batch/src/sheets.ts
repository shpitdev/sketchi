import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { svgPng, initializeResvg } from "./excalidraw-export.js";
import { prepareSvg } from "./imaging.js";
import { type MarkRecord, recordCost, type RunStore } from "./store.js";

/** Marks per sheet: enough to scan hundreds quickly, few enough to read each. */
export const SHEET_COLUMNS = 4;
export const SHEET_ROWS = 8;

const CELL_WIDTH = 330;
const CELL_HEIGHT = 178;
const LABEL_HEIGHT = 40;
const SOURCE_SIZE = 112;
/** The previews carry the service's export padding: 8 around 112, 4 around 28. */
const LARGE_FRAME = 128;
const SMALL_FRAME = 36;
const GAP = 12;
/** Sheets rasterize at twice their units, so each preview shows at its own pixels. */
const SHEET_SCALE = 2;

function escapeXml(text: string): string {
	return text.replace(/[<>&"']/gu, (character) => `&#${character.codePointAt(0)};`);
}

function image(x: number, y: number, size: number, png: string): string {
	return `<image x="${x}" y="${y}" width="${size}" height="${size}" href="data:image/png;base64,${png}"/>`;
}

function text(x: number, y: number, value: string, size: number, color = "#1e1e1e"): string {
	return `<text x="${x}" y="${y}" font-family="Excalifont" font-size="${size}" fill="${color}">${escapeXml(value)}</text>`;
}

/** One line on what happened to a mark. */
export function verdictLine(record: MarkRecord): string {
	const chosen = record.chosen === undefined ? undefined : record.attempts[record.chosen];
	if (record.status === "failed" || !chosen) {
		const error = record.attempts.at(-1)?.error;
		return `failed: ${error?.tag ?? "no drawing"}`;
	}
	const author = (chosen.author ?? "unknown").replace("anthropic/claude-", "");
	const parts = chosen.recipe?.parts.length ?? 0;
	const verdict =
		record.status === "recognized"
			? "recognized"
			: `judge picked ${chosen.judge?.picked ?? "nothing"}`;
	return `${verdict} | ${author} r${chosen.rounds ?? 0} ${parts}p $${recordCost(record).toFixed(3)}`;
}

async function cell(
	record: MarkRecord,
	store: RunStore,
	sourceSvg: string | undefined,
	x: number,
	y: number,
) {
	const pieces = [
		`<rect x="${x + 2}" y="${y + 2}" width="${CELL_WIDTH - 4}" height="${CELL_HEIGHT - 4}" fill="none" stroke="#dddddd"/>`,
		text(x + 10, y + 18, `${record.slug}`, 15),
		text(
			x + 10,
			y + 34,
			verdictLine(record),
			11,
			record.status === "recognized" ? "#2f7d32" : "#c62828",
		),
	];
	const top = y + LABEL_HEIGHT;
	if (sourceSvg) {
		const source = prepareSvg({
			id: "sheet",
			source: { kind: "svg", svg: sourceSvg, colors: [] },
			size: SOURCE_SIZE * SHEET_SCALE,
			quantize: false,
		});
		if (source) pieces.push(image(x + 10, top + 8, SOURCE_SIZE, source.png));
	}
	if (record.chosen !== undefined) {
		const large = store.previewPath(record.slug, record.chosen, 112);
		const small = store.previewPath(record.slug, record.chosen, 28);
		if (existsSync(large)) {
			pieces.push(
				image(
					x + 10 + SOURCE_SIZE + GAP,
					top,
					LARGE_FRAME,
					(await readFile(large)).toString("base64"),
				),
			);
		}
		if (existsSync(small)) {
			pieces.push(
				image(
					x + 10 + SOURCE_SIZE + GAP + LARGE_FRAME + GAP,
					top + (LARGE_FRAME - SMALL_FRAME) / 2,
					SMALL_FRAME,
					(await readFile(small)).toString("base64"),
				),
			);
		}
	}
	return pieces.join("");
}

/**
 * Contact sheets for review: each mark's source, its drawing at four times
 * node size and at node size, with the judge's verdict. Recognized marks (the
 * ones promotion would add) and the rest go on separate sheets.
 */
export async function writeSheets(
	store: RunStore,
	loadSvg: (slug: string) => Promise<string | undefined>,
	outDir: string,
): Promise<string[]> {
	await initializeResvg();
	await mkdir(outDir, { recursive: true });
	const records = (await store.records()).filter((record) => record.status !== undefined);
	const groups: ReadonlyArray<readonly [string, MarkRecord[]]> = [
		["recognized", records.filter((record) => record.status === "recognized")],
		["review", records.filter((record) => record.status !== "recognized")],
	];
	const perSheet = SHEET_COLUMNS * SHEET_ROWS;
	const written: string[] = [];
	for (const [label, group] of groups) {
		for (let start = 0; start < group.length; start += perSheet) {
			const page = group.slice(start, start + perSheet);
			const rows = Math.ceil(page.length / SHEET_COLUMNS);
			const width = SHEET_COLUMNS * CELL_WIDTH;
			const height = rows * CELL_HEIGHT;
			const cells: string[] = [];
			for (const [index, record] of page.entries()) {
				cells.push(
					await cell(
						record,
						store,
						await loadSvg(record.slug),
						(index % SHEET_COLUMNS) * CELL_WIDTH,
						Math.floor(index / SHEET_COLUMNS) * CELL_HEIGHT,
					),
				);
			}
			const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width * SHEET_SCALE}" height="${height * SHEET_SCALE}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#ffffff"/>${cells.join("")}</svg>`;
			const path = join(outDir, `${label}-${String(start / perSheet + 1).padStart(2, "0")}.png`);
			await writeFile(path, svgPng(svg));
			written.push(path);
		}
	}
	return written;
}
