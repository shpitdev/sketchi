import { describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import { chartFixture } from "@sketchi/diagram-core";
import { validateExcalidrawScene } from "@sketchi/diagram-excalidraw";
import { applyDiagramPatch, buildChart, CodeModeRuntimeEnvironment } from "./runtime.js";
import { CodeModeArtifactStorage, makeMemoryArtifactStorage } from "./artifacts.js";
import { BuildChartResultSchema } from "./contract.js";
import { buildCanonicalDocument, canonicalDocumentFromDiagram } from "./documents.js";

const storage = makeMemoryArtifactStorage();
function run<A>(
	effect: Effect.Effect<A, never, CodeModeRuntimeEnvironment | CodeModeArtifactStorage>,
) {
	let id = 0;
	return Effect.runPromise(
		effect.pipe(
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

describe("Code Mode native chart", () => {
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
		expect(() => Schema.decodeUnknownSync(BuildChartResultSchema)(built)).not.toThrow();
		expect(built.normalizedSpec).toMatchObject({
			id: "tickets-by-channel",
			kind: "bar",
			stacked: true,
			categories: ["Mon", "Tue"],
			valueAxisTitle: "Tickets",
		});
		expect(built.quality.summary).toEqual({ nodeCount: 4, edgeCount: 0 });
		const excalidraw = built.artifact.formats.find((format) => format.format === "excalidraw")
			?.inline as Parameters<typeof validateExcalidrawScene>[0];
		expect(validateExcalidrawScene(excalidraw)).toEqual({ ok: true, issues: [] });
		expect(
			excalidraw.elements.find((element) => element.id === "node:chart:bar:1:1")?.["roundness"],
		).toBeNull();
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
		expect(slices.map((slice) => slice.type)).toEqual(["line", "line", "line"]);
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
		const result = await build({ title: "Invalid", ...spec });
		expect(result.ok).toBe(false);
		expect(result.status).toBe("invalid_chart");
		expect(result.issues.map((issue) => issue.code)).toContain(code);
		expect(result.issues.every((issue) => issue.hint && issue.stage === "input")).toBe(true);
		expect(() => Schema.decodeUnknownSync(BuildChartResultSchema)(result)).not.toThrow();
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

	it("round-trips the canonical fixture through its document", async () => {
		const result = await run(
			buildCanonicalDocument(canonicalDocumentFromDiagram(chartFixture), {
				artifactFormats: ["scene"],
			}),
		);
		if (!result.ok) throw new Error(JSON.stringify(result.issues));
		expect(result.normalizedSpec).toMatchObject({
			id: chartFixture.id,
			categories: chartFixture.categories,
			series: chartFixture.series,
			unit: "$M",
		});
	});
});
