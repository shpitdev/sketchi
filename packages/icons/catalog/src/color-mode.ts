import type { MarkPixels } from "./mark-features.js";

/**
 * How a mark meets light and dark surfaces, measured from its pixels drawn on
 * a transparent canvas.
 *
 * - `mono-dark`: neutral (black or gray) ink, mostly darker than mid-tone.
 * - `mono-light`: neutral ink, mostly lighter than mid-tone.
 * - `multicolor`: brand colors, never recolored.
 */
export type IconColorMode = "mono-dark" | "mono-light" | "multicolor";

/**
 * What keeps a mark visible on a surface it would blend into: `invert` (a
 * neutral mark only, so no brand color changes) or a neutral `plate` behind
 * it (a multicolor mark, whose artwork is never touched).
 */
export type IconSurfaceTreatment = "invert" | "plate";

export interface IconColor {
	readonly colorMode: IconColorMode;
	readonly onDark?: IconSurfaceTreatment;
	readonly onLight?: IconSurfaceTreatment;
}

const COLOR_MODES: readonly unknown[] = [
	"mono-dark",
	"mono-light",
	"multicolor",
] satisfies IconColorMode[];

/** Whether a record carries a valid classification: a neutral mark is only inverted, a multicolor one only plated. */
export function isIconColor(value: Readonly<Record<string, unknown>>): boolean {
	const treatment: IconSurfaceTreatment = value["colorMode"] === "multicolor" ? "plate" : "invert";
	return (
		COLOR_MODES.includes(value["colorMode"]) &&
		[value["onDark"], value["onLight"]].every(
			(surface) => surface === undefined || surface === treatment,
		)
	);
}

/** The surfaces a mark is judged against: the darkest and lightest backgrounds it meets. */
export const ICON_SURFACES = Object.freeze({ dark: "#1e1e1e", light: "#ffffff" });

/** Pixels this opaque or more are the mark's body; fainter ones are edges and shadows. */
const BODY_ALPHA = 128;
/** A pixel whose channels spread less than this is neutral (gray, black, white). */
const NEUTRAL_CHROMA = 36;
/** Below this share of colored body pixels, color is anti-aliasing or a speck. */
const MAX_COLORED_SHARE = 0.04;
/** A color this close to a surface (CIE76 Lab distance) blends into it... */
const BLEND_DISTANCE = 25;
/**
 * ...and so does one with less luminance contrast (WCAG ratio) than this
 * against a dark surface, where deep colors lose their hue: dark navy reads as
 * black. On a light surface a saturated light color (yellow) still reads.
 */
const DARK_BLEND_CONTRAST = 1.75;
/** A mark needs treatment on a surface when more of what it shows than this blends in. */
const MAX_BLENDED_SHARE = 0.4;
/** Colors closer than this (Lab distance) are one paint. */
const SAME_PAINT = 12;
/** A backdrop is one paint around at least this share of the outline... */
const BACKDROP_OUTLINE = 0.85;
/** ...filling at least this share of the mark's box (a circle fills 0.79). */
const BACKDROP_FILL = 0.7;
/** ...with at least this share of the body in other paint on top of it. */
const BACKDROP_CONTENT = 0.03;

type Lab = readonly [number, number, number];

function linear(value: number): number {
	const channel = value / 255;
	return channel <= 0.040_45 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function labPart(value: number): number {
	return value > 0.008_856 ? Math.cbrt(value) : 7.787 * value + 16 / 116;
}

function luminance(red: number, green: number, blue: number): number {
	return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
}

/** CIE L*a*b* (D65) of an sRGB color. */
function srgbLab(red: number, green: number, blue: number): Lab {
	const r = linear(red);
	const g = linear(green);
	const b = linear(blue);
	const x = labPart((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.950_47);
	const y = labPart(0.2126 * r + 0.7152 * g + 0.0722 * b);
	const z = labPart((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.088_83);
	return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

function labDistance(left: Lab, right: Lab): number {
	return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}

function contrast(left: number, right: number): number {
	return (Math.max(left, right) + 0.05) / (Math.min(left, right) + 0.05);
}

interface Surface {
	readonly lab: Lab;
	readonly luminance: number;
	/** Luminance contrast below which a color blends in regardless of hue. */
	readonly minContrast: number;
}

function surface(color: string, minContrast: number): Surface {
	const value = Number.parseInt(color.slice(1, 7), 16);
	const rgb = [(value >> 16) & 255, (value >> 8) & 255, value & 255] as const;
	return { lab: srgbLab(...rgb), luminance: luminance(...rgb), minContrast };
}

const SURFACES = {
	dark: surface(ICON_SURFACES.dark, DARK_BLEND_CONTRAST),
	light: surface(ICON_SURFACES.light, 1),
};

interface Paint {
	readonly lab: Lab;
	readonly luminance: number;
	readonly neutral: boolean;
}

/** The mark's opaque pixels, indexed both ways against the canvas grid. */
interface Body {
	readonly width: number;
	readonly height: number;
	/** Body index of each canvas pixel, -1 off the mark. */
	readonly at: Int32Array;
	/** Canvas index of each body pixel. */
	readonly cell: Int32Array;
	/** Paint index of each body pixel; flat artwork repeats a few colors. */
	readonly paint: Int32Array;
	readonly paints: readonly Paint[];
	/** 1 where a body pixel touches the transparent space around the mark. */
	readonly outline: Uint8Array;
	readonly boxArea: number;
}

function blends(paint: Paint, against: Surface): boolean {
	return (
		labDistance(paint.lab, against.lab) < BLEND_DISTANCE ||
		contrast(paint.luminance, against.luminance) < against.minContrast
	);
}

/** Calls `visit` with the body index of each body pixel beside body pixel `index`. */
function eachNeighbor(body: Body, index: number, visit: (neighbor: number) => void): void {
	const cell = body.cell[index] ?? 0;
	const x = cell % body.width;
	const cells = [
		x > 0 ? cell - 1 : -1,
		x < body.width - 1 ? cell + 1 : -1,
		cell - body.width,
		cell + body.width,
	];
	for (const neighbor of cells) {
		const at = neighbor < 0 || neighbor >= body.at.length ? -1 : (body.at[neighbor] ?? -1);
		if (at !== -1) visit(at);
	}
}

function measureBody(pixels: MarkPixels): Body {
	const { data, width, height } = pixels;
	const size = width * height;
	const opaque = (index: number) => (data[index * 4 + 3] ?? 0) >= BODY_ALPHA;
	// Transparent space reachable from the canvas edge; holes inside the mark are not outside.
	const outside = new Uint8Array(size);
	const queue: number[] = [];
	const visit = (index: number) => {
		if (outside[index] === 0 && !opaque(index)) {
			outside[index] = 1;
			queue.push(index);
		}
	};
	for (let x = 0; x < width; x += 1) {
		visit(x);
		visit((height - 1) * width + x);
	}
	for (let y = 0; y < height; y += 1) {
		visit(y * width);
		visit(y * width + width - 1);
	}
	while (queue.length > 0) {
		const index = queue.pop() ?? 0;
		const x = index % width;
		if (x > 0) visit(index - 1);
		if (x < width - 1) visit(index + 1);
		if (index >= width) visit(index - width);
		if (index < size - width) visit(index + width);
	}
	const at = new Int32Array(size).fill(-1);
	const cells: number[] = [];
	for (let index = 0; index < size; index += 1) {
		if (opaque(index)) at[index] = cells.push(index) - 1;
	}
	const cell = Int32Array.from(cells);
	const paint = new Int32Array(cells.length);
	const outline = new Uint8Array(cells.length);
	const paints: Paint[] = [];
	const paintIds = new Map<number, number>();
	let minX = width;
	let minY = height;
	let maxX = -1;
	let maxY = -1;
	cells.forEach((index, bodyIndex) => {
		const red = data[index * 4] ?? 0;
		const green = data[index * 4 + 1] ?? 0;
		const blue = data[index * 4 + 2] ?? 0;
		const key = (red << 16) | (green << 8) | blue;
		let id = paintIds.get(key);
		if (id === undefined) {
			id =
				paints.push({
					lab: srgbLab(red, green, blue),
					luminance: luminance(red, green, blue),
					neutral: Math.max(red, green, blue) - Math.min(red, green, blue) < NEUTRAL_CHROMA,
				}) - 1;
			paintIds.set(key, id);
		}
		paint[bodyIndex] = id;
		const x = index % width;
		const y = (index - x) / width;
		outline[bodyIndex] =
			x === 0 ||
			y === 0 ||
			x === width - 1 ||
			y === height - 1 ||
			outside[index - 1] === 1 ||
			outside[index + 1] === 1 ||
			outside[index - width] === 1 ||
			outside[index + width] === 1
				? 1
				: 0;
		minX = Math.min(minX, x);
		maxX = Math.max(maxX, x);
		minY = Math.min(minY, y);
		maxY = Math.max(maxY, y);
	});
	return {
		width,
		height,
		at,
		cell,
		paint,
		paints,
		outline,
		boxArea: (maxX - minX + 1) * (maxY - minY + 1),
	};
}

/**
 * Which paints form a backdrop the mark sits on (an app tile, a badge), or
 * undefined. A backdrop that blends into a surface leaves what is drawn on
 * it, which is what has to stay visible there.
 */
function backdropPaints(body: Body): readonly boolean[] | undefined {
	const total = body.cell.length;
	if (total < BACKDROP_FILL * body.boxArea) return undefined;
	const outlineCounts = Array.from({ length: body.paints.length }, () => 0);
	let outlineTotal = 0;
	body.outline.forEach((edge, index) => {
		if (edge === 0) return;
		const id = body.paint[index] ?? 0;
		outlineCounts[id] = (outlineCounts[id] ?? 0) + 1;
		outlineTotal += 1;
	});
	const commonest = outlineCounts.indexOf(Math.max(...outlineCounts));
	const main = body.paints[commonest];
	if (!main) return undefined;
	const onBackdrop = body.paints.map((paint) => labDistance(paint.lab, main.lab) < SAME_PAINT);
	const outlineOnBackdrop = outlineCounts.reduce(
		(sum, count, id) => sum + (onBackdrop[id] ? count : 0),
		0,
	);
	if (outlineOnBackdrop < BACKDROP_OUTLINE * outlineTotal) return undefined;
	let content = 0;
	for (const id of body.paint) if (!onBackdrop[id]) content += 1;
	return content >= BACKDROP_CONTENT * total ? onBackdrop : undefined;
}

/**
 * Share of what the mark shows on a surface that is lost in it: paint that
 * blends into the surface and reaches the mark's edge. Paint enclosed by
 * other paint (a white leaf inside a green disc) still reads, as the surface
 * showing through a hole would.
 */
function lostShare(body: Body, backdrop: readonly boolean[] | undefined, against: Surface): number {
	const blendingPaint = body.paints.map((paint) => blends(paint, against));
	const backdropId = backdrop?.indexOf(true) ?? -1;
	// A backdrop that stands out carries everything drawn on it.
	if (backdrop && backdropId !== -1 && !blendingPaint[backdropId]) return 0;
	// A backdrop that blends in is part of the surface; what sits on it is the mark.
	const surfaceLike = (index: number) => backdrop?.[body.paint[index] ?? 0] === true;
	const blended = (index: number) =>
		!surfaceLike(index) && blendingPaint[body.paint[index] ?? 0] === true;
	const lost = new Uint8Array(body.cell.length);
	const queue: number[] = [];
	let shown = 0;
	for (let index = 0; index < body.cell.length; index += 1) {
		if (surfaceLike(index)) continue;
		shown += 1;
		if (!blended(index)) continue;
		let edge = body.outline[index] === 1;
		if (!edge && backdrop) {
			eachNeighbor(body, index, (neighbor) => {
				if (surfaceLike(neighbor)) edge = true;
			});
		}
		if (edge) {
			lost[index] = 1;
			queue.push(index);
		}
	}
	let count = queue.length;
	while (queue.length > 0) {
		eachNeighbor(body, queue.pop() ?? 0, (neighbor) => {
			if (lost[neighbor] === 0 && blended(neighbor)) {
				lost[neighbor] = 1;
				count += 1;
				queue.push(neighbor);
			}
		});
	}
	return count / Math.max(shown, 1);
}

/** Classify a mark from its pixels; undefined when it draws nothing opaque. */
export function iconColor(pixels: MarkPixels): IconColor | undefined {
	const body = measureBody(pixels);
	const total = body.cell.length;
	if (total === 0) return undefined;
	let colored = 0;
	let darker = 0;
	for (const id of body.paint) {
		const paint = body.paints[id];
		if (!paint) continue;
		if (!paint.neutral) colored += 1;
		if (labDistance(paint.lab, SURFACES.dark.lab) < labDistance(paint.lab, SURFACES.light.lab)) {
			darker += 1;
		}
	}
	const mono = colored / total < MAX_COLORED_SHARE;
	const backdrop = backdropPaints(body);
	const lostOnDark = lostShare(body, backdrop, SURFACES.dark);
	const lostOnLight = lostShare(body, backdrop, SURFACES.light);
	const treatment: IconSurfaceTreatment = mono ? "invert" : "plate";
	// A mark lost on both surfaces is treated only where it loses more: a plate
	// or an inversion that rescues one half would hide the other.
	return {
		colorMode: mono ? (darker / total >= 0.5 ? "mono-dark" : "mono-light") : "multicolor",
		...(lostOnDark > MAX_BLENDED_SHARE && lostOnDark >= lostOnLight ? { onDark: treatment } : {}),
		...(lostOnLight > MAX_BLENDED_SHARE && lostOnLight > lostOnDark ? { onLight: treatment } : {}),
	};
}
