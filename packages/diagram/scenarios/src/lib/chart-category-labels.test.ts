import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseChartDiagram } from "@sketchi/diagram-core";
import { formatValue, unitParts } from "@sketchi/diagram-renderer";
import { chartScenarioChecks, chartScenarios } from "./chart-scenarios.js";
import { evaluateScenarioDiagram } from "./evaluate.js";

// Retained result.normalizedSpec from eval-20261029-094224-p40i, run 20261029-094224-7sp6.
const cloudSpend7sp6 = JSON.parse(
	readFileSync(new URL("./fixtures/chart-cloud-spend-7sp6.json", import.meta.url), "utf8"),
);
const diagram = parseChartDiagram({ ...cloudSpend7sp6, type: "chart" });
const scenario = chartScenarios.find((entry) => entry.id === "cloud-spend-pie-chart")!;
const relabel = (first: string) => ({
	...diagram,
	categories: [first, ...scenario.assertions.categories.slice(1)],
});
const failures = (candidate: typeof diagram) =>
	chartScenarioChecks(scenario, candidate)
		.filter((check) => !check.passed)
		.map((check) => check.id);

describe("chart category labels with their own values", () => {
	it("accepts the real 7sp6 spec through the full scenario evaluator", () => {
		expect(
			evaluateScenarioDiagram(scenario, diagram).checks.filter((check) => !check.passed),
		).toEqual([]);
	});

	it.each([
		"Compute — 920",
		"Compute – 920",
		"Compute - 920",
		"Compute: 920",
		"Compute (920)",
		"Compute — $920k",
		"Compute — 920 $k",
		"Compute: 920K",
		"Compute ($920k)",
		"Compute — 92%",
		"Compute: 920.0",
	])("accepts the expected name and its value or pie share: %s", (label) => {
		expect(failures(relabel(label))).toEqual([]);
	});

	it.each([
		"Compute — 921",
		"Compute — 40",
		"Compute — 4%",
		"Compute — 93%",
		"Compute — 920%",
		"Compute — 920 extra",
		"Compute extra — 920",
		"Compute — not 920",
		"Compute — 920 / 40",
		"Compute — $920M",
		"Compute — €920k",
		"Storage — 920",
		"920",
		"— 920",
		"Compute 920",
		"Compute (920",
		"Compute — 920)",
		"Compute (— 920",
		"Compute — — 920",
	])("rejects wrong values, units, names, extra words or malformed suffixes: %s", (label) => {
		expect(failures(relabel(label))).toContain("chart-category:1");
	});

	it("does not let the label substitute for the data field or its drawn share", () => {
		const wrongData = {
			...relabel("Compute — 920"),
			series: [{ values: [921, 40, 22, 11, 7] }],
		};
		expect(failures(wrongData)).toEqual(["chart-series:1"]);
		const evaluation = evaluateScenarioDiagram(scenario, wrongData);
		expect(evaluation.checks.find((check) => check.id === "chart-drawn-data")?.passed).toBe(false);
	});

	it("still checks rendered pie shares independently of the category text", () => {
		const evaluation = evaluateScenarioDiagram(scenario, relabel("Compute — 92%"));
		expect(evaluation.checks.find((check) => check.id === "chart-pie-labels")?.passed).toBe(true);
	});

	for (const other of chartScenarios) {
		it(`applies the shared rule to ${other.id}, including units and negative values`, () => {
			const input = other.expectedDiagram;
			const candidate = {
				...input,
				categories: input.categories.map(
					(name, index) =>
						`${name}: ${formatValue(other.assertions.series[0]!.values[index]!, unitParts(input.unit))}`,
				),
			};
			expect(chartScenarioChecks(other, candidate).filter((check) => !check.passed)).toEqual([]);
		});
	}

	it("preserves category order and matches values to their own category", () => {
		expect(failures({ ...diagram, categories: [...diagram.categories].reverse() })).toContain(
			"chart-category:1",
		);
	});
});
