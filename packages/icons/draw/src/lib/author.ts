import {
	ICON_RECIPE_GRID,
	ICON_RECIPE_INK,
	ICON_RECIPE_LIMITS,
	ICON_RECIPE_PAPER,
	type IconRecipe,
	iconRecipeFitIssues,
	iconRecipeIssues,
} from "@sketchi/diagram-core";
import { colorDistance, hexRgb, normalizeCssColor, type MarkColor } from "@sketchi/icon-catalog";
import nativeIcons from "@sketchi/icon-catalog/native-icons";

/**
 * The author: a vision model that writes a recipe from the logo, sees the
 * recipe drawn, and revises it. Everything it reads before the logo is fixed,
 * so the provider caches it across requests.
 */

/** Recipes shown as worked examples: a cutout mark in ink, flat brand blocks, a filled outline with paper strokes. */
const EXAMPLES = [
	{
		slug: "github",
		source: "a black disc with the white silhouette of a cat's head and body cut out of it",
	},
	{
		slug: "slack",
		source: "four rounded bars in pink, blue, green and yellow, pinwheeled around a square gap",
	},
	{
		slug: "kubernetes",
		source: "a blue heptagon with a white ship's wheel on it",
	},
] as const;

function example(slug: string): IconRecipe {
	const recipe = nativeIcons[slug];
	if (!recipe || iconRecipeIssues(recipe).length > 0) {
		throw new Error(`The ${slug} example recipe is missing or invalid.`);
	}
	return recipe as IconRecipe;
}

export const AUTHOR_SYSTEM_PROMPT = [
	"You draw logos as small hand-drawn Excalidraw icons. An icon is a recipe: a few parts on a",
	`${ICON_RECIPE_GRID}-unit square grid, (0,0) top left to (${ICON_RECIPE_GRID},${ICON_RECIPE_GRID}) bottom right, drawn with Excalidraw's`,
	"hand-drawn pen. Diagrams show it at 28 px, the height of a line of text, so it must read at a glance there.",
	"",
	"Parts (at most 8):",
	"- rect: x, y, width, height, rounded (true for rounded corners).",
	"- ellipse: cx, cy, rx, ry.",
	`- stroke: points [[x, y], ...] (2-${ICON_RECIPE_LIMITS.maxPointsPerPart}); smooth curves through them; closed returns to the first point and can be filled.`,
	"- arrow: points, smooth; a stroke that ends in an arrowhead.",
	`- text: cx, cy, text (1-${ICON_RECIPE_LIMITS.maxTextLength} characters), size (grid units), color; a short word in the hand-drawn font, clear of the pen of any shape that frames it.`,
	"Every part but text also takes stroke (the outline color, ink when omitted; none draws only the fill, so it needs a",
	"fill), fill (omit it for an open outline) and pen (2 draws twice as bold).",
	"",
	"Colors:",
	'- "ink" is the scene\'s text color, black on a light diagram and white on a dark one. Use it for black or near-black parts,',
	"  so the mark follows the theme. A gray is not ink: paint it with its source color.",
	'- "paper" is whatever the icon sits on. Use it for holes and cutouts drawn on top of a filled shape.',
	"- Any other color must be one of the exact #rrggbb source colors you are given.",
	"",
	"What reads at 28 px:",
	"- The silhouette and the color layout carry the mark; fine detail vanishes. Draw what a person sketches from memory: the",
	"  outline, the one or two features that make the mark unmistakable, and where its colors sit.",
	"- Whole shapes and a few long strokes, not many small ones. A stroke is about 2 units wide at 28 px, and gaps under 2 units",
	"  close up, so keep cutouts and spaces wide.",
	"- A filled area is a closed stroke or a filled rect or ellipse; a cutout is a paper part on top of it; line art is strokes",
	"  without fill. Use text only when letters are the mark itself.",
	"- Center the mark and let it fill most of the grid; parts may overhang the edge by 1 unit at most.",
	"- Do not trace the outline point by point: use the fewest points that give the shape.",
	"",
	"Examples (the source, then its recipe):",
	...EXAMPLES.flatMap(({ slug, source }) => [`- ${source}:`, `  ${JSON.stringify(example(slug))}`]),
	"",
	'Reply with JSON only: {"accept": boolean, "recipe": recipe or null}. Your first reply is a draft: accept false and a',
	"recipe. After each draft you see it drawn beside the source. When the small drawing already reads as the source mark,",
	"reply accept true and recipe null. Otherwise reply accept false with the whole revised recipe.",
].join("\n");

const number = { type: "number" } as const;
const color = {
	type: "string",
	description: 'ink, paper, none (stroke only), or one of the source colors as "#rrggbb".',
} as const;
const paint = { stroke: color, fill: color, pen: { type: "integer", enum: [1, 2] } } as const;
const points = {
	type: "array",
	description: "[x, y] points on the grid.",
	items: { type: "array", items: number },
} as const;

function part(kind: string, properties: Record<string, unknown>, required: readonly string[]) {
	return {
		type: "object",
		properties: { kind: { type: "string", const: kind }, ...properties },
		required: ["kind", ...required],
		additionalProperties: false,
	};
}

/** The reply format, as a JSON schema the provider enforces. */
export const AUTHOR_REPLY_SCHEMA = {
	type: "object",
	properties: {
		accept: { type: "boolean" },
		recipe: {
			anyOf: [
				{
					type: "object",
					properties: {
						parts: {
							type: "array",
							items: {
								anyOf: [
									part(
										"rect",
										{
											x: number,
											y: number,
											width: number,
											height: number,
											rounded: { type: "boolean" },
											...paint,
										},
										["x", "y", "width", "height"],
									),
									part("ellipse", { cx: number, cy: number, rx: number, ry: number, ...paint }, [
										"cx",
										"cy",
										"rx",
										"ry",
									]),
									part(
										"stroke",
										{ points, smooth: { type: "boolean" }, closed: { type: "boolean" }, ...paint },
										["points"],
									),
									part(
										"arrow",
										{ points, smooth: { type: "boolean" }, stroke: color, pen: paint.pen },
										["points"],
									),
									part(
										"text",
										{ cx: number, cy: number, text: { type: "string" }, size: number, color },
										["cx", "cy", "text", "size"],
									),
								],
							},
						},
					},
					required: ["parts"],
					additionalProperties: false,
				},
				{ type: "null" },
			],
		},
	},
	required: ["accept", "recipe"],
	additionalProperties: false,
} as const;

/** The first turn: the logo, its name and its exact colors. */
export function draftRequestText(
	name: string,
	palette: readonly MarkColor[],
	note?: string,
): string {
	const colors = palette.length
		? palette.map(([hex, share]) => `${hex} (${share}%)`).join(", ")
		: "none besides black and white";
	return [
		`Draw the ${name} logo shown here.`,
		`Source colors, with the share of the mark each covers: ${colors}.`,
		...(note ? [`A reviewer of an earlier drawing asks: ${note}`] : []),
	].join("\n");
}

/** A review turn: the draft drawn beside the source. */
export const REVIEW_REQUEST_TEXT = [
	"Your recipe, drawn. Left: the source. Middle: your recipe at 112 px. Right: the same at 28 px, as diagrams show it.",
	"A sketch is not a copy: if someone who knows the source would name it from the 28 px drawing, accept it. Revise only",
	"for something that reads wrong there (the silhouette, a color in the wrong place, a defining feature lost or too busy",
	"to read) and send the whole recipe, still at most 8 parts.",
].join("\n");

/** A turn after the checker rejected a recipe. */
export function repairRequestText(issues: readonly string[]): string {
	return [
		"That recipe cannot be drawn:",
		...issues.slice(0, 12).map((issue) => `- ${issue}`),
		"Send the whole corrected recipe, accept false.",
	].join("\n");
}

/** A turn after a reviewer mistook the drawing for another logo. */
export function confusedRequestText(): string {
	return [
		"A reviewer shown only your 28 px drawing picked the logo on the right instead of the source on the left.",
		"Change what makes the two look alike, keep what makes the source unmistakable, and send the whole recipe.",
	].join("\n");
}

export interface AuthorReply {
	readonly accept: boolean;
	readonly recipe: unknown;
}

/** The reply's JSON, or undefined when it is not the agreed shape. */
export function decodeAuthorReply(text: string): AuthorReply | undefined {
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start < 0 || end <= start) return undefined;
	try {
		const value = JSON.parse(text.slice(start, end + 1)) as unknown;
		if (typeof value !== "object" || value === null || !("accept" in value)) return undefined;
		const { accept, recipe } = value as { accept: unknown; recipe?: unknown };
		return typeof accept === "boolean" ? { accept, recipe: recipe ?? null } : undefined;
	} catch {
		return undefined;
	}
}

// ---------------------------------------------------------------------------
// Normalization: the small slips a checker would otherwise bounce back.

/** How far a color may be from a source color and still be taken as it. */
const COLOR_SNAP_DISTANCE = 64;
const NUMBER_FIELDS = ["x", "y", "width", "height", "cx", "cy", "rx", "ry", "size"] as const;
const COLOR_FIELDS = ["stroke", "fill", "color"] as const;

function round(value: number): number {
	return Math.round(value * 100) / 100;
}

/** Pull a coordinate that strays just past the overhang back onto it. */
function clampCoordinate(value: number): number {
	const low = -ICON_RECIPE_LIMITS.overhang;
	const high = ICON_RECIPE_GRID + ICON_RECIPE_LIMITS.overhang;
	if (value < low && value >= low - 1) return low;
	if (value > high && value <= high + 1) return high;
	return value;
}

function luminance(hex: string): number {
	const [red, green, blue] = hexRgb(hex);
	return (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
}

export interface NormalizedRecipe {
	readonly recipe: IconRecipe | undefined;
	readonly issues: readonly string[];
}

/** Channel spread from which a color reads as a hue, not a gray (the catalog's own). */
const NEUTRAL_CHROMA = 36;
/** A mark is monochrome while its hues cover less than this share (the catalog's own). */
const MAX_COLORED_SHARE = 0.04;
/** Luminance halfway between the dark (#1e1e1e) and light (#ffffff) surfaces. */
const SURFACE_MIDPOINT = 0.56;
/**
 * How dark a gray must be to be a dark mark's ink (#333333 at most), and how
 * light to be a light mark's. A gray between stays the source's gray.
 */
const NEAR_BLACK = 0.2;
const NEAR_WHITE = 0.85;

function isNeutral(hex: string): boolean {
	const [red, green, blue] = hexRgb(hex);
	return Math.max(red, green, blue) - Math.min(red, green, blue) < NEUTRAL_CHROMA;
}

/** The most of a light mark that may show on white paper: past it, the mark reads there as drawn. */
const LIGHT_MARK_VISIBLE_SHARE = 0.05;

/**
 * A monochrome source's tone, from the share each color covers: `dark` for a
 * black or gray mark, `light` for a white one that would vanish on white
 * paper, undefined for a colored mark or a light one that reads on paper as it
 * is (a pale panel with gray lines). The catalog inverts a monochrome mark on
 * a surface it would vanish into, and on no other.
 */
export type SourceTone = "dark" | "light";

export function sourceTone(palette: readonly MarkColor[]): SourceTone | undefined {
	const total = palette.reduce((sum, [, share]) => sum + share, 0);
	if (total <= 0) return undefined;
	const share = (test: (hex: string) => boolean) =>
		palette.reduce((sum, [hex, part]) => (test(hex) ? sum + part : sum), 0) / total;
	if (share((hex) => !isNeutral(hex)) >= MAX_COLORED_SHARE) return undefined;
	if (share((hex) => luminance(hex) < SURFACE_MIDPOINT) >= 0.5) return "dark";
	return share((hex) => luminance(hex) < NEAR_WHITE) <= LIGHT_MARK_VISIBLE_SHARE
		? "light"
		: undefined;
}

/**
 * A monochrome mark's own gray as the scene's ink or paper, whatever the
 * source paints it with: its ink side becomes ink and the other side paper, so
 * the drawing inverts with the theme as the mark does.
 */
function toneColor(hex: string, tone: SourceTone | undefined): string | undefined {
	if (!tone || !isNeutral(hex)) return undefined;
	const value = luminance(hex);
	const dark = value <= NEAR_BLACK;
	const light = value >= NEAR_WHITE;
	if (tone === "dark") return dark ? ICON_RECIPE_INK : light ? ICON_RECIPE_PAPER : undefined;
	return light ? ICON_RECIPE_INK : dark ? ICON_RECIPE_PAPER : undefined;
}

/**
 * Round the numbers, take near-misses of a source color as that color, and
 * check the result. A monochrome mark's black and white (white and black for a
 * light mark) become ink and paper even when the source paints with them, and
 * for any mark black and white it does not use become ink and paper, which is
 * what the model meant by them.
 */
export function normalizeRecipe(
	raw: unknown,
	palette: readonly string[],
	tone?: SourceTone,
): NormalizedRecipe {
	if (
		typeof raw !== "object" ||
		raw === null ||
		!Array.isArray((raw as { parts?: unknown }).parts)
	) {
		return { recipe: undefined, issues: ["recipe must be an object with a parts array."] };
	}
	const issues: string[] = [];
	const snap = (value: string, path: string): string => {
		if (value === ICON_RECIPE_INK || value === ICON_RECIPE_PAPER || value === "none") return value;
		const hex = normalizeCssColor(value);
		if (!hex) {
			issues.push(`${path} ${JSON.stringify(value)} is not a color.`);
			return value;
		}
		const toned = toneColor(hex, tone);
		if (toned) return toned;
		if (palette.includes(hex)) return hex;
		const nearest = [...palette].sort(
			(left, right) => colorDistance(left, hex) - colorDistance(right, hex),
		)[0];
		// A near-miss snaps to the source's color, which may itself be the mark's black or white.
		if (nearest && colorDistance(nearest, hex) <= COLOR_SNAP_DISTANCE) {
			return toneColor(nearest, tone) ?? nearest;
		}
		if (luminance(hex) > 0.92) return ICON_RECIPE_PAPER;
		if (luminance(hex) < 0.12) return ICON_RECIPE_INK;
		issues.push(
			`${path} ${hex} is not a source color; use ink, paper${palette.length ? ` or one of ${palette.join(", ")}` : ""}.`,
		);
		return hex;
	};
	const parts = (raw as { parts: unknown[] }).parts.map((part, index) => {
		if (typeof part !== "object" || part === null) return part;
		const copy: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(part)) {
			if (value === null || value === undefined) continue;
			if ((NUMBER_FIELDS as readonly string[]).includes(key) && typeof value === "number") {
				copy[key] = round(
					key === "x" || key === "y" || key === "cx" || key === "cy"
						? clampCoordinate(value)
						: value,
				);
			} else if ((COLOR_FIELDS as readonly string[]).includes(key) && typeof value === "string") {
				copy[key] = snap(value.trim().toLowerCase(), `recipe.parts[${index}].${key}`);
			} else if (key === "points" && Array.isArray(value)) {
				copy[key] = value.map((point) =>
					Array.isArray(point)
						? point.map((coordinate) =>
								typeof coordinate === "number" ? round(clampCoordinate(coordinate)) : coordinate,
							)
						: point,
				);
			} else {
				copy[key] = value;
			}
		}
		// A default pen is the absence of one.
		if (copy["pen"] === 1) delete copy["pen"];
		return copy;
	});
	const recipe = { parts };
	const drawable = iconRecipeIssues(recipe);
	// A word past the grid clips in every square; one over its frame's pen is unreadable.
	const fit = drawable.length === 0 ? iconRecipeFitIssues(recipe as unknown as IconRecipe) : [];
	const checked = [...issues, ...drawable, ...fit];
	return checked.length === 0
		? { recipe: recipe as unknown as IconRecipe, issues: [] }
		: { recipe: undefined, issues: checked };
}
