import { describe, expect, it } from "vitest";

import {
	QUADRANT_MAX_POINTS,
	parseQuadrantDiagram,
	quadrantDiagramType,
	quadrantFixture,
	quadrantGroups,
	QuadrantValidationError,
	type QuadrantValidationIssue,
} from "./quadrant.js";

const chart = {
	id: "positioning",
	title: "Positioning",
	type: "quadrant",
	xAxis: { title: "Price", low: "Cheap", high: "Expensive" },
	yAxis: { title: "Quality", low: "Basic", high: "Premium" },
	quadrants: {
		topLeft: "Value leaders",
		topRight: "Premium",
		bottomLeft: "Budget",
		bottomRight: "Overpriced",
	},
	points: [
		{ label: "Acme", x: 0.2, y: 0.8, group: "Us" },
		{ label: "Globex", x: 0.7, y: 0.6, group: "Rivals" },
		{ label: "Initech", x: 0.5, y: 0.5 },
	],
};

/** The semantic issues a decodable quadrant chart fails with. */
function issuesOf(input: object): readonly QuadrantValidationIssue[] {
	try {
		parseQuadrantDiagram(input);
		return [];
	} catch (error) {
		if (error instanceof QuadrantValidationError) return error.issues;
		throw error;
	}
}

describe("canonical quadrant chart", () => {
	it("has a typed fixture that satisfies its contract", () => {
		expect(quadrantFixture.type).toBe(quadrantDiagramType);
		expect(parseQuadrantDiagram(quadrantFixture)).toEqual(quadrantFixture);
	});

	it("accepts points on the edges and the middle lines, groups and an empty matrix", () => {
		const parsed = parseQuadrantDiagram({
			...chart,
			points: [
				{ label: "Corner", x: 0, y: 1 },
				{ label: "Middle", x: 0.5, y: 0.5 },
				{ label: "Edge", x: 1, y: 0.25, group: "Rivals" },
			],
		});
		expect(parsed.points.map((point) => [point.x, point.y])).toEqual([
			[0, 1],
			[0.5, 0.5],
			[1, 0.25],
		]);
		expect(parseQuadrantDiagram({ ...chart, points: [] }).points).toEqual([]);
	});

	it("keeps zero scores, which sit on the low ends, apart from absent ones", () => {
		const parsed = parseQuadrantDiagram({ ...chart, points: [{ label: "Zero", x: 0, y: 0 }] });
		expect(parsed.points[0]).toEqual({ label: "Zero", x: 0, y: 0 });
		expect(() =>
			parseQuadrantDiagram({ ...chart, points: [{ label: "Unscored", x: 0.5 }] }),
		).toThrow(/y/u);
	});

	it("treats names like constructor and __proto__ as ordinary text", () => {
		const parsed = parseQuadrantDiagram({
			...chart,
			quadrants: { ...chart.quadrants, topLeft: "constructor" },
			points: [
				{ label: "__proto__", x: 0.2, y: 0.8, group: "constructor" },
				{ label: "constructor", x: 0.7, y: 0.3, group: "__proto__" },
				{ label: "toString", x: 0.4, y: 0.4, group: "constructor" },
			],
		});
		expect(quadrantGroups(parsed)).toEqual(["constructor", "__proto__"]);
	});

	it("lists groups once each in first-appearance order", () => {
		expect(
			quadrantGroups({
				points: [
					{ label: "a", x: 0, y: 0, group: "Rivals" },
					{ label: "b", x: 0, y: 0 },
					{ label: "c", x: 0, y: 0, group: "Us" },
					{ label: "d", x: 0, y: 0, group: "rivals " },
				],
			}),
		).toEqual(["Rivals", "Us"]);
	});

	it("never takes coordinates, sizes or a layout", () => {
		expect(() => parseQuadrantDiagram({ ...chart, quadrants: ["a", "b", "c", "d"] })).toThrow(
			/quadrants/u,
		);
		expect(() =>
			parseQuadrantDiagram({ ...chart, xAxis: { title: "Price", low: "Cheap" } }),
		).toThrow(/high/u);
		expect(Object.keys(parseQuadrantDiagram({ ...chart, width: 900 }))).not.toContain("width");
	});

	it.each([
		[
			"an x outside 0 to 1",
			{ ...chart, points: [{ label: "Acme", x: 8, y: 0.5 }] },
			"invalid_quadrant_point",
			"points.[0].x",
		],
		[
			"a negative y",
			{ ...chart, points: [{ label: "Acme", x: 0.5, y: -0.1 }] },
			"invalid_quadrant_point",
			"points.[0].y",
		],
		[
			"a repeated label",
			{
				...chart,
				points: [
					{ label: "Acme", x: 0.1, y: 0.2 },
					{ label: " acme", x: 0.3, y: 0.4 },
				],
			},
			"invalid_quadrant_point",
			"points.[1].label",
		],
		[
			"too many points",
			{
				...chart,
				points: Array.from({ length: QUADRANT_MAX_POINTS + 1 }, (_, index) => ({
					label: `Item ${index}`,
					x: 0.5,
					y: 0.5,
				})),
			},
			"quadrant_too_large",
			"points",
		],
		[
			"too many groups",
			{
				...chart,
				points: Array.from({ length: 7 }, (_, index) => ({
					label: `Item ${index}`,
					x: 0.5,
					y: 0.5,
					group: `Group ${index}`,
				})),
			},
			"quadrant_too_large",
			"points",
		],
		[
			"a label too long to place",
			{ ...chart, points: [{ label: "x".repeat(41), x: 0.5, y: 0.5 }] },
			"invalid_quadrant_text",
			"points.[0].label",
		],
		[
			"a quadrant name too long",
			{ ...chart, quadrants: { ...chart.quadrants, topRight: "y".repeat(41) } },
			"invalid_quadrant_text",
			"quadrants.topRight",
		],
		[
			"a blank label",
			{ ...chart, points: [{ label: " \n ", x: 0.5, y: 0.5 }] },
			"invalid_quadrant_text",
			"points.[0].label",
		],
		[
			"a blank quadrant name",
			{ ...chart, quadrants: { ...chart.quadrants, bottomLeft: "  " } },
			"invalid_quadrant_text",
			"quadrants.bottomLeft",
		],
		[
			"an axis end label too long",
			{ ...chart, yAxis: { ...chart.yAxis, high: "z".repeat(31) } },
			"invalid_quadrant_text",
			"yAxis.high",
		],
	] as const)("rejects %s with a repair hint", (_, input, code, path) => {
		const issues = issuesOf(input);
		expect(issues.map((issue) => [issue.code, issue.path])).toContainEqual([code, path]);
		for (const issue of issues) expect(issue.hint.length).toBeGreaterThan(10);
	});
});
