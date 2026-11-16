import { buildResponse, type BuildRejection } from "../../../build/operation.js";
import { describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { validateExcalidrawScene } from "@sketchi/drawing/excalidraw";
import { buildChart } from "../../../build/builds.js";
import { CodeModeRuntimeEnvironment } from "../../../build/runtime.js";
import { applyDiagramPatch } from "../../../canvas/patch.js";
import { CodeModeArtifactStorage, makeMemoryArtifactStorage } from "../../../build/artifacts.js";
import {
	CHART_MAX_CATEGORIES,
	ChartValidationIssueCodeSchema,
	parseChartDiagram,
	type ChartValidationIssue,
} from "../document.js";

const storage = makeMemoryArtifactStorage();
function run<A, E extends BuildRejection<unknown>>(
	effect: Effect.Effect<A, E, CodeModeRuntimeEnvironment | CodeModeArtifactStorage>,
) {
	let id = 0;
	return Effect.runPromise(
		buildResponse(effect).pipe(
			Effect.provideService(CodeModeRuntimeEnvironment, {
				createId: (prefix) => `${prefix}_chart_${(id += 1)}`,
			}),
			Effect.provideService(CodeModeArtifactStorage, storage),
		),
	);
}

describe("chart build", () => {
	it("builds a stacked bar chart into a validated, patchable editable artifact", async () => {
		const built = await run(
			buildChart({
				spec: {
					title: "Tickets by channel",
					kind: "bar",
					stacked: true,
					categories: ["Mon", "Tue"],
					series: [
						{ name: "Email", values: [30, 42] },
						{ name: "Chat", values: [55, 61] },
					],
					valueAxisTitle: "Tickets",
				},
				options: {
					inlineArtifacts: ["scene", "excalidraw"],
					artifactFormats: ["scene", "excalidraw"],
				},
			}),
		);
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		const excalidraw = built.artifact.formats.find((format) => format.format === "excalidraw")
			?.inline as Parameters<typeof validateExcalidrawScene>[0];
		expect(validateExcalidrawScene(excalidraw)).toEqual({ ok: true, issues: [] });
		const bars = excalidraw.elements.filter((element) => element.id.startsWith("node:chart:bar:"));
		expect(bars).toHaveLength(4);
		// Bars are square marks, never labelled shapes.
		for (const bar of bars) expect(bar.roundness).toBeNull();
		expect(
			excalidraw.elements.some((element) => element.id.includes("__sketchi_node_label__")),
		).toBe(false);
		const patched = await run(
			applyDiagramPatch({
				source: { artifactId: built.artifact.artifactId },
				operations: [
					{
						op: "setStyle",
						selector: { nodeIds: ["chart:bar:0:0"] },
						style: { fillColor: "#e34948" },
					},
				],
			}),
		);
		expect(patched.ok, JSON.stringify(patched.issues)).toBe(true);
	});
});

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

function issuesOf(input: object): readonly ChartValidationIssue[] {
	const result = parseChartDiagram(input);
	if (Result.isSuccess(result)) return [];
	const error = result.failure;
	if (error._tag !== "ChartValidationError") return expect.fail(error.message);
	return error.issues;
}

/** One minimal bad chart per code the validator owns. */
const bad: Record<string, object> = {
	chart_too_large: {
		...bar,
		categories: Array.from({ length: CHART_MAX_CATEGORIES + 1 }, (_, i) => `C${i}`),
		series: [{ values: Array.from({ length: CHART_MAX_CATEGORIES + 1 }, () => 1) }],
	},
	chart_series_mismatch: { ...bar, series: [{ name: "a", values: [1, 2] }] },
	duplicate_chart_category: { ...bar, categories: ["Q1", "q1 ", "Q3"] },
	invalid_chart_series: {
		...bar,
		series: [{ values: [1, 2, 3] }, { name: "b", values: [1, 2, 3] }],
	},
	invalid_chart_value: { ...bar, kind: "pie", series: [{ values: [5, -1, 2] }] },
	invalid_chart_option: { ...bar, kind: "line", stacked: true },
};

describe("Chart validator", () => {
	it("covers every issue code it can raise", () => {
		expect(new Set(Object.keys(bad))).toEqual(new Set(ChartValidationIssueCodeSchema.literals));
	});

	it.each(Object.entries(bad))("raises %s for a minimal bad chart", (code, input) => {
		expect(issuesOf(input).map((issue) => issue.code)).toContain(code);
	});
});
