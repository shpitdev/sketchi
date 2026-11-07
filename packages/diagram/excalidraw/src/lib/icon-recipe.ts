import {
	estimateTextWidth,
	fnv1a32,
	ICON_RECIPE_GRID,
	ICON_RECIPE_INK,
	ICON_RECIPE_PAPER,
	type IconRecipe,
	type IconRecipePart,
	type IconRecipePoint,
} from "@sketchi/diagram-core";

import type { ExcalidrawElement } from "./convert.js";

/** Below this edge Excalidraw's jitter turns a small filled shape into a ragged blob. */
const SMALL_ICON_EDGE = 48;
const TEXT_LINE_HEIGHT = 1.25;

export interface IconRecipeDrawing {
	/** The square the icon fills. */
	readonly box: { readonly x: number; readonly y: number; readonly size: number };
	/** Element ids are `${id}-${part}`; the icon's own group is `id`. */
	readonly id: string;
	/** Groups around the icon, innermost first. */
	readonly groupIds?: readonly string[];
	readonly frameId?: string | null;
	/** The color `ink` parts take: the label color of the node the icon sits in. */
	readonly ink: string;
	/** The color `paper` parts take: the scene's background. */
	readonly paper: string;
	/** Strokes take the node's roughness; small fills always draw clean. */
	readonly roughness?: number;
	readonly locked?: boolean;
	readonly opacity?: number;
	/** Copied onto every part, so tools can tell which icon a part draws. */
	readonly customData?: Readonly<Record<string, unknown>>;
}

/** Icons draw with the scene's bold pen; a marker part draws extra bold. */
export const ICON_RECIPE_STROKE_WIDTH = 2;

function round(value: number): number {
	return Math.round(value * 100) / 100;
}

function color(
	value: string | undefined,
	drawing: Pick<IconRecipeDrawing, "ink" | "paper">,
	fallback: string,
): string {
	if (value === undefined) return fallback;
	if (value === ICON_RECIPE_INK) return drawing.ink;
	if (value === ICON_RECIPE_PAPER) return drawing.paper;
	return value === "none" ? "transparent" : value;
}

/**
 * Draw a recipe as plain Excalidraw elements in one group: rectangles,
 * ellipses, lines, an arrow and text, so the icon edits, scales and recolors
 * like anything drawn by hand. Output is deterministic for equal input.
 */
export function iconRecipeElements(
	recipe: IconRecipe,
	drawing: IconRecipeDrawing,
): ExcalidrawElement[] {
	const scale = drawing.box.size / ICON_RECIPE_GRID;
	const at = ([x, y]: IconRecipePoint): readonly [number, number] => [
		drawing.box.x + x * scale,
		drawing.box.y + y * scale,
	];
	const groupIds = [drawing.id, ...(drawing.groupIds ?? [])];

	const base = (part: IconRecipePart, index: number, roughness: number) => {
		const id = `${drawing.id}-${index}`;
		const seed = fnv1a32(id, "seed");
		return {
			id,
			angle: 0,
			boundElements: null,
			fillStyle: "solid",
			frameId: drawing.frameId ?? null,
			groupIds: [...groupIds],
			index: null,
			isDeleted: false,
			link: null,
			locked: drawing.locked ?? false,
			opacity: drawing.opacity ?? 100,
			roughness,
			roundness: null,
			seed,
			strokeStyle: "solid",
			updated: 1,
			version: 1,
			versionNonce: seed + 1,
			customData: { ...drawing.customData, sketchiIconPart: part.kind },
		};
	};

	return recipe.parts.map((part, index): ExcalidrawElement => {
		if (part.kind === "text") {
			const fontSize = round(part.size * scale);
			const width = round(estimateTextWidth(part.text, fontSize));
			const height = round(fontSize * TEXT_LINE_HEIGHT);
			const [cx, cy] = at([part.cx, part.cy]);
			return {
				...base(part, index, 0),
				type: "text",
				x: round(cx - width / 2),
				y: round(cy - height / 2),
				width,
				height,
				backgroundColor: "transparent",
				strokeColor: color(part.color, drawing, drawing.ink),
				strokeWidth: 1,
				text: part.text,
				originalText: part.text,
				fontSize,
				fontFamily: 5,
				lineHeight: TEXT_LINE_HEIGHT,
				textAlign: "center",
				verticalAlign: "middle",
				containerId: null,
				autoResize: true,
			};
		}
		const fill = part.kind === "arrow" ? undefined : part.fill;
		const roughness =
			fill !== undefined && drawing.box.size < SMALL_ICON_EDGE ? 0 : (drawing.roughness ?? 1);
		const paint = {
			...base(part, index, roughness),
			backgroundColor: color(fill, drawing, "transparent"),
			strokeColor: color(part.stroke, drawing, drawing.ink),
			strokeWidth: ICON_RECIPE_STROKE_WIDTH * (part.pen ?? 1),
		};
		if (part.kind === "rect" || part.kind === "ellipse") {
			const [x, y] =
				part.kind === "rect" ? at([part.x, part.y]) : at([part.cx - part.rx, part.cy - part.ry]);
			const width = part.kind === "rect" ? part.width : part.rx * 2;
			const height = part.kind === "rect" ? part.height : part.ry * 2;
			return {
				...paint,
				type: part.kind === "rect" ? "rectangle" : "ellipse",
				x: round(x),
				y: round(y),
				width: round(width * scale),
				height: round(height * scale),
				roundness: part.kind === "rect" && part.rounded ? { type: 3 } : null,
			};
		}
		const source =
			part.kind === "stroke" && part.closed ? [...part.points, part.points[0]!] : part.points;
		const points = source.map(at);
		const [startX, startY] = points[0]!;
		const xs = points.map(([x]) => x);
		const ys = points.map(([, y]) => y);
		return {
			...paint,
			type: part.kind === "arrow" ? "arrow" : "line",
			x: round(startX),
			y: round(startY),
			width: round(Math.max(...xs) - Math.min(...xs)),
			height: round(Math.max(...ys) - Math.min(...ys)),
			points: points.map(([x, y]) => [round(x - startX), round(y - startY)]),
			roundness: part.smooth ? { type: 2 } : null,
			lastCommittedPoint: null,
			startBinding: null,
			endBinding: null,
			startArrowhead: null,
			endArrowhead: part.kind === "arrow" ? "arrow" : null,
			...(part.kind === "arrow" ? { elbowed: false } : {}),
		};
	});
}
