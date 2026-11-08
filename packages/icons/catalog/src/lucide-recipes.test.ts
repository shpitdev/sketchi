import { describe, expect, it } from "vitest";

import { transcribeLucideIcon } from "./lucide-recipes.js";

describe("Lucide transcription", () => {
	it("draws circles, rects and lines as their own primitives", () => {
		expect(
			transcribeLucideIcon("sample", [
				["circle", { cx: "12", cy: "7", r: "4" }],
				["rect", { x: "3", y: "11", width: "18", height: "10", rx: "2" }],
				["line", { x1: "3", y1: "3", x2: "21", y2: "3" }],
				["polygon", { points: "2 2 6 2 4 5" }],
			]).parts,
		).toEqual([
			{ kind: "ellipse", cx: 12, cy: 7, rx: 4, ry: 4 },
			{ kind: "rect", x: 3, y: 11, width: 18, height: 10, rounded: true },
			{
				kind: "stroke",
				points: [
					[3, 3],
					[21, 3],
				],
			},
			{
				kind: "stroke",
				points: [
					[2, 2],
					[6, 2],
					[4, 5],
				],
				closed: true,
			},
		]);
	});

	it("draws a zero-length stroke as an ink dot", () => {
		expect(transcribeLucideIcon("dot", [["path", { d: "M6 6h.01" }]]).parts).toEqual([
			{ kind: "ellipse", cx: 6, cy: 6, rx: 1, ry: 1, fill: "ink" },
		]);
	});

	it("draws a curve as one smooth stroke and keeps its straight sides straight", () => {
		const [stroke] = transcribeLucideIcon("cup", [
			["path", { d: "M3 5V19A9 3 0 0 0 21 19V5" }],
		]).parts;
		expect(stroke).toMatchObject({ kind: "stroke", smooth: true });
		const points = stroke?.kind === "stroke" ? stroke.points : [];
		expect(points[0]).toEqual([3, 5]);
		expect(points[1]).toEqual([3, 12]);
		expect(points.at(-1)).toEqual([21, 5]);
	});

	it("squares small rounded corners, so a box draws as a sharp polyline", () => {
		const [stroke] = transcribeLucideIcon("box", [
			["path", { d: "M4 2h16a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z" }],
		]).parts;
		expect(stroke).toEqual({
			kind: "stroke",
			points: [
				[4, 2],
				[22, 2],
				[22, 22],
				[2, 22],
				[2, 2],
			],
			closed: true,
		});
	});

	it("refuses icons a recipe cannot hold", () => {
		const pins = Array.from({ length: 9 }, (_, index) => ["path", { d: `M${index} 1v2` }] as const);
		expect(() => transcribeLucideIcon("pins", pins)).toThrow("needs 9 parts");
		expect(() => transcribeLucideIcon("text", [["text", {}]])).toThrow("<text>");
	});
});
