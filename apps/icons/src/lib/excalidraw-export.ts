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

/** Where an icon lands in Excalidraw: a 96px square, drawn in the default ink on white. */
function excalidrawElements(icon: ExportedDrawing, origin: DrawingOrigin) {
	return iconRecipeElements(icon.recipe, {
		box: { x: 0, y: 0, size: RECIPE_PREVIEW_SIZE },
		id: `${origin}-${icon.slug}`,
		ink: "#1e1e1e",
		paper: "#ffffff",
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
