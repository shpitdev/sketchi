// Subpath imports: the package entry point would ship every diagram family to a
// page that only draws icons.
import { fnv1a32 } from "@sketchi/diagram-core/hash";
import {
	ICON_RECIPE_GRID,
	ICON_RECIPE_INK,
	ICON_RECIPE_PAPER,
	type IconRecipe,
	type IconRecipePoint,
} from "@sketchi/diagram-core/icon-recipe";
import rough from "roughjs";

/** The preview's square, in SVG units. */
export const RECIPE_PREVIEW_SIZE = 96;

const SCALE = RECIPE_PREVIEW_SIZE / ICON_RECIPE_GRID;
const STROKE_WIDTH = 2.5;
const ARROWHEAD = 3 * SCALE;

export interface RecipePalette {
	readonly ink: string;
	readonly paper: string;
}

export interface RecipePreviewPath {
	readonly d: string;
	readonly fill: string;
	readonly stroke: string;
	readonly strokeWidth: number;
}

export interface RecipePreviewText {
	readonly kind: "text";
	readonly x: number;
	readonly y: number;
	readonly size: number;
	readonly text: string;
	readonly fill: string;
}

/** One recipe part's hand-drawn paths. */
export interface RecipePreviewShape {
	readonly kind: "shape";
	readonly paths: readonly RecipePreviewPath[];
}

/** The recipe's parts in recipe order, so a later part paints over an earlier one. */
export interface RecipePreview {
	readonly parts: readonly (RecipePreviewShape | RecipePreviewText)[];
}

function paint(value: string | undefined, palette: RecipePalette, fallback: string): string {
	if (value === undefined) return fallback;
	if (value === ICON_RECIPE_INK) return palette.ink;
	if (value === ICON_RECIPE_PAPER) return palette.paper;
	return value;
}

const at = ([x, y]: IconRecipePoint): [number, number] => [x * SCALE, y * SCALE];

function roundedRect(x: number, y: number, width: number, height: number): string {
	const r = Math.min(width, height) * 0.25;
	return [
		`M${x + r} ${y}`,
		`H${x + width - r}`,
		`Q${x + width} ${y} ${x + width} ${y + r}`,
		`V${y + height - r}`,
		`Q${x + width} ${y + height} ${x + width - r} ${y + height}`,
		`H${x + r}`,
		`Q${x} ${y + height} ${x} ${y + height - r}`,
		`V${y + r}`,
		`Q${x} ${y} ${x + r} ${y}`,
		"Z",
	].join(" ");
}

/**
 * The recipe as hand-drawn SVG paths, the way Excalidraw's pen draws it: the
 * same rough strokes for equal input, so a preview never jitters between renders.
 */
export function recipePreview(recipe: IconRecipe, palette: RecipePalette): RecipePreview {
	const generator = rough.generator();
	const parts: (RecipePreviewShape | RecipePreviewText)[] = [];
	recipe.parts.forEach((part, index) => {
		if (part.kind === "text") {
			const [x, y] = at([part.cx, part.cy]);
			parts.push({
				kind: "text",
				x,
				y,
				size: part.size * SCALE,
				text: part.text,
				fill: paint(part.color, palette, palette.ink),
			});
			return;
		}
		const fill = part.kind === "arrow" ? undefined : part.fill;
		const options = {
			seed: fnv1a32(`${index}:${JSON.stringify(part)}`, "seed") % 2_147_483_647 || 1,
			roughness: 0.8,
			bowing: 0.6,
			stroke: part.stroke === "none" ? "none" : paint(part.stroke, palette, palette.ink),
			strokeWidth: STROKE_WIDTH * (part.pen ?? 1),
			...(fill === undefined
				? {}
				: { fill: paint(fill, palette, palette.ink), fillStyle: "solid" as const }),
			preserveVertices: true,
		};
		const drawables = [];
		if (part.kind === "rect") {
			const [x, y] = at([part.x, part.y]);
			const width = part.width * SCALE;
			const height = part.height * SCALE;
			drawables.push(
				part.rounded
					? generator.path(roundedRect(x, y, width, height), options)
					: generator.rectangle(x, y, width, height, options),
			);
		} else if (part.kind === "ellipse") {
			const [cx, cy] = at([part.cx, part.cy]);
			drawables.push(generator.ellipse(cx, cy, part.rx * 2 * SCALE, part.ry * 2 * SCALE, options));
		} else {
			const closed = part.kind === "stroke" && part.closed;
			const points = (closed ? [...part.points, part.points[0]!] : part.points).map(at);
			drawables.push(
				part.smooth
					? generator.curve(points, options)
					: closed
						? generator.polygon(points.slice(0, -1), options)
						: generator.linearPath(points, options),
			);
			if (part.kind === "arrow" && points.length >= 2) {
				const [endX, endY] = points.at(-1)!;
				const [fromX, fromY] = points.at(-2)!;
				const angle = Math.atan2(endY - fromY, endX - fromX);
				for (const turn of [Math.PI * 0.8, -Math.PI * 0.8]) {
					drawables.push(
						generator.line(
							endX,
							endY,
							endX + ARROWHEAD * Math.cos(angle + turn),
							endY + ARROWHEAD * Math.sin(angle + turn),
							options,
						),
					);
				}
			}
		}
		parts.push({
			kind: "shape",
			paths: drawables.flatMap((drawable) =>
				generator.toPaths(drawable).map((path) => ({
					d: path.d,
					fill: path.fill ?? "none",
					stroke: path.stroke,
					strokeWidth: path.strokeWidth,
				})),
			),
		});
	});
	return { parts };
}
