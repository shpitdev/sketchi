import {
	estimateTextWidth,
	ICON_RECIPE_GRID,
	ICON_RECIPE_INK,
	type IconRecipe,
	type IconRecipePart,
	iconRecipeFitIssues,
} from "@sketchi/diagram-core";
import type { IconColorMode } from "@sketchi/icon-catalog";

/** Channel spread up to which a color reads as a gray, not a hue. */
const NEUTRAL_SPREAD = 32;
/** A mono-dark mark's near-black: luminance at or under this. */
const NEAR_BLACK = 0.25;
/** A mono-light mark's near-white: luminance at or over this. */
const NEAR_WHITE = 0.85;
/** Font sizes round down to this step, so a fitted word stays inside. */
const SIZE_STEP = 0.25;

function rgb(hex: string): readonly [number, number, number] {
	return [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16)) as unknown as readonly [
		number,
		number,
		number,
	];
}

/**
 * The scene's own ink for a monochrome mark's literal neutral: a mono-dark
 * mark's near-black, or a mono-light mark's near-white. Drawn as a literal,
 * that color stays put on a surface where the mark itself inverts.
 */
export function inkFor(color: string | undefined, mode: IconColorMode): string | undefined {
	if (color === undefined || !/^#[0-9a-f]{6}$/u.test(color) || mode === "multicolor") return color;
	const [r, g, b] = rgb(color);
	if (Math.max(r, g, b) - Math.min(r, g, b) > NEUTRAL_SPREAD) return color;
	const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
	if (mode === "mono-dark" && luminance <= NEAR_BLACK) return ICON_RECIPE_INK;
	if (mode === "mono-light" && luminance >= NEAR_WHITE) return ICON_RECIPE_INK;
	return color;
}

/** A word shrunk, about its own center, until it sits inside the grid. */
function fitText(part: Extract<IconRecipePart, { kind: "text" }>): IconRecipePart {
	if (iconRecipeFitIssues({ parts: [part] }).length === 0) return part;
	const widthPerSize = estimateTextWidth(part.text, 1);
	const halfWidth = Math.min(part.cx, ICON_RECIPE_GRID - part.cx);
	const halfHeight = Math.min(part.cy, ICON_RECIPE_GRID - part.cy);
	const fitted = Math.min(part.size, (2 * halfWidth) / widthPerSize, 2 * halfHeight);
	return { ...part, size: Math.max(SIZE_STEP, Math.floor(fitted / SIZE_STEP) * SIZE_STEP) };
}

export interface SettledRecipe {
	readonly recipe: IconRecipe;
	/** What changed, one line each; empty when the recipe was already settled. */
	readonly changes: readonly string[];
}

/**
 * A recipe as the catalog keeps it: every word fits the grid, and a
 * monochrome mark draws its own color in the scene's ink, so it follows the
 * theme the way the mark's SVG inverts.
 */
export function settleRecipe(recipe: IconRecipe, mode: IconColorMode): SettledRecipe {
	const changes: string[] = [];
	const parts = recipe.parts.map((part, index): IconRecipePart => {
		let next: IconRecipePart = part;
		if (next.kind === "text") {
			const fitted = fitText(next);
			if (fitted !== next && fitted.kind === "text") {
				changes.push(`parts[${index}] "${next.text}" size ${next.size} -> ${fitted.size}`);
			}
			next = fitted;
		}
		const recolor = <K extends "color" | "fill" | "stroke">(key: K) => {
			const value = (next as Partial<Record<K, string>>)[key];
			const inked = inkFor(value, mode);
			if (inked !== value) {
				changes.push(`parts[${index}].${key} ${value} -> ${inked}`);
				next = { ...next, [key]: inked };
			}
		};
		recolor("color");
		recolor("fill");
		recolor("stroke");
		return next;
	});
	return { recipe: changes.length === 0 ? recipe : { parts }, changes };
}
