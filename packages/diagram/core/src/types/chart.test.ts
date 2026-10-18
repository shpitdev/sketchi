import { describe, expect, it } from "vitest";

import {
	CHART_MAX_CATEGORIES,
	CHART_MAX_PIE_SLICES,
	chartFixture,
	ChartValidationError,
	parseChartDiagram,
	type ChartValidationIssue,
} from "./chart.js";

const bar = {
	id: "revenue",
	title: "Revenue",
	type: "chart",
	kind: "bar",
	categories: ["Q1", "Q2", "Q3"],
	series: [
		{ name: "2025", values: [1, 2, 3] },
		{ name: "2026", values: [2, -1, 4] },
	],
};
const pie = {
	id: "share",
	title: "Share",
	type: "chart",
	kind: "pie",
	categories: ["A", "B", "C"],
	series: [{ values: [50, 30, 20] }],
};

/** The semantic issues a decodable chart fails with. */
function issuesOf(input: object): readonly ChartValidationIssue[] {
	try {
		parseChartDiagram(input);
		return [];
	} catch (error) {
		if (error instanceof ChartValidationError) return error.issues;
		throw error;
	}
}

describe("canonical chart", () => {
	it("accepts bars with negative values, pies, donuts and line charts", () => {
		expect(parseChartDiagram(bar).series[1]?.values).toEqual([2, -1, 4]);
		expect(parseChartDiagram({ ...pie, donut: true }).donut).toBe(true);
		expect(parseChartDiagram({ ...bar, kind: "line" }).kind).toBe("line");
		expect(parseChartDiagram({ ...bar, stacked: true, orientation: "horizontal" }).stacked).toBe(
			true,
		);
		expect(parseChartDiagram(chartFixture)).toEqual(chartFixture);
	});

	it("lets a single series go unnamed", () => {
		expect(
			parseChartDiagram({ ...bar, series: [{ values: [1, 2, 3] }] }).series[0]?.name,
		).toBeUndefined();
	});

	it.each([
		[
			"a series without one value per category",
			{ ...bar, series: [{ name: "a", values: [1, 2] }] },
			"chart_series_mismatch",
		],
		[
			"a repeated category",
			{ ...bar, categories: ["Q1", "q1 ", "Q3"] },
			"duplicate_chart_category",
		],
		[
			"unnamed series among several",
			{ ...bar, series: [{ values: [1, 2, 3] }, { name: "b", values: [1, 2, 3] }] },
			"invalid_chart_series",
		],
		[
			"a repeated series name",
			{
				...bar,
				series: [
					{ name: "a", values: [1, 2, 3] },
					{ name: "A", values: [1, 2, 3] },
				],
			},
			"invalid_chart_series",
		],
		[
			"a pie with two series",
			{
				...pie,
				series: [
					{ name: "a", values: [1, 2, 3] },
					{ name: "b", values: [1, 2, 3] },
				],
			},
			"invalid_chart_series",
		],
		["a negative pie slice", { ...pie, series: [{ values: [5, -1, 2] }] }, "invalid_chart_value"],
		[
			"a pie with no positive slice",
			{ ...pie, series: [{ values: [0, 0, 0] }] },
			"invalid_chart_value",
		],
		["stacked lines", { ...bar, kind: "line", stacked: true }, "invalid_chart_option"],
		["a donut bar chart", { ...bar, donut: true }, "invalid_chart_option"],
		[
			"a horizontal line chart",
			{ ...bar, kind: "line", orientation: "horizontal" },
			"invalid_chart_option",
		],
		["a pie with an axis title", { ...pie, valueAxisTitle: "Share" }, "invalid_chart_option"],
		[
			"too many pie slices",
			{
				...pie,
				categories: Array.from({ length: CHART_MAX_PIE_SLICES + 1 }, (_, i) => `S${i}`),
				series: [{ values: Array.from({ length: CHART_MAX_PIE_SLICES + 1 }, () => 1) }],
			},
			"chart_too_large",
		],
		[
			"too many categories",
			{
				...bar,
				categories: Array.from({ length: CHART_MAX_CATEGORIES + 1 }, (_, i) => `C${i}`),
				series: [{ values: Array.from({ length: CHART_MAX_CATEGORIES + 1 }, () => 1) }],
			},
			"chart_too_large",
		],
		[
			"too many series",
			{
				...bar,
				series: Array.from({ length: 7 }, (_, i) => ({ name: `S${i}`, values: [1, 2, 3] })),
			},
			"chart_too_large",
		],
		[
			"too many values",
			{
				...bar,
				categories: Array.from({ length: 25 }, (_, i) => `C${i}`),
				series: Array.from({ length: 5 }, (_, i) => ({
					name: `S${i}`,
					values: Array.from({ length: 25 }, () => 1),
				})),
			},
			"chart_too_large",
		],
	])("rejects %s with a repair hint", (_, input, code) => {
		const issue = issuesOf(input).find((entry) => entry.code === code);
		expect(issue?.hint.length).toBeGreaterThan(10);
	});

	it.each([
		{ ...bar, series: [{ name: "a", values: [1, Number.NaN, 3] }] },
		{ ...bar, categories: [] },
		{ ...bar, series: [] },
		{ ...bar, kind: "area" },
		{ ...bar, categories: ["Q1", "", "Q3"] },
	])("rejects malformed input at the schema", (input) => {
		expect(() => parseChartDiagram(input)).toThrow(Error);
	});

	it("accepts stacked: false and other neutral options on any kind", () => {
		expect(parseChartDiagram({ ...pie, stacked: false, donut: false }).kind).toBe("pie");
	});
});
