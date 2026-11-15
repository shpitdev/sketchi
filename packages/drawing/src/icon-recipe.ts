/**
 * Hand-drawn icons as a few drawing primitives instead of an embedded SVG.
 *
 * A recipe is what a person sketches in Excalidraw: rectangles, ellipses,
 * strokes, an arrow, a word, on a 24-unit grid. Renderers place it in any
 * square box and draw it with their own pen, so it reads as part of the
 * scene, stays editable, and recolors with it: parts drawn in `ink` take the
 * scene's text color, while brand colors stay fixed.
 */

import { excalifontInkBox, type InkBox } from "./excalifont-ink.js";

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

/**
 * The box a text part's word paints on the grid: the word is centered on
 * (cx, cy) in Excalifont at `size` grid units, as the drawer lays it out.
 */
export function iconRecipeTextBox(part: IconRecipeText): InkBox {
	const ink = excalifontInkBox(part.text, part.size);
	return {
		left: part.cx + ink.left,
		right: part.cx + ink.right,
		top: part.cy + ink.top,
		bottom: part.cy + ink.bottom,
	};
}

/**
 * How a word is judged against the shapes around it: at the size reviewers
 * read icons (112 px), where the 2 px pen is drawn, plus a little paper.
 */
export const ICON_RECIPE_TEXT_FIT = Object.freeze({
	previewSize: 112,
	penPx: 2,
	/** Paper kept between a word's ink and the inner edge of its frame's pen. */
	padding: 0.5,
	/** The smallest word that still reads at the preview size. */
	minSize: 3.5,
});

type Point = readonly [number, number];

/** A shape's outline: the drawn segments and the polygon that bounds its inside. */
interface Outline {
	readonly points: readonly Point[];
	/** A closed outline also draws its last point back to the first. */
	readonly closed: boolean;
	/** The outline's color; undefined for a fill drawn without one. */
	readonly stroke: string | undefined;
	readonly fill: string | undefined;
	/**
	 * How far inside the outline the edge a word must keep within sits, in
	 * grid units at the preview size: the pen's inner edge, or the fill's
	 * outer edge for a badge whose pen is its fill's color.
	 */
	readonly edge: number;
}

const ARC_STEPS = 6;
const ELLIPSE_STEPS = 48;
/** Outlines are checked at points this far apart along the pen. */
const SAMPLE_STEP = 0.1;

function arc(cx: number, cy: number, r: number, from: number): Point[] {
	return Array.from({ length: ARC_STEPS + 1 }, (_, step) => {
		const angle = from + ((Math.PI / 2) * step) / ARC_STEPS;
		return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)] as const;
	});
}

function shapePoints(part: IconRecipeRect | IconRecipeEllipse): readonly Point[] {
	if (part.kind === "ellipse") {
		return Array.from({ length: ELLIPSE_STEPS }, (_, step) => {
			const angle = (2 * Math.PI * step) / ELLIPSE_STEPS;
			return [part.cx + part.rx * Math.cos(angle), part.cy + part.ry * Math.sin(angle)] as const;
		});
	}
	const { x, y, width, height } = part;
	// Excalidraw rounds a corner by a quarter of the shorter side at icon sizes.
	const r = part.rounded ? Math.min(width, height) / 4 : 0;
	if (r === 0) {
		return [
			[x, y],
			[x + width, y],
			[x + width, y + height],
			[x, y + height],
		];
	}
	return [
		...arc(x + width - r, y + r, r, -Math.PI / 2),
		...arc(x + width - r, y + height - r, r, 0),
		...arc(x + r, y + height - r, r, Math.PI / 2),
		...arc(x + r, y + r, r, Math.PI),
	];
}

const CURVE_STEPS = 12;

/**
 * The path a stroke's pen takes. A smooth stroke is the curve rough.js draws
 * through its points for Excalidraw: a Catmull-Rom spline whose end points
 * repeat, so it passes through every point. A closed stroke is drawn back to
 * its first point, as the drawer draws it.
 */
function strokePath(part: IconRecipeStroke): { points: readonly Point[]; closed: boolean } {
	if (!part.smooth) return { points: part.points, closed: part.closed === true };
	const through = part.closed ? [...part.points, part.points[0]!] : part.points;
	const last = through.length - 1;
	const points: Point[] = [through[0]!];
	for (let index = 0; index < last; index++) {
		const [x0, y0] = through[Math.max(index - 1, 0)]!;
		const [x1, y1] = through[index]!;
		const [x2, y2] = through[index + 1]!;
		const [x3, y3] = through[Math.min(index + 2, last)]!;
		const c1: Point = [x1 + (x2 - x0) / 6, y1 + (y2 - y0) / 6];
		const c2: Point = [x2 - (x3 - x1) / 6, y2 - (y3 - y1) / 6];
		for (let step = 1; step <= CURVE_STEPS; step++) {
			const t = step / CURVE_STEPS;
			const u = 1 - t;
			const [a, b, c, d] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
			points.push([
				a * x1 + b * c1[0] + c * c2[0] + d * x2,
				a * y1 + b * c1[1] + c * c2[1] + d * y2,
			]);
		}
	}
	return { points, closed: false };
}

function outline(part: IconRecipePart): Outline | undefined {
	if (part.kind === "text" || part.kind === "arrow") return undefined;
	const unit = ICON_RECIPE_TEXT_FIT.previewSize / ICON_RECIPE_GRID;
	const stroke = part.stroke === "none" ? undefined : (part.stroke ?? ICON_RECIPE_INK);
	const halfPen =
		stroke === undefined ? 0 : (ICON_RECIPE_TEXT_FIT.penPx * (part.pen ?? 1)) / 2 / unit;
	const badge = part.fill !== undefined && (stroke === undefined || stroke === part.fill);
	return {
		...(part.kind === "stroke" ? strokePath(part) : { points: shapePoints(part), closed: true }),
		stroke,
		fill: part.fill,
		edge: badge ? -halfPen : halfPen,
	};
}

function inside([x, y]: Point, polygon: readonly Point[]): boolean {
	let within = false;
	for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
		const [xi, yi] = polygon[index]!;
		const [xj, yj] = polygon[previous]!;
		if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) within = !within;
	}
	return within;
}

/** Points along the segments an outline's pen draws. */
function penPoints(shape: Outline): Point[] {
	const segments = shape.closed ? shape.points.length : shape.points.length - 1;
	const points: Point[] = [];
	for (let index = 0; index < segments; index++) {
		const [ax, ay] = shape.points[index]!;
		const [bx, by] = shape.points[(index + 1) % shape.points.length]!;
		const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / SAMPLE_STEP));
		for (let step = 0; step <= steps; step++) {
			points.push([ax + ((bx - ax) * step) / steps, ay + ((by - ay) * step) / steps]);
		}
	}
	return points;
}

function boxDistance([x, y]: Point, box: InkBox): number {
	return Math.hypot(
		Math.max(box.left - x, 0, x - box.right),
		Math.max(box.top - y, 0, y - box.bottom),
	);
}

/**
 * The part whose outline a word's ink runs into, if one does. A shape frames
 * a word when the word's center lies inside it (inside the polygon its points
 * bound, for an open stroke), and the ink must keep the padding inside every
 * visible stretch of its pen. A stretch is hidden under a fill drawn later, or
 * inside a fill of its own color, as the backdrop under a badge is.
 */
function crowdingFrame(recipe: IconRecipe, part: IconRecipeText): number | undefined {
	const box = iconRecipeTextBox(part);
	const center: Point = [(box.left + box.right) / 2, (box.top + box.bottom) / 2];
	const shapes = recipe.parts.map(outline);
	for (const [index, frame] of shapes.entries()) {
		if (!frame || frame.points.length < 3 || !inside(center, frame.points)) continue;
		const clearance = frame.edge + ICON_RECIPE_TEXT_FIT.padding;
		const hidden = (point: Point) =>
			shapes.some(
				(cover, coverIndex) =>
					cover !== undefined &&
					coverIndex !== index &&
					cover.fill !== undefined &&
					(coverIndex > index || cover.fill === frame.stroke) &&
					cover.points.length >= 3 &&
					inside(point, cover.points),
			);
		if (penPoints(frame).some((point) => boxDistance(point, box) < clearance && !hidden(point))) {
			return index;
		}
	}
	return undefined;
}

function withinGrid(box: InkBox): boolean {
	const low = -ICON_RECIPE_LIMITS.overhang;
	const high = ICON_RECIPE_GRID + ICON_RECIPE_LIMITS.overhang;
	return box.left >= low && box.right <= high && box.top >= low && box.bottom <= high;
}

function fits(recipe: IconRecipe, part: IconRecipeText): boolean {
	return withinGrid(iconRecipeTextBox(part)) && crowdingFrame(recipe, part) === undefined;
}

/**
 * The largest size, in quarter units down to the readable minimum, at which a
 * recipe's word fits where it stands: undefined when even the minimum does not.
 */
export function iconRecipeTextFitSize(recipe: IconRecipe, index: number): number | undefined {
	const part = recipe.parts[index];
	if (part?.kind !== "text") return undefined;
	for (
		let size = Math.floor(part.size * 4) / 4;
		size >= ICON_RECIPE_TEXT_FIT.minSize;
		size -= 0.25
	) {
		if (fits(recipe, { ...part, size })) return size;
	}
	return undefined;
}

/**
 * Where a drawable recipe would clip or crowd a word: past the grid (with the
 * overhang a stroke may take) it is cut off in every square it is drawn in,
 * and into the shape that frames it, it runs over that shape's pen. Checked
 * when a recipe is made or accepted, not when a stored one is read.
 */
export function iconRecipeFitIssues(recipe: IconRecipe): string[] {
	return recipe.parts.flatMap((part, index) => {
		if (part.kind !== "text") return [];
		const box = iconRecipeTextBox(part);
		const path = `recipe.parts[${index}] text "${part.text}"`;
		const issues: string[] = [];
		if (!withinGrid(box)) {
			issues.push(
				`${path} spans ${box.left.toFixed(1)} to ${box.right.toFixed(1)} across and ${box.top.toFixed(1)} to ${box.bottom.toFixed(1)} down, past the ${ICON_RECIPE_GRID}-unit grid; make it smaller or move it inward.`,
			);
		}
		const frame = crowdingFrame(recipe, part);
		if (frame !== undefined) {
			const size = iconRecipeTextFitSize(recipe, index);
			const remedy =
				size === undefined
					? `even at size ${ICON_RECIPE_TEXT_FIT.minSize} it does not fit: move it, widen the frame, or drop the frame`
					: `it fits at size ${size} where it stands, or move it inward`;
			issues.push(
				`${path} spans ${box.left.toFixed(1)} to ${box.right.toFixed(1)} across and runs into the frame drawn by parts[${frame}]; ${remedy}.`,
			);
		}
		return issues;
	});
}

/** Serialized size, the unit the per-scene icon budget counts. */
export function iconRecipeByteLength(recipe: IconRecipe): number {
	return new TextEncoder().encode(JSON.stringify(recipe)).byteLength;
}
