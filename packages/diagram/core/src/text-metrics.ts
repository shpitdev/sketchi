/**
 * Deterministic label metrics shared by layout, validation, and the Excalidraw
 * adapter. Widths are integer hundredths of an em per grapheme cluster, so
 * wrapping never depends on floating-point accumulation. The estimates are
 * calibrated against Excalidraw's own Excalifont/Xiaolai measurement in
 * Chromium and err wide: an estimate below the painted width clips glyphs,
 * because Excalidraw draws bound text into a canvas sized from the element's
 * stored width.
 */

/**
 * Average Latin glyph advance: lowercase Excalifont paints at ~0.52em and
 * capitals at ~0.68em, so mixed text keeps headroom.
 */
export const DEFAULT_GLYPH_UNITS = 62;
/** CJK ideographs, kana, Hangul, and fullwidth forms paint at a full em. */
const WIDE_GLYPH_UNITS = 100;
/** Color emoji paint at ~1.25em in Chromium. */
const EMOJI_GLYPH_UNITS = 130;

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * Clusters that paint as color emoji: emoji-presentation characters, anything
 * forced to emoji presentation with VS16, flags, and keycaps. Text-presentation
 * symbols such as © ™ ✔ ⚠ ➡ paint as ordinary glyphs.
 */
const EMOJI_CLUSTER = /\p{Emoji_Presentation}|\uFE0F|\p{Regional_Indicator}|\u20E3/u;
// Variation selectors lead the class so none reads as combining with a neighbor.
const ZERO_WIDTH_CLUSTER = /^[\uFE00-\uFE0F\u200B-\u200D\u2060]+$/u;

function isWide(codePoint: number): boolean {
	return (
		(codePoint >= 0x1100 && codePoint <= 0x115f) ||
		(codePoint >= 0x2e80 && codePoint <= 0x303e) ||
		(codePoint >= 0x3041 && codePoint <= 0x33ff) ||
		(codePoint >= 0x3400 && codePoint <= 0x4dbf) ||
		(codePoint >= 0x4e00 && codePoint <= 0x9fff) ||
		(codePoint >= 0xa000 && codePoint <= 0xa4cf) ||
		(codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
		(codePoint >= 0xf900 && codePoint <= 0xfaff) ||
		(codePoint >= 0xfe30 && codePoint <= 0xfe4f) ||
		(codePoint >= 0xff00 && codePoint <= 0xff60) ||
		(codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
		(codePoint >= 0x20000 && codePoint <= 0x3fffd)
	);
}

function clusters(text: string): string[] {
	return Array.from(graphemes.segment(text), (entry) => entry.segment);
}

function clusterUnits(cluster: string): number {
	if (ZERO_WIDTH_CLUSTER.test(cluster)) {
		return 0;
	}
	if (EMOJI_CLUSTER.test(cluster)) {
		return EMOJI_GLYPH_UNITS;
	}
	return isWide(cluster.codePointAt(0) ?? 0) ? WIDE_GLYPH_UNITS : DEFAULT_GLYPH_UNITS;
}

/** Estimated advance of one line in hundredths of an em. */
export function textLineUnits(line: string): number {
	return clusters(line).reduce((units, cluster) => units + clusterUnits(cluster), 0);
}

function lineWidth(line: string, fontSize: number): number {
	let defaultClusters = 0;
	let otherUnits = 0;
	for (const cluster of clusters(line)) {
		const units = clusterUnits(cluster);
		if (units === DEFAULT_GLYPH_UNITS) {
			defaultClusters += 1;
		} else {
			otherUnits += units;
		}
	}
	// Default-width glyphs keep the historical n * fontSize * 0.62 expression,
	// so Latin-only layouts stay byte-identical.
	return defaultClusters * fontSize * (DEFAULT_GLYPH_UNITS / 100) + (otherUnits * fontSize) / 100;
}

/** Estimated width in pixels of the widest line. */
export function estimateTextWidth(text: string, fontSize: number): number {
	return Math.max(...text.split("\n").map((line) => lineWidth(line, fontSize)));
}

/**
 * Stored width of a centered bound label. Excalidraw pads each text canvas by
 * half the font size on both sides, so the box may stay at `maxWidth` while the
 * estimate fits within that padding; past it the box grows so no glyph clips.
 */
export function boundLabelWidth(text: string, fontSize: number, maxWidth: number): number {
	const estimate = estimateTextWidth(text, fontSize);
	return Math.max(1, Math.min(maxWidth, Math.ceil(estimate)), Math.ceil(estimate - fontSize));
}

function splitLongWord(word: string, maxUnits: number): string[] {
	const chunks: string[] = [];
	let current = "";
	let currentUnits = 0;
	for (const cluster of clusters(word)) {
		const units = clusterUnits(cluster);
		if (current && currentUnits + units > maxUnits) {
			chunks.push(current);
			current = "";
			currentUnits = 0;
		}
		current += cluster;
		currentUnits += units;
	}
	if (current) {
		chunks.push(current);
	}
	return chunks;
}

function wrapLine(line: string, maxUnits: number): string[] {
	if (textLineUnits(line) <= maxUnits) {
		return [line];
	}

	const wrapped: string[] = [];
	let current = "";

	for (const word of line.split(" ")) {
		if (textLineUnits(word) > maxUnits) {
			if (current) {
				wrapped.push(current);
				current = "";
			}
			wrapped.push(...splitLongWord(word, maxUnits));
			continue;
		}

		const candidate = current ? `${current} ${word}` : word;
		if (textLineUnits(candidate) <= maxUnits) {
			current = candidate;
			continue;
		}

		wrapped.push(current);
		current = word;
	}

	if (current) {
		wrapped.push(current);
	}

	return wrapped;
}

/**
 * Greedy word wrap at spaces; words wider than a line break between grapheme
 * clusters, which is also the correct break opportunity for unspaced CJK text.
 */
export function wrapTextToUnits(text: string, maxUnits: number): string {
	return text
		.split("\n")
		.flatMap((line) => wrapLine(line, maxUnits))
		.join("\n");
}

export function wrapTextToWidth(text: string, maxWidth: number, fontSize: number): string {
	return wrapTextToUnits(text, Math.floor((maxWidth * 100) / fontSize + 1e-6));
}
