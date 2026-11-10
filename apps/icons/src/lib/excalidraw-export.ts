import type { IconRecipe } from "@sketchi/diagram-core/icon-recipe";
import { iconRecipeElements } from "@sketchi/diagram-excalidraw";

import { RECIPE_PREVIEW_SIZE } from "./recipe-drawing.js";

// The community page loads this when someone copies or downloads an icon: the
// Excalidraw conversion is most of its code and none of its first paint.

/** Where an icon lands in Excalidraw: a 96px square, drawn in the default ink on white. */
function excalidrawElements(icon: { readonly slug: string; readonly recipe: IconRecipe }) {
	return iconRecipeElements(icon.recipe, {
		box: { x: 0, y: 0, size: RECIPE_PREVIEW_SIZE },
		id: `community-${icon.slug}`,
		ink: "#1e1e1e",
		paper: "#ffffff",
		roughness: 1,
		customData: { sketchiCommunityIcon: icon.slug },
	});
}

/** Clipboard text Excalidraw pastes as editable shapes. */
export function excalidrawClipboard(icon: {
	readonly slug: string;
	readonly recipe: IconRecipe;
}): string {
	return JSON.stringify({
		type: "excalidraw/clipboard",
		elements: excalidrawElements(icon),
		files: {},
	});
}

/** An Excalidraw library file holding each icon as one item. */
export function excalidrawLibrary(
	icons: readonly {
		readonly slug: string;
		readonly name: string;
		readonly recipe: IconRecipe;
		readonly createdAt: string;
	}[],
	source: string,
): string {
	return JSON.stringify({
		type: "excalidrawlib",
		version: 2,
		source,
		libraryItems: icons.map((icon) => ({
			id: `community-${icon.slug}`,
			status: "published",
			name: icon.name,
			created: Date.parse(icon.createdAt) || 0,
			elements: excalidrawElements(icon),
		})),
	});
}
