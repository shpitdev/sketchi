import { describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import { quadrantFixture } from "@sketchi/diagram-core";
import { validateExcalidrawScene } from "@sketchi/diagram-excalidraw";
import { applyDiagramPatch, buildQuadrantChart, CodeModeRuntimeEnvironment } from "./runtime.js";
import { CodeModeArtifactStorage, makeMemoryArtifactStorage } from "./artifacts.js";
import { BuildQuadrantChartResultSchema } from "./contract.js";
import { buildCanonicalDocument, canonicalDocumentFromDiagram } from "./documents.js";

const storage = makeMemoryArtifactStorage();
function run<A>(
	effect: Effect.Effect<A, never, CodeModeRuntimeEnvironment | CodeModeArtifactStorage>,
) {
	let id = 0;
	return Effect.runPromise(
		effect.pipe(
			Effect.provideService(CodeModeRuntimeEnvironment, {
				createId: (prefix) => `${prefix}_quadrant_${(id += 1)}`,
			}),
			Effect.provideService(CodeModeArtifactStorage, storage),
		),
	);
}
const options = {
	inlineArtifacts: ["scene", "excalidraw"],
	artifactFormats: ["scene", "excalidraw"],
};
const build = (spec: unknown) => run(buildQuadrantChart({ spec, options }));
const positioning = {
	title: "Project tools by price and ease",
	xAxis: { title: "Price", low: "Low price", high: "High price" },
	yAxis: { title: "Ease of use", low: "Hard to use", high: "Easy to use" },
	quadrants: {
		topLeft: "Best value",
		topRight: "Premium and simple",
		bottomLeft: "Budget and complex",
		bottomRight: "Overpriced",
	},
	points: [
		{ label: "Trello", x: 0.25, y: 0.85 },
		{ label: "Jira", x: 0.55, y: 0.3 },
		{ label: " Our product ", x: 0.4, y: 0.82, group: "Our product" },
	],
};

describe("Code Mode native quadrant chart", () => {
	it("builds the documented example into a validated, patchable editable artifact", async () => {
		const built = await build(positioning);
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		expect(() => Schema.decodeUnknownSync(BuildQuadrantChartResultSchema)(built)).not.toThrow();
		expect(built.normalizedSpec).toMatchObject({
			id: "project-tools-by-price-and-ease",
			xAxis: positioning.xAxis,
			quadrants: positioning.quadrants,
			points: [
				{ label: "Trello", x: 0.25, y: 0.85 },
				{ label: "Jira", x: 0.55, y: 0.3 },
				{ label: "Our product", x: 0.4, y: 0.82, group: "Our product" },
			],
		});
		expect(built.quality.summary).toEqual({ nodeCount: 3, edgeCount: 0 });
		const excalidraw = built.artifact.formats.find((format) => format.format === "excalidraw")
			?.inline as Parameters<typeof validateExcalidrawScene>[0];
		expect(validateExcalidrawScene(excalidraw)).toEqual({ ok: true, issues: [] });
		const region = excalidraw.elements.find(
			(element) => element.id === "node:quadrant:region:topLeft",
		);
		expect(region).toMatchObject({ type: "rectangle", roundness: null, roughness: 0 });
		expect(
			excalidraw.elements.find((element) => element.id === "node:quadrant:point:0"),
		).toMatchObject({ type: "ellipse", groupIds: ["quadrant:point:0"] });
		const patched = await run(
			applyDiagramPatch({
				source: { artifactId: built.artifact.artifactId },
				operations: [
					{
						op: "setStyle",
						selector: { nodeIds: ["quadrant:point:1"] },
						style: { fillColor: "#e34948" },
					},
				],
			}),
		);
		expect(patched.ok, JSON.stringify(patched.issues)).toBe(true);
		if (!patched.ok) return;
		const scene = patched.artifact.formats.find((format) => format.format === "scene")?.inline as {
			elements: { id: string; rendererRole?: string; fillColor?: string }[];
		};
		// Patches keep the dots' role, so they still export without generated labels.
		expect(scene.elements.find((element) => element.id === "node:quadrant:point:1")).toMatchObject({
			rendererRole: "quadrant-mark",
			fillColor: "#e34948",
		});
	});

	it.each([
		[{ points: [{ label: "Trello", x: 25, y: 85 }] }, "invalid_quadrant_point"],
		[
			{
				points: [
					{ label: "Trello", x: 0.2, y: 0.8 },
					{ label: "trello", x: 0.3, y: 0.6 },
				],
			},
			"invalid_quadrant_point",
		],
		[
			{
				points: Array.from({ length: 31 }, (_, index) => ({ label: `T${index}`, x: 0.5, y: 0.5 })),
			},
			"quadrant_too_large",
		],
		[{ quadrants: { ...positioning.quadrants, topLeft: "x".repeat(41) } }, "invalid_quadrant_text"],
	])("rejects invalid charts with structured repair issues", async (change, code) => {
		const result = await build({ ...positioning, ...change });
		expect(result.ok).toBe(false);
		expect(result.status).toBe("invalid_quadrant_chart");
		expect(result.issues.map((issue) => issue.code)).toContain(code);
		expect(result.issues.every((issue) => issue.hint && issue.stage === "input")).toBe(true);
		expect(() => Schema.decodeUnknownSync(BuildQuadrantChartResultSchema)(result)).not.toThrow();
	});

	it.each([
		["null", null],
		["an object", { label: "Trello", x: 0.25, y: 0.85 }],
		["a string", "Trello at 25, 85"],
	])("rejects points given as %s with a repair hint, never dropping them", async (_, points) => {
		const result = await build({ ...positioning, points });
		expect(result.ok).toBe(false);
		expect(result.status).toBe("invalid_input");
		expect(result.issues[0]).toMatchObject({ ref: { path: "spec.points" } });
		expect(result.issues[0]?.hint.length).toBeGreaterThan(10);
	});

	it("rejects a chart too crowded to label cleanly, with a repair hint, rather than drawing it", async () => {
		const result = await build({
			...positioning,
			points: Array.from({ length: 30 }, (_, index) => ({
				label: `Telecommunications backlog ${index + 1}`,
				x: 0,
				y: 0,
			})),
		});
		expect(result.ok).toBe(false);
		expect(result.status).toBe("invalid_quadrant_chart");
		expect(result.issues[0]).toMatchObject({ code: "quadrant_too_large", stage: "input" });
		expect(result.issues[0]?.hint).toContain("Spread the scores");
		expect(() => Schema.decodeUnknownSync(BuildQuadrantChartResultSchema)(result)).not.toThrow();
	});

	it("keeps zero scores on the low ends", async () => {
		const built = await build({ ...positioning, points: [{ label: "Free tier", x: 0, y: 0 }] });
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		expect(built.normalizedSpec.points).toEqual([{ label: "Free tier", x: 0, y: 0 }]);
	});

	it("rejects quadrant names in a list, which leaves their corners ambiguous", async () => {
		const result = await build({ ...positioning, quadrants: ["A", "B", "C", "D"] });
		expect(result.ok).toBe(false);
		expect(result.status).toBe("invalid_input");
		expect(result.issues[0]?.ref?.path).toContain("quadrants");
	});

	it("round-trips the canonical fixture through its document", async () => {
		const result = await run(
			buildCanonicalDocument(canonicalDocumentFromDiagram(quadrantFixture), {
				artifactFormats: ["scene"],
			}),
		);
		if (!result.ok) throw new Error(JSON.stringify(result.issues));
		const { type: _type, ...spec } = quadrantFixture;
		expect(result.normalizedSpec).toEqual(spec);
	});
});
