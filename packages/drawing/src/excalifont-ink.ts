/**
 * Where Excalifont actually paints a one-line word, for checks that must know
 * whether a word clears a shape. The layout estimates in `text-metrics` keep a
 * uniform advance that errs wide; this measures each printable ASCII glyph.
 */

import { textLineUnits } from "./text-metrics.js";

/**
 * Printable ASCII glyphs in thousandths of an em: advance, then the painted
 * ink's left and right edges from the pen position and its top and bottom
 * from the baseline (up is negative). Measured from the Excalifont faces
 * Excalidraw 0.18 ships, drawn by resvg; `tools/icon-batch` holds the check.
 */
export const EXCALIFONT_GLYPHS: Readonly<
	Record<string, readonly [number, number, number, number, number]>
> = {
	"0": [664, 61, 608, -725, 32],
	"1": [427, 25, 347, -681, 18],
	"2": [700, 29, 658, -682, 20],
	"3": [608, 25, 539, -679, 4],
	"4": [585, 35, 526, -727, 38],
	"5": [618, 34, 585, -687, 36],
	"6": [640, 34, 560, -743, 23],
	"7": [558, 10, 524, -707, 47],
	"8": [636, 33, 587, -672, 25],
	"9": [629, 49, 566, -678, 22],
	" ": [400, 0, 0, 0, 0],
	"!": [314, 40, 294, -718, 83],
	'"': [371, 70, 332, -758, -472],
	"#": [783, 29, 751, -710, 22],
	$: [721, 26, 674, -901, 160],
	"%": [928, 42, 886, -704, 119],
	"&": [718, 51, 683, -761, 33],
	"'": [218, 70, 179, -744, -458],
	"(": [441, 47, 402, -799, 200],
	")": [402, 40, 351, -796, 200],
	"*": [525, 31, 479, -705, -262],
	"+": [550, 30, 520, -525, -61],
	",": [257, 38, 179, -156, 254],
	"-": [411, 20, 385, -316, -212],
	".": [274, 68, 225, -122, 38],
	"/": [561, 5, 558, -798, 169],
	":": [264, 70, 194, -440, 9],
	";": [298, 43, 233, -433, 218],
	"<": [550, 49, 475, -642, 4],
	"=": [550, 31, 508, -447, -106],
	">": [550, 59, 507, -617, -6],
	"?": [466, 11, 464, -682, 8],
	"@": [829, 51, 824, -591, 206],
	A: [676, 3, 632, -719, 52],
	B: [761, 16, 720, -764, 65],
	C: [629, 33, 570, -645, 2],
	D: [780, 17, 734, -717, 35],
	E: [707, 50, 661, -633, 13],
	F: [661, 44, 663, -709, 17],
	G: [780, 13, 725, -653, 43],
	H: [573, 45, 528, -646, 87],
	I: [545, 30, 513, -639, 30],
	J: [569, 13, 517, -657, 3],
	K: [613, 47, 611, -651, 40],
	L: [543, 15, 533, -660, 17],
	M: [766, 22, 733, -641, 75],
	N: [632, 32, 610, -720, 46],
	O: [767, 28, 727, -649, -2],
	P: [698, 65, 679, -700, 24],
	Q: [768, 37, 769, -658, 141],
	R: [736, 75, 692, -714, 3],
	S: [622, 10, 588, -674, -2],
	T: [857, 3, 852, -607, 28],
	U: [730, 47, 682, -615, 7],
	V: [592, 24, 596, -626, 31],
	W: [786, 60, 766, -640, 15],
	X: [628, 37, 603, -583, 107],
	Y: [564, 45, 567, -642, 61],
	Z: [832, 20, 804, -597, 74],
	"[": [472, 55, 448, -805, 202],
	"\\": [589, 3, 585, -773, 174],
	"]": [497, 39, 443, -804, 201],
	"^": [510, 39, 470, -699, -371],
	_: [670, 10, 660, -49, 108],
	"`": [600, 185, 427, -644, -464],
	a: [576, 38, 558, -374, 9],
	b: [555, 54, 514, -749, 14],
	c: [504, 35, 489, -417, 1],
	d: [605, 42, 571, -785, 19],
	e: [537, 31, 515, -416, 70],
	f: [497, -2, 476, -781, 11],
	g: [555, 43, 519, -378, 375],
	h: [567, 54, 523, -801, 22],
	i: [244, 18, 187, -594, 9],
	j: [328, -88, 287, -583, 376],
	k: [533, 50, 496, -778, 18],
	l: [225, 52, 170, -825, 20],
	m: [663, 60, 619, -359, 4],
	n: [526, 57, 482, -396, 3],
	o: [600, 48, 568, -399, 6],
	p: [537, 55, 500, -400, 373],
	q: [539, 41, 469, -380, 360],
	r: [412, 50, 402, -432, 23],
	s: [543, 41, 528, -455, 69],
	t: [553, 1, 497, -679, 57],
	u: [548, 49, 505, -409, 13],
	v: [525, 14, 523, -443, 8],
	w: [693, 45, 696, -428, 16],
	x: [591, 18, 572, -394, 63],
	y: [530, 50, 527, -411, 372],
	z: [572, 33, 551, -428, 27],
	"{": [504, 94, 475, -809, 228],
	"|": [299, 79, 220, -782, 198],
	"}": [544, 28, 447, -793, 209],
	"~": [669, 30, 642, -411, -184],
};

/** Excalifont's vertical metrics, which place a text element's baseline. */
const ASCENDER = 0.886;
const DESCENDER = 0.374;
/** The line height Sketchi gives single-line text. */
const LINE_HEIGHT = 1.25;
/**
 * A text element's baseline below its vertical center, in ems: Excalidraw
 * sets the baseline at the ascender plus half the line gap from the top.
 */
const BASELINE_BELOW_CENTER = ASCENDER + (LINE_HEIGHT - ASCENDER - DESCENDER) / 2 - LINE_HEIGHT / 2;

export interface InkBox {
	readonly left: number;
	readonly right: number;
	readonly top: number;
	readonly bottom: number;
}

/**
 * The painted box of a one-line word drawn centered on (0, 0), as Excalidraw
 * draws a center-aligned, middle-aligned text element: its advance centered
 * across and its line box centered down. A glyph outside printable ASCII is
 * taken at the layout estimate's advance and the font's full height.
 */
export function excalifontInkBox(text: string, fontSize: number): InkBox {
	let pen = 0;
	let left = Number.POSITIVE_INFINITY;
	let right = Number.NEGATIVE_INFINITY;
	let top = Number.POSITIVE_INFINITY;
	let bottom = Number.NEGATIVE_INFINITY;
	for (const glyph of text) {
		const measured = EXCALIFONT_GLYPHS[glyph];
		const [advance, inkLeft, inkRight, inkTop, inkBottom] = measured ?? [
			textLineUnits(glyph) * 10,
			0,
			textLineUnits(glyph) * 10,
			-ASCENDER * 1000,
			DESCENDER * 1000,
		];
		if (glyph !== " ") {
			left = Math.min(left, pen + inkLeft);
			right = Math.max(right, pen + inkRight);
			top = Math.min(top, inkTop);
			bottom = Math.max(bottom, inkBottom);
		}
		pen += advance;
	}
	if (left > right) return { left: 0, right: 0, top: 0, bottom: 0 };
	const scale = fontSize / 1000;
	const baseline = BASELINE_BELOW_CENTER * fontSize;
	return {
		left: (left - pen / 2) * scale,
		right: (right - pen / 2) * scale,
		top: baseline + top * scale,
		bottom: baseline + bottom * scale,
	};
}
