import { estimateTextWidth, fnv1a32, wrapTextToWidth } from "@sketchi/diagram-core";
import type { IconRecipe } from "@sketchi/diagram-core/icon-recipe";
import { type ExcalidrawElement, iconRecipeElements } from "@sketchi/diagram-excalidraw";

import { RECIPE_PREVIEW_SIZE } from "./recipe-drawing.js";
import { DRAWN_NAME_FONT_SIZE, DRAWN_NAME_GAP, DRAWN_NAME_MAX_WIDTH } from "./drawn-name.js";

// The pages load this when someone copies or downloads a drawing: the
// Excalidraw conversion is most of its code and none of their first paint.

/** Whose drawing it is: a catalog mark's, or a community icon's. */
export type DrawingOrigin = "catalog" | "community";

export interface ExportedDrawing {
	readonly slug: string;
	readonly name: string;
	readonly recipe: IconRecipe;
}

export interface ExportOptions {
	/** Write the icon's name under the drawing, grouped with it as one item. */
	readonly named?: boolean;
}

const INK = "#1e1e1e";
const PAPER = "#ffffff";
/** Excalidraw's number for Excalifont, the hand the drawings and its default text use. */
const EXCALIFONT = 5;
const LINE_HEIGHT = 1.25;

function round(value: number): number {
	return Math.round(value * 100) / 100;
}

/** The name under a drawing: centered, wrapped before it outgrows the drawing. */
function nameElement(
	icon: ExportedDrawing,
	id: string,
	group: string,
	x: number,
	y: number,
	customData: Readonly<Record<string, unknown>>,
): ExcalidrawElement {
	const text = wrapTextToWidth(icon.name, DRAWN_NAME_MAX_WIDTH, DRAWN_NAME_FONT_SIZE);
	const lines = text.split("\n");
	const width = round(
		Math.max(...lines.map((line) => estimateTextWidth(line, DRAWN_NAME_FONT_SIZE))),
	);
	const seed = fnv1a32(id, "seed");
	return {
		id,
		type: "text",
		x: round(x + (RECIPE_PREVIEW_SIZE - width) / 2),
		y: y + RECIPE_PREVIEW_SIZE + DRAWN_NAME_GAP,
		width,
		height: round(lines.length * DRAWN_NAME_FONT_SIZE * LINE_HEIGHT),
		angle: 0,
		strokeColor: INK,
		backgroundColor: "transparent",
		fillStyle: "solid",
		strokeWidth: 1,
		strokeStyle: "solid",
		roughness: 1,
		opacity: 100,
		groupIds: [group],
		frameId: null,
		index: null,
		roundness: null,
		seed,
		version: 1,
		versionNonce: seed + 1,
		isDeleted: false,
		boundElements: null,
		updated: 1,
		link: null,
		locked: false,
		text,
		originalText: text,
		fontSize: DRAWN_NAME_FONT_SIZE,
		fontFamily: EXCALIFONT,
		textAlign: "center",
		verticalAlign: "top",
		containerId: null,
		autoResize: true,
		lineHeight: LINE_HEIGHT,
		customData: { ...customData, sketchiIconPart: "name" },
	};
}

/**
 * Where an icon lands in Excalidraw: a 96px square, drawn in the default ink
 * on white. Named, the drawing and its name share an outer group, so the two
 * select, move and resize as one and the drawing alone is a double-click away.
 */
function excalidrawElements(
	icon: ExportedDrawing,
	origin: DrawingOrigin,
	{ named = false }: ExportOptions = {},
	x = 0,
	y = 0,
): ExcalidrawElement[] {
	const id = `${origin}-${icon.slug}`;
	const group = `${id}-named`;
	const customData =
		origin === "community" ? { sketchiCommunityIcon: icon.slug } : { sketchiIcon: icon.slug };
	const drawing = iconRecipeElements(icon.recipe, {
		box: { x, y, size: RECIPE_PREVIEW_SIZE },
		id,
		...(named ? { groupIds: [group] } : {}),
		ink: INK,
		paper: PAPER,
		roughness: 1,
		customData,
	});
	return named
		? [...drawing, nameElement(icon, `${group}-name`, group, x, y, customData)]
		: drawing;
}

/** Clipboard text Excalidraw pastes as editable shapes. */
export function excalidrawClipboard(
	icon: ExportedDrawing,
	origin: DrawingOrigin = "community",
	options: ExportOptions = {},
): string {
	return JSON.stringify({
		type: "excalidraw/clipboard",
		elements: excalidrawElements(icon, origin, options),
		files: {},
	});
}

/** An Excalidraw library file holding each icon as one item. */
export function excalidrawLibrary(
	icons: readonly (ExportedDrawing & { readonly createdAt?: string })[],
	source: string,
	origin: DrawingOrigin = "community",
	options: ExportOptions = {},
): string {
	return JSON.stringify({
		type: "excalidrawlib",
		version: 2,
		source,
		libraryItems: icons.map((icon) => ({
			id: options.named ? `${origin}-${icon.slug}-named` : `${origin}-${icon.slug}`,
			status: "published",
			name: icon.name,
			created: (icon.createdAt && Date.parse(icon.createdAt)) || 0,
			elements: excalidrawElements(icon, origin, options),
		})),
	});
}
