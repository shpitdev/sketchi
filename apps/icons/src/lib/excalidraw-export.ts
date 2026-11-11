import { estimateTextWidth, fnv1a32, wrapTextToWidth } from "@sketchi/diagram-core";
import type { IconRecipe } from "@sketchi/diagram-core/icon-recipe";
import { iconRecipeElements } from "@sketchi/diagram-excalidraw";

import { RECIPE_PREVIEW_SIZE } from "./recipe-drawing.js";

// The pages load this when someone copies or downloads a drawing: the
// Excalidraw conversion is most of its code and none of their first paint.

/** Whose drawing it is: a catalog mark's, or a community icon's. */
export type DrawingOrigin = "catalog" | "community";

export interface ExportedDrawing {
	readonly slug: string;
	readonly recipe: IconRecipe;
}

const INK = "#1e1e1e";
const PAPER = "#ffffff";

/** Where an icon lands in Excalidraw: a 96px square, drawn in the default ink on white. */
function excalidrawElements(icon: ExportedDrawing, origin: DrawingOrigin, x = 0, y = 0) {
	return iconRecipeElements(icon.recipe, {
		box: { x, y, size: RECIPE_PREVIEW_SIZE },
		id: `${origin}-${icon.slug}`,
		ink: INK,
		paper: PAPER,
		roughness: 1,
		customData:
			origin === "community" ? { sketchiCommunityIcon: icon.slug } : { sketchiIcon: icon.slug },
	});
}

/** Clipboard text Excalidraw pastes as editable shapes. */
export function excalidrawClipboard(
	icon: ExportedDrawing,
	origin: DrawingOrigin = "community",
): string {
	return JSON.stringify({
		type: "excalidraw/clipboard",
		elements: excalidrawElements(icon, origin),
		files: {},
	});
}

/** An Excalidraw library file holding each icon as one item. */
export function excalidrawLibrary(
	icons: readonly (ExportedDrawing & { readonly name: string; readonly createdAt?: string })[],
	source: string,
	origin: DrawingOrigin = "community",
): string {
	return JSON.stringify({
		type: "excalidrawlib",
		version: 2,
		source,
		libraryItems: icons.map((icon) => ({
			id: `${origin}-${icon.slug}`,
			status: "published",
			name: icon.name,
			created: (icon.createdAt && Date.parse(icon.createdAt)) || 0,
			elements: excalidrawElements(icon, origin),
		})),
	});
}

type NamedDrawing = ExportedDrawing & { readonly name: string };

const SCENE_CELL_WIDTH = 176;
const SCENE_ROW_HEIGHT = 184;
const SCENE_LABEL_SIZE = 16;
const SCENE_LABEL_GAP = 12;
const SCENE_LINE_HEIGHT = 1.25;
/** excalidraw.com opens a scene at the origin, under its toolbar; the first row starts below it. */
const SCENE_MARGIN = { left: 32, top: 112 } as const;

/** The mark's name under its drawing, wrapped to the cell and centered on it. */
function sceneLabel(icon: NamedDrawing, centerX: number, top: number) {
	const id = `catalog-${icon.slug}-name`;
	const seed = fnv1a32(id, "seed");
	const text = wrapTextToWidth(icon.name, SCENE_CELL_WIDTH - 16, SCENE_LABEL_SIZE);
	const width = Math.ceil(estimateTextWidth(text, SCENE_LABEL_SIZE));
	const height = text.split("\n").length * SCENE_LABEL_SIZE * SCENE_LINE_HEIGHT;
	return {
		id,
		type: "text",
		x: Math.round(centerX - width / 2),
		y: top,
		width,
		height,
		angle: 0,
		strokeColor: INK,
		backgroundColor: "transparent",
		fillStyle: "solid",
		strokeWidth: 1,
		strokeStyle: "solid",
		roughness: 0,
		opacity: 100,
		groupIds: [],
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
		fontSize: SCENE_LABEL_SIZE,
		fontFamily: 5,
		lineHeight: SCENE_LINE_HEIGHT,
		textAlign: "center",
		verticalAlign: "top",
		containerId: null,
		autoResize: true,
		customData: { sketchiIcon: icon.slug },
	};
}

/**
 * An Excalidraw scene of the icons in rows, each drawing named underneath, in
 * a grid about as wide as a screen is.
 */
export function excalidrawScene(icons: readonly NamedDrawing[], source: string): string {
	const columns = Math.max(4, Math.round(Math.sqrt(icons.length * 1.6)));
	return JSON.stringify({
		type: "excalidraw",
		version: 2,
		source,
		elements: icons.flatMap((icon, index) => {
			const left = SCENE_MARGIN.left + (index % columns) * SCENE_CELL_WIDTH;
			const top = SCENE_MARGIN.top + Math.floor(index / columns) * SCENE_ROW_HEIGHT;
			const centerX = left + SCENE_CELL_WIDTH / 2;
			return [
				...excalidrawElements(icon, "catalog", centerX - RECIPE_PREVIEW_SIZE / 2, top),
				sceneLabel(icon, centerX, top + RECIPE_PREVIEW_SIZE + SCENE_LABEL_GAP),
			];
		}),
		appState: { viewBackgroundColor: PAPER },
		files: {},
	});
}
