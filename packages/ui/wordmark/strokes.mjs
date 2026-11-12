/**
 * "Sketchi", written with a thick marker: one pen path per stroke, in the order
 * the word was written. Coordinates are pen units, with the baseline near
 * y = 100. The pen in ink.mjs follows each path at a hand's pace, so these
 * points are where the hand was heading, not the exact line it left.
 *
 * - A point marked CUSP is where the pen stops and turns back.
 * - `ink` overrides perfect-freehand options for that stroke.
 * - `again` is a quicker second pass over part of the stroke: it covers the
 *   stretch between `from` and `to` (fractions of the stroke) and drifts up to
 *   `d` units off the first line.
 * - `pen` overrides the pen's top speed, `vmax`.
 */
export const CUSP = "cusp";

export const strokes = [
	// S: lands with a tick, ends in a flick, then a quick second pass over its top
	{
		path: [
			[73.8, 25],
			[69.9, 21, CUSP],
			[66.5, 12],
			[51.6, 6],
			[34.5, 10],
			[25.1, 21],
			[31, 34],
			[48.2, 45],
			[64, 56],
			[68.3, 71],
			[59.9, 87],
			[40.9, 97],
			[21.2, 98],
			[9.2, 91],
			[6.8, 86],
		],
		ink: { end: { taper: 10 } },
		again: { d: 9, from: 0.03, to: 0.55, phase: 0.22, ink: { size: 3, end: { taper: 26 } } },
	},
	// k: the stem, then the arm and leg in one move, running through the stem
	{
		path: [
			[97.3, 12.7],
			[89.7, 58.7],
			[82.3, 102.6],
		],
	},
	{
		path: [
			[126.7, 54.6],
			[105.2, 68.1],
			[82.6, 79.6, CUSP],
			[100, 86],
			[119.8, 104.6],
			[125.3, 105.7],
		],
	},
	// e: the bar first, then round
	{
		path: [
			[120.4, 82.7],
			[141.1, 79.3],
			[157.4, 75.2, CUSP],
			[154.1, 66],
			[143.5, 60.5],
			[130.1, 63.4],
			[123.1, 75.2],
			[126.6, 90.6],
			[140.2, 96],
			[158, 91.7],
		],
	},
	// t: the stem with a hook; its cross comes later
	{
		path: [
			[186.9, 28.9],
			[179.2, 62.7],
			[173.6, 92.7],
			[178.9, 102],
			[193.4, 99.7],
		],
	},
	// c
	{
		path: [
			[231.5, 57],
			[219, 51.5],
			[203.9, 53.7],
			[195.6, 67.2],
			[196.6, 84.4],
			[207.8, 94.4],
			[223, 94.3],
			[234.8, 87],
		],
	},
	// h: down, back up the stem, over the hump
	{
		path: [
			[264, 2.7],
			[256.7, 50.7],
			[249.5, 97.6, CUSP],
			[253.2, 78.7],
			[264.7, 64.9],
			[279.3, 60.1],
			[288.2, 67.3],
			[287.6, 83.3],
			[287.2, 98.3],
		],
	},
	// i
	{
		path: [
			[306, 57.1],
			[304.3, 77.1],
			[305.5, 93],
		],
	},
	// t cross, drawn last, long and fast
	{
		path: [
			[157.8, 56],
			[183.5, 51],
			[213.5, 44],
		],
		pen: { vmax: 3.4 },
		ink: { end: { taper: 12 } },
	},
	// i dot: a small, slow scribble
	{
		path: [
			[313, 43],
			[316, 40],
			[318.6, 43],
			[314.2, 45],
			[313.1, 42],
		],
		pen: { vmax: 1.2 },
	},
];
