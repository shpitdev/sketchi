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

/**
 * Stored width of a label wrapped by `wrapTextToWidth`. A line wider than
 * `maxWidth` holds a word that must not break, and Excalidraw re-wraps unbound
 * text to its stored width on edit, so the box holds the whole estimate.
 */
export function wrappedLabelWidth(text: string, fontSize: number, maxWidth: number): number {
	return Math.max(
		boundLabelWidth(text, fontSize, maxWidth),
		Math.ceil(estimateTextWidth(text, fontSize)),
	);
}

/**
 * Widest word kept whole on an oversized line. Latin words and identifiers up to
 * this width never break, so their label box grows instead; longer tokens such
 * as URLs break at deliberate boundaries.
 */
export const LONG_WORD_UNITS = 24 * DEFAULT_GLYPH_UNITS;

/** Wide glyphs and emoji are break opportunities on both sides. */
function breaksAround(cluster: string): boolean {
	return clusterUnits(cluster) > DEFAULT_GLYPH_UNITS;
}

/** Runs of unbreakable clusters, with each wide glyph or emoji standing alone. */
function wordAtoms(word: string): string[] {
	const atoms: string[] = [];
	let run = "";
	for (const cluster of clusters(word)) {
		if (!breaksAround(cluster)) {
			run += cluster;
			continue;
		}
		if (run) atoms.push(run);
		atoms.push(cluster);
		run = "";
	}
	if (run) atoms.push(run);
	return atoms;
}

/** Pieces ending after `/ - _ .` or before a lower-to-upper camelCase step. */
function tokenPieces(token: string): string[] {
	return token.split(/(?<=[/\-_.])(?=.)|(?<=\p{Ll})(?=\p{Lu})/u);
}

function splitClusters(text: string, maxUnits: number): string[] {
	const chunks: string[] = [];
	let current = "";
	let currentUnits = 0;
	for (const cluster of clusters(text)) {
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

/** An unbreakable run too wide for a line: whole when it fits the long-word bound. */
function splitToken(token: string, maxUnits: number): string[] {
	const bound = Math.max(maxUnits, LONG_WORD_UNITS);
	if (textLineUnits(token) <= bound) return [token];
	return tokenPieces(token).flatMap((piece) =>
		textLineUnits(piece) <= bound ? [piece] : splitClusters(piece, maxUnits),
	);
}

/**
 * A space-free word wider than a line breaks only between wide glyphs or emoji
 * (the correct opportunity for unspaced CJK) and, for very long tokens, at
 * deliberate boundaries; Latin words stay whole.
 */
function splitLongWord(word: string, maxUnits: number): string[] {
	const pieces = wordAtoms(word).flatMap((atom) =>
		textLineUnits(atom) > maxUnits ? splitToken(atom, maxUnits) : [atom],
	);
	const lines: string[] = [];
	let current = "";
	for (const piece of pieces) {
		if (textLineUnits(piece) > maxUnits) {
			if (current) lines.push(current);
			lines.push(piece);
			current = "";
			continue;
		}
		if (current && textLineUnits(current + piece) > maxUnits) {
			lines.push(current);
			current = "";
		}
		current += piece;
	}
	if (current) lines.push(current);
	return lines;
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
 * Greedy word wrap at spaces. A word wider than a line keeps its Latin runs
 * whole up to `LONG_WORD_UNITS`, so the line (and the box sized from it) grows
 * past `maxUnits`; wide glyphs and emoji break between clusters.
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
