import { describe, expect, it } from "vitest";
import type { ChartDiagram } from "@sketchi/diagram-core";
import { renderDiagram } from "@sketchi/diagram-renderer";
import {
	chartClearRulesCheck,
	chartDrawnDataCheck,
	chartGeometryCheck,
	chartPieLabelCheck,
	chartScenarios,
} from "./chart-scenarios.js";
import { evaluateScenarioDiagram } from "./evaluate.js";
import { candidateFromMcpResult } from "./mcp-results.js";

const failing = (scenario: (typeof chartScenarios)[number], diagram: ChartDiagram) =>
	evaluateScenarioDiagram(scenario, diagram)
		.checks.filter((check) => !check.passed)
		.map((check) => check.id);

describe("prompt-grounded chart scenarios", () => {
	it("covers each kind three times and the variety the renderer supports", () => {
		const diagrams = chartScenarios.map((scenario) => scenario.expectedDiagram);
		for (const kind of ["bar", "line", "pie"] as const)
			expect(diagrams.filter((diagram) => diagram.kind === kind).length).toBeGreaterThanOrEqual(3);
		const values = (diagram: ChartDiagram) => diagram.series.flatMap((series) => series.values);
		expect(diagrams.some((diagram) => diagram.kind === "bar" && diagram.stacked)).toBe(true);
		expect(
			diagrams.some(
				(diagram) => diagram.kind === "bar" && !diagram.stacked && diagram.series.length > 1,
			),
		).toBe(true);
		expect(
			diagrams.some(
				(diagram) => diagram.kind === "bar" && values(diagram).some((value) => value < 0),
			),
		).toBe(true);
		expect(
			diagrams.some(
				(diagram) => diagram.kind === "line" && values(diagram).some((value) => value < 0),
			),
		).toBe(true);
		expect(
			diagrams.some((diagram) => diagram.categories.some((category) => category.length > 30)),
		).toBe(true);
		expect(diagrams.some((diagram) => diagram.categories.length >= 12)).toBe(true);
		expect(diagrams.some((diagram) => diagram.kind === "line" && diagram.series.length >= 3)).toBe(
			true,
		);
		expect(diagrams.some((diagram) => diagram.donut)).toBe(true);
		expect(
			diagrams.some((diagram) => {
				if (diagram.kind !== "pie") return false;
				const pie = values(diagram);
				const total = pie.reduce((sum, value) => sum + value, 0);
				return pie.some((value) => value / total < 0.01);
			}),
		).toBe(true);
	});

	for (const scenario of chartScenarios) {
		it(`${scenario.id}: accepts the fixture, drawn to scale`, () => {
			const evaluation = evaluateScenarioDiagram(scenario, scenario.expectedDiagram);
			expect(evaluation.checks.filter((check) => !check.passed)).toEqual([]);
			expect(evaluation.checks.some((check) => check.id === "chart-geometry")).toBe(true);
		});

		it(`${scenario.id}: rejects a wrong value, a dropped category and a renamed category`, () => {
			const input = scenario.expectedDiagram;
			const wrongValue = {
				...input,
				series: input.series.map((series, index) =>
					index === input.series.length - 1
						? { ...series, values: series.values.map((value, i) => (i === 0 ? value + 1 : value)) }
						: series,
				),
			};
			expect(failing(scenario, wrongValue)).toContain(`chart-series:${input.series.length}`);
			const dropped = {
				...input,
				categories: input.categories.slice(1),
				series: input.series.map((series) => ({ ...series, values: series.values.slice(1) })),
			};
			expect(failing(scenario, dropped)).toEqual(
				expect.arrayContaining(["chart-category-count", "chart-category:1"]),
			);
			const renamed = {
				...input,
				categories: input.categories.map((category, i) => (i === 0 ? "Invented" : category)),
			};
			expect(failing(scenario, renamed)).toContain("chart-category:1");
		});

		it(`${scenario.id}: rejects the wrong chart kind, unit and options`, () => {
			const input = scenario.expectedDiagram;
			const otherKind = input.kind === "line" ? "bar" : "line";
			const { donut: _donut, stacked: _stacked, ...plain } = input;
			const kinded =
				otherKind === "line" || input.kind === "pie"
					? { ...plain, kind: otherKind }
					: { ...input, kind: otherKind };
			if (input.kind !== "pie" || input.series.length === 1)
				expect(failing(scenario, kinded as ChartDiagram)).toContain("chart-kind");
			const expected = scenario.assertions;
			if (expected.units) {
				const { unit: _unit, ...unitless } = input;
				expect(failing(scenario, unitless)).toContain("chart-unit");
			}
			if (expected.valueAxisTitle) {
				const { valueAxisTitle: _title, ...untitled } = input;
				expect(failing(scenario, untitled)).toContain("chart-value-axis-title");
			}
			if (expected.stacked !== undefined)
				expect(failing(scenario, { ...input, stacked: !expected.stacked })).toContain(
					"chart-stacked",
				);
			if (expected.donut !== undefined)
				expect(failing(scenario, { ...input, donut: !expected.donut })).toContain("chart-donut");
		});
	}

	it("accepts reordered series and any name for a lone series", () => {
		const grouped = chartScenarios.find(
			(scenario) => scenario.id === "quarterly-revenue-bar-chart",
		)!;
		const input = grouped.expectedDiagram;
		expect(failing(grouped, { ...input, series: [...input.series].reverse() })).toEqual([]);
		const single = chartScenarios.find((scenario) => scenario.id === "api-latency-line-chart")!;
		expect(
			failing(single, {
				...single.expectedDiagram,
				series: [{ name: "Median latency", values: single.expectedDiagram.series[0]!.values }],
			}),
		).toEqual([]);
	});

	it("measures drawn proportions from the scene", () => {
		const scenario = chartScenarios.find((entry) => entry.id === "net-income-bar-chart")!;
		const scene = renderDiagram(scenario.expectedDiagram);
		expect(chartGeometryCheck(scenario.expectedDiagram, scene).passed).toBe(true);
		const distorted = {
			...scene,
			elements: scene.elements.map((element) =>
				element.type === "node" && element.nodeId === "chart:bar:0:0"
					? { ...element, height: element.height * 1.5 }
					: element,
			),
		};
		expect(chartGeometryCheck(scenario.expectedDiagram, distorted).passed).toBe(false);
	});

	it("checks that pie labels state each share and never repeat for different values", () => {
		const scenario = chartScenarios.find((entry) => entry.id === "cloud-spend-pie-chart")!;
		const scene = renderDiagram(scenario.expectedDiagram);
		const labels = scenario.expectedDiagram.categories.map((_, index) => {
			const element = scene.elements.find((entry) => entry.id === `chart:slice-label:${index}`);
			return element?.type === "text" ? element.text.split("\n").at(-1) : undefined;
		});
		// Licenses (0.7%) and Support (1.1%) would both read 1% at whole numbers.
		expect(labels).toEqual([
			"92% · $920k",
			"4% · $40k",
			"2.2% · $22k",
			"1.1% · $11k",
			"0.7% · $7k",
		]);
		expect(chartPieLabelCheck(scenario.expectedDiagram, scene).passed).toBe(true);
		const relabel = (index: number, text: string) => ({
			...scene,
			elements: scene.elements.map((element) =>
				element.type === "text" && element.id === `chart:slice-label:${index}`
					? { ...element, text }
					: element,
			),
		});
		expect(
			chartPieLabelCheck(scenario.expectedDiagram, relabel(4, "Licenses\n1.1% · $7k")).passed,
		).toBe(false);
		expect(
			chartPieLabelCheck(scenario.expectedDiagram, relabel(0, "Compute\n90% · $920k")).passed,
		).toBe(false);
	});

	it("grades data fidelity on the drawn text, not just the spec", () => {
		const scenario = chartScenarios.find(
			(entry) => entry.id === "support-tickets-stacked-bar-chart",
		)!;
		const scene = renderDiagram(scenario.expectedDiagram);
		expect(chartDrawnDataCheck(scenario, scenario.expectedDiagram, scene).passed).toBe(true);
		// Wed's Phone value (9) dropped from the drawing, as the first renderer did.
		const dropped = {
			...scene,
			elements: scene.elements.filter((element) => element.id !== "chart:value:2:2"),
		};
		const check = chartDrawnDataCheck(scenario, scenario.expectedDiagram, dropped);
		expect(check.passed).toBe(false);
		expect(check.message).toContain("9");
		const unnamed = {
			...scene,
			elements: scene.elements.filter((element) => element.id !== "chart:category:2"),
		};
		expect(chartDrawnDataCheck(scenario, scenario.expectedDiagram, unnamed).message).toContain(
			'"Wed"',
		);
	});

	it("checks that no gridline, baseline or axis crosses text", () => {
		const scenario = chartScenarios.find((entry) => entry.id === "quarterly-revenue-bar-chart")!;
		const scene = renderDiagram(scenario.expectedDiagram);
		expect(chartClearRulesCheck(scene).passed).toBe(true);
		const label = scene.elements.find((element) => element.id === "chart:value:1:1")!;
		if (label.type !== "text") throw new Error("Expected a value label.");
		const crossed = {
			...scene,
			elements: scene.elements.map((element) =>
				element.id === "chart:grid:1" && element.type === "line"
					? {
							...element,
							points: [
								{ x: 0, y: label.y },
								{ x: 2000, y: label.y },
							] as typeof element.points,
						}
					: element,
			),
		};
		expect(chartClearRulesCheck(crossed).passed).toBe(false);
	});

	it("grades a buildChart receipt from an MCP execute result and flags another family", () => {
		const scenario = chartScenarios[0]!;
		const { type: _type, ...spec } = scenario.expectedDiagram;
		const receipt = {
			operation: "buildChart",
			index: 0,
			ok: true,
			status: "accepted",
			buildId: "build_1",
			normalizedSpec: spec,
			quality: { accepted: true, score: 10, threshold: 8 },
			issues: [],
		};
		const candidate = candidateFromMcpResult(
			{ ok: true, result: { buildId: "build_1" }, builds: [receipt] },
			"chart",
		);
		expect(candidate?.ok).toBe(true);
		if (!candidate?.ok) throw new Error("Expected an accepted chart candidate.");
		expect(evaluateScenarioDiagram(scenario, candidate.diagram).ok).toBe(true);
		const canvas = candidateFromMcpResult(
			{
				ok: true,
				builds: [{ ...receipt, operation: "createCanvas", normalizedSpec: { kind: "canvas" } }],
			},
			"chart",
		);
		expect(canvas?.ok).toBe(false);
	});
});
