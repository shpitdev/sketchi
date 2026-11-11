import type { IconRecipe } from "@sketchi/diagram-core/icon-recipe";

import { RECIPE_PREVIEW_SIZE, recipePreview } from "./recipe-drawing.js";

/**
 * The preview excalidraw.com's "Publish library" dialog draws for a library
 * (`generatePreviewImage`): 6 items a row, each fit into a 128px box with
 * 10px of white around it, the boxes 8px apart behind a light gray border,
 * saved as a JPEG at most 5000px a side. Each mark here is drawn the way the
 * pages draw it, in Excalidraw's default ink on white.
 */
export const PACK_PREVIEW_GRID = {
	columns: 6,
	box: 128,
	padding: 8,
	border: 2,
	borderColor: "#ced4da",
	maxSide: 5000,
	quality: 80,
} as const;

const PALETTE = { ink: "#1e1e1e", paper: "#ffffff" } as const;

function escapeXml(text: string): string {
	return text.replace(/[<>&"']/gu, (character) => `&#${character.codePointAt(0)};`);
}

/** The preview canvas and the top-left of each item's box on it. */
export function packPreviewLayout(count: number) {
	const { box, columns, padding } = PACK_PREVIEW_GRID;
	const cell = box + padding * 2;
	return {
		width: Math.min(count, columns) * cell,
		height: Math.ceil(count / columns) * cell,
		boxes: Array.from({ length: count }, (_, index) => ({
			x: (index % columns) * cell,
			y: Math.floor(index / columns) * cell,
		})),
	};
}

/** The preview as one SVG, ready to rasterize with Excalifont as its font. */
export function packPreviewSvg(recipes: readonly IconRecipe[]): string {
	const { border, borderColor, box, padding } = PACK_PREVIEW_GRID;
	const layout = packPreviewLayout(recipes.length);
	const inset = padding + (box - RECIPE_PREVIEW_SIZE) / 2;
	const cells = recipes.map((recipe, index) => {
		const { x, y } = layout.boxes[index]!;
		const parts = recipePreview(recipe, PALETTE).parts.map((part) =>
			part.kind === "text"
				? `<text x="${part.x}" y="${part.y}" font-family="Excalifont" font-size="${part.size}" fill="${part.fill}" text-anchor="middle" dominant-baseline="central">${escapeXml(part.text)}</text>`
				: part.paths
						.map(
							(path) =>
								`<path d="${path.d}" fill="${path.fill}" stroke="${path.stroke}" stroke-width="${path.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`,
						)
						.join(""),
		);
		return `<rect x="${x + padding / 2}" y="${y + padding / 2}" width="${box + padding}" height="${box + padding}" fill="none" stroke="${borderColor}" stroke-width="${border}"/><g transform="translate(${x + inset} ${y + inset})">${parts.join("")}</g>`;
	});
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}"><rect width="100%" height="100%" fill="${PALETTE.paper}"/>${cells.join("")}</svg>`;
}
