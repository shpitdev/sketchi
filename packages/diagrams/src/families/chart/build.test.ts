import { buildResponse, type BuildRejection } from "../../build/operation.js";
import { describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { validateExcalidrawScene } from "@sketchi/drawing/excalidraw";
import {
	applyDiagramPatch,
	buildChart,
	CodeModeRuntimeEnvironment,
} from "../../build/code-mode/runtime.js";
import {
	CodeModeArtifactStorage,
	makeMemoryArtifactStorage,
} from "../../build/code-mode/artifacts.js";

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
const options = {
	inlineArtifacts: ["scene", "excalidraw"],
	artifactFormats: ["scene", "excalidraw"],
};
const build = (spec: unknown) => run(buildChart({ spec, options }));

describe("chart build", () => {
	it("builds a stacked bar chart into a validated, patchable editable artifact", async () => {
		const built = await build({
			title: "Tickets by channel",
			kind: "bar",
			stacked: true,
			categories: ["Mon", "Tue"],
			series: [
				{ name: "Email", values: [30, 42] },
				{ name: "Chat", values: [55, 61] },
			],
			valueAxisTitle: "Tickets",
		});
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		expect(built.normalizedSpec).toMatchObject({
			id: "tickets-by-channel",
			kind: "bar",
			stacked: true,
			categories: ["Mon", "Tue"],
			valueAxisTitle: "Tickets",
		});
		expect(built.quality.summary).toEqual({ nodeCount: 2, edgeCount: 2 });
		const excalidraw = built.artifact.formats.find((format) => format.format === "excalidraw")
			?.inline as Parameters<typeof validateExcalidrawScene>[0];
		expect(validateExcalidrawScene(excalidraw)).toEqual({ ok: true, issues: [] });
		const bars = excalidraw.elements.filter((element) => element.id.startsWith("node:chart:bar:"));
		expect(bars).toHaveLength(4);
		for (const bar of bars) {
			expect(bar.type).toBe("rectangle");
			expect(bar.roundness).toBeNull();
			expect(bar.roughness).toBe(0);
			expect(bar.boundElements).toBeNull();
			expect(bar.customData).toEqual({ sketchiRendererRole: "chart-mark" });
		}
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

	it("builds a donut pie with every slice as an editable polygon", async () => {
		const built = await build({
			title: "Browser share",
			kind: "pie",
			donut: true,
			categories: ["Chrome", "Safari", "Other"],
			series: [{ values: [64, 19, 17] }],
			unit: "%",
		});
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		const excalidraw = built.artifact.formats.find((format) => format.format === "excalidraw")
			?.inline as Parameters<typeof validateExcalidrawScene>[0];
		const slices = excalidraw.elements.filter((element) =>
			element.id.startsWith("node:chart:slice:"),
		);
		expect(validateExcalidrawScene(excalidraw)).toEqual({ ok: true, issues: [] });
		expect(slices).toHaveLength(3);
		for (const slice of slices) {
			const points = slice.points as [number, number][];
			expect(slice.type).toBe("line");
			expect(slice.roundness).toBeNull();
			expect(points[0]).toEqual(points.at(-1));
			expect(slice.backgroundColor).not.toBe("transparent");
			expect(slice.customData).toEqual({
				sketchiShape: "polygon",
				sketchiRendererRole: "chart-mark",
			});
		}
	});

	it.each([
		[
			{ kind: "bar", categories: ["A", "B"], series: [{ name: "x", values: [1] }] },
			"chart_series_mismatch",
		],
		[{ kind: "pie", categories: ["A", "B"], series: [{ values: [1, -1] }] }, "invalid_chart_value"],
		[
			{ kind: "line", stacked: true, categories: ["A"], series: [{ values: [1] }] },
			"invalid_chart_option",
		],
		[
			{ kind: "bar", categories: ["A", "a"], series: [{ values: [1, 2] }] },
			"duplicate_chart_category",
		],
	])("rejects invalid charts with structured repair issues", async (spec, code) => {
		const request = { spec: { title: "Invalid", ...spec } };
		const outcome = await run(buildChart(request).pipe(Effect.result));
		expect(Result.isFailure(outcome)).toBe(true);
		if (Result.isSuccess(outcome)) return expect.fail("Expected typed build rejection");
		expect(outcome.failure.reason._tag).toBe("Document");
		if (outcome.failure.reason._tag !== "Document") return expect.fail("Expected chart validation");
		expect(outcome.failure.reason.error._tag).toBe("ChartValidationError");
		expect(outcome.failure.reason.error.issues.some((issue) => issue.code === code)).toBe(true);
		const result = outcome.failure.toResult();
		expect(result.ok).toBe(false);
		expect(result.status).toBe("invalid_chart");
		expect(result.issues.map((issue) => issue.code)).toContain(code);
		expect(result.issues.every((issue) => issue.hint && issue.stage === "input")).toBe(true);
	});

	it("rejects malformed input before validation", async () => {
		const result = await build({
			title: "Bad",
			kind: "area",
			categories: ["A"],
			series: [{ values: [1] }],
		});
		expect(result.ok).toBe(false);
		expect(result.status).toBe("invalid_input");
	});
});
