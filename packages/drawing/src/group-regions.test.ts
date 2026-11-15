import { describe, expect, it } from "vitest";

import {
	CANVAS_FRAME_NAME,
	canvasFrameNameBox,
	canvasFrameNameWidth,
	canvasGroupIconBox,
} from "./group-regions";

/** Helvetica advance widths, in thousandths of an em (Adobe AFM). */
const HELVETICA: Readonly<Record<string, number>> = {
	" ": 278,
	A: 667,
	B: 667,
	C: 722,
	D: 722,
	E: 667,
	I: 278,
	K: 667,
	N: 722,
	O: 778,
	P: 667,
	R: 722,
	S: 667,
	T: 611,
	W: 944,
	d: 556,
	e: 556,
	k: 500,
	m: 833,
	o: 556,
	p: 556,
	r: 333,
	s: 500,
	t: 278,
	u: 556,
};

const helveticaWidth = (name: string) =>
	([...name].reduce((sum, glyph) => sum + HELVETICA[glyph]!, 0) * CANVAS_FRAME_NAME.fontSize) /
	1000;

describe("frame names", () => {
	it.each([
		// Painted Excalifont widths at 14 px, measured with the CLI's resvg exporter.
		["W".repeat(50), 547.4],
		["WWW NETWORK OPERATIONS AND WEB WORKERS", 359.2],
		["Customer support desk", 156.7],
	])("holds %j in Helvetica and in Excalifont", (name, excalifont) => {
		const width = canvasFrameNameWidth(name);
		expect(width).toBeGreaterThanOrEqual(helveticaWidth(name));
		expect(width).toBeGreaterThanOrEqual(excalifont);
		expect(canvasFrameNameBox({ x: 0, y: 0, width: 1, height: 1, name }).width).toBe(
			width + 2 * CANVAS_FRAME_NAME.clearance,
		);
	});

	it("puts a frame's logo inside its top-left corner", () => {
		const icon = { slug: "vercel", size: 18 };
		const bare = { type: "frame" as const, x: 100, y: 80, width: 300, height: 200 };

		expect(canvasGroupIconBox({ ...bare, icon })).toEqual({ x: 110, y: 90, width: 18, height: 18 });
		expect(canvasGroupIconBox(bare)).toBeUndefined();
	});

	it("puts a zone's logo at the start of its header strip", () => {
		const icon = { slug: "aws", size: 18 };

		expect(canvasGroupIconBox({ type: "node", x: 100, y: 80, icon })).toEqual({
			x: 112,
			y: 89,
			width: 18,
			height: 18,
		});
	});

	it("keeps a lowercase name close to its painted width", () => {
		expect(canvasFrameNameWidth("desk support routes")).toBeLessThan(
			1.4 * helveticaWidth("desk support routes"),
		);
	});
});
