import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { IconRecipe } from "@sketchi/diagram-core";
import { LARGE_ICON_SIZE, NODE_ICON_SIZE, previewScene } from "@sketchi/icon-draw";

import { exportScenePng, initializeResvg, svgPng } from "./excalidraw-export.js";
import { prepareSvg } from "./imaging.js";
import { SHEET_COLUMNS, SHEET_ROWS } from "./sheets.js";

const CELL_WIDTH = 330;
const CELL_HEIGHT = 178;
const LABEL_HEIGHT = 40;
const SOURCE_SIZE = 112;
const LARGE_FRAME = 128;
const SMALL_FRAME = 36;
const GAP = 12;
const SHEET_SCALE = 2;

export type SheetTheme = "light" | "dark";

const GROUND: Record<SheetTheme, { paper: string; ink: string; muted: string; rule: string }> = {
	light: { paper: "#ffffff", ink: "#1e1e1e", muted: "#6b6b6b", rule: "#dddddd" },
	// Excalidraw's dark canvas.
	dark: { paper: "#121212", ink: "#e3e3e3", muted: "#9a9a9a", rule: "#3a3a3a" },
};

export interface RecipeSheetMark {
	readonly slug: string;
	readonly name: string;
	readonly svg: string | undefined;
	readonly recipe: IconRecipe;
}

function escapeXml(text: string): string {
	return text.replace(/[<>&"']/gu, (character) => `&#${character.codePointAt(0)};`);
}

function image(x: number, y: number, size: number, png: string): string {
	return `<image x="${x}" y="${y}" width="${size}" height="${size}" href="data:image/png;base64,${png}"/>`;
}

function text(x: number, y: number, value: string, size: number, color: string): string {
	return `<text x="${x}" y="${y}" font-family="Excalifont" font-size="${size}" fill="${color}">${escapeXml(value)}</text>`;
}

const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

async function cell(mark: RecipeSheetMark, theme: SheetTheme, x: number, y: number) {
	const ground = GROUND[theme];
	const pieces = [
		`<rect x="${x + 2}" y="${y + 2}" width="${CELL_WIDTH - 4}" height="${CELL_HEIGHT - 4}" fill="none" stroke="${ground.rule}"/>`,
		text(x + 10, y + 18, mark.slug, 15, ground.ink),
		text(x + 10, y + 34, `${mark.name} | ${mark.recipe.parts.length} parts`, 11, ground.muted),
	];
	const top = y + LABEL_HEIGHT;
	if (mark.svg) {
		const source = prepareSvg({
			id: "sheet",
			source: { kind: "svg", svg: mark.svg, colors: [] },
			size: SOURCE_SIZE * SHEET_SCALE,
			quantize: false,
		});
		if (source) pieces.push(image(x + 10, top + 8, SOURCE_SIZE, source.png));
	}
	// Excalidraw's dark theme inverts a light scene, so the export starts on white either way.
	const exportOptions = { backgroundColor: GROUND.light.paper, darkMode: theme === "dark" };
	const large = await exportScenePng(previewScene(mark.recipe, LARGE_ICON_SIZE), {
		...exportOptions,
		padding: 8,
		scale: 2,
	});
	const small = await exportScenePng(previewScene(mark.recipe, NODE_ICON_SIZE), {
		...exportOptions,
		padding: 4,
		scale: 2,
	});
	pieces.push(image(x + 10 + SOURCE_SIZE + GAP, top, LARGE_FRAME, base64(large)));
	pieces.push(
		image(
			x + 10 + SOURCE_SIZE + GAP + LARGE_FRAME + GAP,
			top + (LARGE_FRAME - SMALL_FRAME) / 2,
			SMALL_FRAME,
			base64(small),
		),
	);
	return pieces.join("");
}

/**
 * Contact sheets of committed recipes: each mark's source beside its recipe at
 * four times node size and at node size, on light paper or Excalidraw's dark
 * theme.
 */
export async function writeRecipeSheets(
	marks: readonly RecipeSheetMark[],
	theme: SheetTheme,
	outDir: string,
	label: string,
): Promise<string[]> {
	await initializeResvg();
	await mkdir(outDir, { recursive: true });
	const perSheet = SHEET_COLUMNS * SHEET_ROWS;
	const written: string[] = [];
	for (let start = 0; start < marks.length; start += perSheet) {
		const page = marks.slice(start, start + perSheet);
		const rows = Math.ceil(page.length / SHEET_COLUMNS);
		const width = SHEET_COLUMNS * CELL_WIDTH;
		const height = rows * CELL_HEIGHT;
		const cells: string[] = [];
		for (const [index, mark] of page.entries()) {
			cells.push(
				await cell(
					mark,
					theme,
					(index % SHEET_COLUMNS) * CELL_WIDTH,
					Math.floor(index / SHEET_COLUMNS) * CELL_HEIGHT,
				),
			);
		}
		const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width * SHEET_SCALE}" height="${height * SHEET_SCALE}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="${GROUND[theme].paper}"/>${cells.join("")}</svg>`;
		const path = join(
			outDir,
			`${label}-${theme}-${String(start / perSheet + 1).padStart(2, "0")}.png`,
		);
		await writeFile(path, svgPng(svg));
		written.push(path);
	}
	return written;
}

export async function readRecipe(recipesDir: string, slug: string): Promise<IconRecipe> {
	return JSON.parse(await readFile(join(recipesDir, `${slug}.json`), "utf8")) as IconRecipe;
}
