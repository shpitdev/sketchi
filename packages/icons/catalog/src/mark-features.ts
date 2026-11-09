/**
 * What a mark looks like at a glance, from its pixels drawn on white paper:
 * where the ink is, the colors it covers most, and a coarse coverage grid.
 * The catalog keeps these for every mark so a new one can be compared with
 * the marks it most resembles. The same functions run on catalog renders
 * and in the browser on uploaded logos, so the two compare like for like.
 */

/** RGBA pixels, row-major, as canvas `ImageData` and resvg produce them. */
export interface MarkPixels {
	readonly data: ArrayLike<number>;
	readonly width: number;
	readonly height: number;
}

export interface MarkBox {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

/** A palette color and the share of inked pixels it covers, in percent. */
export type MarkColor = readonly [color: string, share: number];

export interface MarkFeatures {
	/** Inked width over height. */
	readonly aspect: number;
	/** The dominant colors, most coverage first; near-white paper excluded. */
	readonly palette: readonly MarkColor[];
	/** Ink coverage on an 8x8 grid over the mark's square, one hex digit (0-f) per cell. */
	readonly grid: string;
}

export const MARK_GRID_CELLS = 8;
/** How far a channel may stray from paper before a pixel counts as ink. */
const INK_THRESHOLD = 28;
/** Colors closer than this (RGB distance) are one palette color. */
const PALETTE_MERGE_DISTANCE = 48;
/** Colors covering less of the mark than this, in percent, are edge blends. */
const PALETTE_MIN_SHARE = 3;
const MAX_PALETTE = 6;
const MAX_SAMPLES = 40_000;

function isInk(data: ArrayLike<number>, offset: number): boolean {
	return (
		255 - (data[offset] ?? 255) > INK_THRESHOLD ||
		255 - (data[offset + 1] ?? 255) > INK_THRESHOLD ||
		255 - (data[offset + 2] ?? 255) > INK_THRESHOLD
	);
}

/** The bounding box of the ink, or undefined for a blank image. */
export function inkBox(pixels: MarkPixels): MarkBox | undefined {
	const { data, width, height } = pixels;
	let minX = width;
	let minY = height;
	let maxX = -1;
	let maxY = -1;
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			if (!isInk(data, (y * width + x) * 4)) continue;
			if (x < minX) minX = x;
			if (x > maxX) maxX = x;
			if (y < minY) minY = y;
			if (y > maxY) maxY = y;
		}
	}
	return maxX < 0
		? undefined
		: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** The square around a box, centred on it, grown by `margin` of its side on each edge. */
export function squareAround(box: MarkBox, margin = 0): MarkBox {
	const side = Math.max(box.width, box.height) * (1 + 2 * margin);
	return {
		x: box.x + box.width / 2 - side / 2,
		y: box.y + box.height / 2 - side / 2,
		width: side,
		height: side,
	};
}

function hex(value: number): string {
	return value.toString(16).padStart(2, "0");
}

export function rgbHex(red: number, green: number, blue: number): string {
	return `#${hex(red)}${hex(green)}${hex(blue)}`;
}

export function hexRgb(color: string): readonly [number, number, number] {
	const value = Number.parseInt(color.slice(1, 7), 16);
	return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export function colorDistance(left: string, right: string): number {
	const [r1, g1, b1] = hexRgb(left);
	const [r2, g2, b2] = hexRgb(right);
	return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
}

/**
 * The colors the ink covers most. Each palette color is the most common exact
 * pixel color of its cluster, so flat brand fills come back exactly and
 * anti-aliased edges fall below the share floor.
 */
export function markPalette(pixels: MarkPixels, box: MarkBox): MarkColor[] {
	const { data, width } = pixels;
	const step = Math.max(1, Math.floor(Math.sqrt((box.width * box.height) / MAX_SAMPLES)));
	const exact = new Map<number, number>();
	let total = 0;
	for (let y = box.y; y < box.y + box.height; y += step) {
		for (let x = box.x; x < box.x + box.width; x += step) {
			const offset = (y * width + x) * 4;
			if (!isInk(data, offset)) continue;
			const key =
				((data[offset] ?? 0) << 16) | ((data[offset + 1] ?? 0) << 8) | (data[offset + 2] ?? 0);
			exact.set(key, (exact.get(key) ?? 0) + 1);
			total += 1;
		}
	}
	if (total === 0) return [];
	const clusters: { color: string; count: number }[] = [];
	for (const [key, count] of [...exact.entries()].sort((left, right) => right[1] - left[1])) {
		const color = rgbHex((key >> 16) & 255, (key >> 8) & 255, key & 255);
		const near = clusters.find(
			(cluster) => colorDistance(cluster.color, color) < PALETTE_MERGE_DISTANCE,
		);
		if (near) near.count += count;
		else clusters.push({ color, count });
	}
	return clusters
		.map(({ color, count }): MarkColor => [color, Math.round((count / total) * 100)])
		.filter(([, share]) => share >= PALETTE_MIN_SHARE)
		.sort((left, right) => right[1] - left[1])
		.slice(0, MAX_PALETTE);
}

/** Ink coverage over the mark's square, cell by cell. */
export function markGrid(pixels: MarkPixels, box: MarkBox): string {
	const { data, width, height } = pixels;
	const square = squareAround(box);
	const cell = square.width / MARK_GRID_CELLS;
	let grid = "";
	for (let row = 0; row < MARK_GRID_CELLS; row += 1) {
		for (let column = 0; column < MARK_GRID_CELLS; column += 1) {
			const x0 = Math.floor(square.x + column * cell);
			const y0 = Math.floor(square.y + row * cell);
			const x1 = Math.ceil(square.x + (column + 1) * cell);
			const y1 = Math.ceil(square.y + (row + 1) * cell);
			let ink = 0;
			let seen = 0;
			const step = Math.max(1, Math.floor((x1 - x0) / 16));
			for (let y = y0; y < y1; y += step) {
				for (let x = x0; x < x1; x += step) {
					seen += 1;
					if (x >= 0 && y >= 0 && x < width && y < height && isInk(data, (y * width + x) * 4)) {
						ink += 1;
					}
				}
			}
			grid += Math.round((seen === 0 ? 0 : ink / seen) * 15).toString(16);
		}
	}
	return grid;
}

export function markFeatures(pixels: MarkPixels): MarkFeatures | undefined {
	const box = inkBox(pixels);
	if (!box) return undefined;
	return {
		aspect: Math.round((box.width / box.height) * 100) / 100,
		palette: markPalette(pixels, box),
		grid: markGrid(pixels, box),
	};
}

function paletteDistance(left: readonly MarkColor[], right: readonly MarkColor[]): number {
	if (left.length === 0 || right.length === 0) return left.length === right.length ? 0 : 1;
	const oneWay = (from: readonly MarkColor[], to: readonly MarkColor[]) => {
		const weight = from.reduce((sum, [, share]) => sum + share, 0) || 1;
		return (
			from.reduce(
				(sum, [color, share]) =>
					sum + share * Math.min(...to.map(([other]) => colorDistance(color, other))),
				0,
			) /
			weight /
			441.7
		);
	};
	return (oneWay(left, right) + oneWay(right, left)) / 2;
}

function gridDistance(left: string, right: string): number {
	let sum = 0;
	for (let index = 0; index < left.length; index += 1) {
		sum += Math.abs(
			Number.parseInt(left[index] ?? "0", 16) - Number.parseInt(right[index] ?? "0", 16),
		);
	}
	return sum / (15 * Math.max(left.length, 1));
}

/** How unlike two marks look, from 0 (the same) up: color, then layout, then proportion. */
export function markDistance(left: MarkFeatures, right: MarkFeatures): number {
	const aspect = Math.min(1, Math.abs(Math.log(left.aspect / right.aspect)) / Math.log(4));
	return (
		0.45 * paletteDistance(left.palette, right.palette) +
		0.4 * gridDistance(left.grid, right.grid) +
		0.15 * aspect
	);
}
