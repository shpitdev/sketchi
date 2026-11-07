/**
 * Hand-drawn icons as a few drawing primitives instead of an embedded SVG.
 *
 * A recipe is what a person sketches in Excalidraw: rectangles, ellipses,
 * strokes, an arrow, a word, on a 24-unit grid. Renderers place it in any
 * square box and draw it with their own pen, so it reads as part of the
 * scene, stays editable, and recolors with it: parts drawn in `ink` take the
 * scene's text color, while brand colors stay fixed.
 */

export const ICON_RECIPE_GRID = 24;

export const ICON_RECIPE_LIMITS = Object.freeze({
	/** Every part becomes one drawn element. */
	maxParts: 8,
	maxPointsPerPart: 48,
	maxTextLength: 8,
	/** Parts may overhang the grid by this much, as a hand-drawn stroke does. */
	overhang: 1,
	maxBytes: 3 * 1024,
});

/** Draws in the scene's text color, so the icon follows the theme. */
export const ICON_RECIPE_INK = "ink";
/** Draws in the scene's background color: the cutout of an inverted mark. */
export const ICON_RECIPE_PAPER = "paper";

export type IconRecipePoint = readonly [number, number];

export interface IconRecipePaint {
	/** Outline color, `ink` when omitted; `none` draws the fill alone. */
	readonly stroke?: string;
	/** Fill color, `ink`, `paper` or a hex color; omitted leaves the shape open. */
	readonly fill?: string;
	/** 2 draws with a marker, twice the icon's pen. */
	readonly pen?: 1 | 2;
}

export interface IconRecipeRect extends IconRecipePaint {
	readonly kind: "rect";
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
	readonly rounded?: boolean;
}

export interface IconRecipeEllipse extends IconRecipePaint {
	readonly kind: "ellipse";
	readonly cx: number;
	readonly cy: number;
	readonly rx: number;
	readonly ry: number;
}

/** A pen stroke through points; smooth curves through them, closed returns to the start. */
export interface IconRecipeStroke extends IconRecipePaint {
	readonly kind: "stroke";
	readonly points: readonly IconRecipePoint[];
	readonly smooth?: boolean;
	readonly closed?: boolean;
}

/** A stroke ending in an arrowhead. */
export interface IconRecipeArrow extends Omit<IconRecipePaint, "fill"> {
	readonly kind: "arrow";
	readonly points: readonly IconRecipePoint[];
	readonly smooth?: boolean;
}

/** A short word in the scene's hand-drawn font, centered on a point. */
export interface IconRecipeText {
	readonly kind: "text";
	readonly cx: number;
	readonly cy: number;
	readonly text: string;
	/** Font size in grid units. */
	readonly size: number;
	readonly color?: string;
}

export type IconRecipePart =
	| IconRecipeRect
	| IconRecipeEllipse
	| IconRecipeStroke
	| IconRecipeArrow
	| IconRecipeText;

export interface IconRecipe {
	readonly parts: readonly IconRecipePart[];
}

const HEX_COLOR = /^#[0-9a-f]{6}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function onGrid(value: unknown): boolean {
	return (
		isFiniteNumber(value) &&
		value >= -ICON_RECIPE_LIMITS.overhang &&
		value <= ICON_RECIPE_GRID + ICON_RECIPE_LIMITS.overhang
	);
}

function isPositiveExtent(value: unknown): boolean {
	return isFiniteNumber(value) && value > 0 && value <= ICON_RECIPE_GRID;
}

function colorIssue(value: unknown, path: string, allowed: readonly string[]): string | undefined {
	if (value === undefined) return undefined;
	if (typeof value === "string" && (HEX_COLOR.test(value) || allowed.includes(value))) {
		return undefined;
	}
	const choices = [...allowed, "a lowercase #rrggbb color"].join(", ");
	return `${path} must be ${choices}.`;
}

const PART_FIELDS: Readonly<Record<IconRecipePart["kind"], readonly string[]>> = {
	rect: ["kind", "x", "y", "width", "height", "rounded", "stroke", "fill", "pen"],
	ellipse: ["kind", "cx", "cy", "rx", "ry", "stroke", "fill", "pen"],
	stroke: ["kind", "points", "smooth", "closed", "stroke", "fill", "pen"],
	arrow: ["kind", "points", "smooth", "stroke", "pen"],
	text: ["kind", "cx", "cy", "text", "size", "color"],
};

function pointsIssues(value: unknown, path: string, minimum: number): string[] {
	if (!Array.isArray(value)) return [`${path} must be an array of [x, y] points.`];
	if (value.length < minimum || value.length > ICON_RECIPE_LIMITS.maxPointsPerPart) {
		return [`${path} must hold ${minimum}-${ICON_RECIPE_LIMITS.maxPointsPerPart} points.`];
	}
	return value.flatMap((point, index) =>
		Array.isArray(point) && point.length === 2 && onGrid(point[0]) && onGrid(point[1])
			? []
			: [`${path}[${index}] must be an [x, y] point on the ${ICON_RECIPE_GRID}-unit grid.`],
	);
}

function partIssues(part: unknown, path: string): string[] {
	if (!isRecord(part) || typeof part["kind"] !== "string" || !(part["kind"] in PART_FIELDS)) {
		return [`${path}.kind must be one of ${Object.keys(PART_FIELDS).join(", ")}.`];
	}
	const kind = part["kind"] as IconRecipePart["kind"];
	const issues = Object.keys(part)
		.filter((key) => !PART_FIELDS[kind].includes(key))
		.map((key) => `${path}.${key} is not a ${kind} field.`);
	const check = (ok: boolean, message: string) => {
		if (!ok) issues.push(`${path}.${message}`);
	};
	const optionalBoolean = (key: string) =>
		check(part[key] === undefined || typeof part[key] === "boolean", `${key} must be a boolean.`);
	if (kind === "text") {
		check(onGrid(part["cx"]) && onGrid(part["cy"]), "cx and cy must sit on the grid.");
		check(
			typeof part["text"] === "string" &&
				part["text"].trim().length > 0 &&
				part["text"].length <= ICON_RECIPE_LIMITS.maxTextLength,
			`text must be 1-${ICON_RECIPE_LIMITS.maxTextLength} characters.`,
		);
		check(isPositiveExtent(part["size"]), "size must be a positive grid length.");
		const color = colorIssue(part["color"], `${path}.color`, [ICON_RECIPE_INK, ICON_RECIPE_PAPER]);
		if (color) issues.push(color);
		return issues;
	}
	const stroke = colorIssue(part["stroke"], `${path}.stroke`, [
		ICON_RECIPE_INK,
		ICON_RECIPE_PAPER,
		"none",
	]);
	const fill = colorIssue(part["fill"], `${path}.fill`, [ICON_RECIPE_INK, ICON_RECIPE_PAPER]);
	if (stroke) issues.push(stroke);
	if (fill) issues.push(fill);
	check(part["pen"] === undefined || part["pen"] === 1 || part["pen"] === 2, "pen must be 1 or 2.");
	check(part["stroke"] !== "none" || part["fill"] !== undefined, "stroke none needs a fill.");
	if (kind === "rect") {
		check(onGrid(part["x"]) && onGrid(part["y"]), "x and y must sit on the grid.");
		check(
			isPositiveExtent(part["width"]) && isPositiveExtent(part["height"]),
			"width and height must be positive grid lengths.",
		);
		optionalBoolean("rounded");
	} else if (kind === "ellipse") {
		check(onGrid(part["cx"]) && onGrid(part["cy"]), "cx and cy must sit on the grid.");
		check(
			isPositiveExtent(part["rx"]) && isPositiveExtent(part["ry"]),
			"rx and ry must be positive grid lengths.",
		);
	} else {
		issues.push(...pointsIssues(part["points"], `${path}.points`, 2));
		optionalBoolean("smooth");
		if (kind === "stroke") optionalBoolean("closed");
	}
	return issues;
}

/** Problems with an untrusted recipe; empty when it can be drawn. */
export function iconRecipeIssues(value: unknown): string[] {
	if (!isRecord(value) || !Array.isArray(value["parts"])) {
		return ["recipe must be an object with a parts array."];
	}
	const extra = Object.keys(value).filter((key) => key !== "parts");
	const parts = value["parts"];
	const issues = extra.map((key) => `recipe.${key} is not a recipe field.`);
	if (parts.length === 0 || parts.length > ICON_RECIPE_LIMITS.maxParts) {
		issues.push(`recipe.parts must hold 1-${ICON_RECIPE_LIMITS.maxParts} parts.`);
	}
	issues.push(...parts.flatMap((part, index) => partIssues(part, `recipe.parts[${index}]`)));
	if (
		issues.length === 0 &&
		iconRecipeByteLength(value as unknown as IconRecipe) > ICON_RECIPE_LIMITS.maxBytes
	) {
		issues.push(`recipe exceeds ${ICON_RECIPE_LIMITS.maxBytes} bytes.`);
	}
	return issues;
}

export function isIconRecipe(value: unknown): value is IconRecipe {
	return iconRecipeIssues(value).length === 0;
}

/** Serialized size, the unit the per-scene icon budget counts. */
export function iconRecipeByteLength(recipe: IconRecipe): number {
	return new TextEncoder().encode(JSON.stringify(recipe)).byteLength;
}
