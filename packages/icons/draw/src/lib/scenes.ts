import { fnv1a32, type IconRecipe } from "@sketchi/diagram-core";
import { type ExcalidrawElement, iconRecipeElements } from "@sketchi/diagram-excalidraw";

/** The Excalidraw file a scene export reads. */
export interface IconScene {
	readonly type: "excalidraw";
	readonly version: 2;
	readonly source: string;
	readonly elements: readonly ExcalidrawElement[];
	readonly appState: { readonly viewBackgroundColor: string; readonly gridSize: null };
	readonly files: Readonly<Record<string, unknown>>;
}

export const ICON_INK = "#1e1e1e";
export const ICON_PAPER = "#ffffff";
/** Node-logo size in diagrams. */
export const NODE_ICON_SIZE = 28;
/** The large preview: four times node size. */
export const LARGE_ICON_SIZE = 112;
/** Library items land on the canvas at this size. */
export const LIBRARY_ICON_SIZE = 64;
/** Scene exports render at twice their size, as Studio's PNG export does. */
export const ICON_EXPORT_SCALE = 2;

const SOURCE = "https://sketchi.app";

function base(id: string): { readonly id: string } & Record<string, unknown> {
	const seed = fnv1a32(id, "seed");
	return {
		id,
		angle: 0,
		strokeStyle: "solid",
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
	};
}

/** An empty square that fixes an export's bounds, so a narrow mark still exports square. */
function slot(id: string, x: number, y: number, size: number): ExcalidrawElement {
	return {
		...base(id),
		type: "rectangle",
		x,
		y,
		width: size,
		height: size,
		strokeColor: "transparent",
		backgroundColor: "transparent",
		fillStyle: "solid",
		strokeWidth: 1,
		roughness: 0,
	};
}

function pngImage(id: string, png: string, x: number, y: number, size: number) {
	const fileId = `source-${fnv1a32(png, "hex", "utf16")}`;
	return {
		element: {
			...base(id),
			type: "image",
			x,
			y,
			width: size,
			height: size,
			strokeColor: "transparent",
			backgroundColor: "transparent",
			fillStyle: "solid",
			strokeWidth: 1,
			roughness: 0,
			status: "saved",
			fileId,
			scale: [1, 1],
			crop: null,
		} satisfies ExcalidrawElement,
		file: {
			id: fileId,
			mimeType: "image/png",
			dataURL: `data:image/png;base64,${png}`,
			created: 1,
			lastRetrieved: 1,
		},
	};
}

/** The recipe drawn as plain Excalidraw elements in one group. */
export function drawnIcon(
	recipe: IconRecipe,
	box: { readonly x: number; readonly y: number; readonly size: number },
	id: string,
): ExcalidrawElement[] {
	return iconRecipeElements(recipe, { box, id, ink: ICON_INK, paper: ICON_PAPER });
}

function scene(
	elements: readonly ExcalidrawElement[],
	files: Record<string, unknown> = {},
): IconScene {
	return {
		type: "excalidraw",
		version: 2,
		source: SOURCE,
		elements,
		appState: { viewBackgroundColor: ICON_PAPER, gridSize: null },
		files,
	};
}

/**
 * What the author sees after each draft: the source, the recipe at four times
 * node size, and the recipe at node size, left to right on one row.
 */
export function roundSheet(recipe: IconRecipe, sourcePng: string): IconScene {
	const gap = 24;
	const source = pngImage("sheet-source", sourcePng, 0, 0, LARGE_ICON_SIZE);
	const largeX = LARGE_ICON_SIZE + gap;
	const smallX = largeX + LARGE_ICON_SIZE + gap;
	const smallY = (LARGE_ICON_SIZE - NODE_ICON_SIZE) / 2;
	return scene(
		[
			source.element,
			slot("sheet-large-slot", largeX, 0, LARGE_ICON_SIZE),
			...drawnIcon(recipe, { x: largeX, y: 0, size: LARGE_ICON_SIZE }, "sheet-large"),
			slot("sheet-small-slot", smallX, smallY, NODE_ICON_SIZE),
			...drawnIcon(recipe, { x: smallX, y: smallY, size: NODE_ICON_SIZE }, "sheet-small"),
		],
		{ [source.file.id]: source.file },
	);
}

/** The recipe alone at one size, on paper. */
export function previewScene(recipe: IconRecipe, size: number): IconScene {
	return scene([
		slot("preview-slot", 0, 0, size),
		...drawnIcon(recipe, { x: 0, y: 0, size }, "icon"),
	]);
}

export interface IconLibrary {
	readonly type: "excalidrawlib";
	readonly version: 2;
	readonly source: string;
	readonly libraryItems: ReadonlyArray<{
		readonly id: string;
		readonly status: "published";
		readonly created: number;
		readonly name: string;
		readonly elements: readonly ExcalidrawElement[];
	}>;
}

/** An `.excalidrawlib` holding the icon as one library item. */
export function iconLibrary(name: string, recipe: IconRecipe): IconLibrary {
	const id = `sketchi-icon-${fnv1a32(`${name}\n${JSON.stringify(recipe)}`, "hex", "utf16")}`;
	const elements = drawnIcon(recipe, { x: 0, y: 0, size: LIBRARY_ICON_SIZE }, id);
	return {
		type: "excalidrawlib",
		version: 2,
		source: SOURCE,
		libraryItems: [{ id, status: "published", created: 1, name, elements }],
	};
}
