import { buildResponse, type BuildRejection } from "../../build/operation.js";
import { describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { validateExcalidrawScene } from "@sketchi/drawing/excalidraw";
import {
	applyDiagramPatch,
	buildQuadrantChart,
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

describe("quadrant build", () => {
	it("builds the documented example into a validated, patchable editable artifact", async () => {
		const built = await build(positioning);
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
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
		expect(built.quality.summary).toEqual({ nodeCount: 3, edgeCount: 1 });
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
		const spec = {
			...positioning,
			points: Array.from({ length: 30 }, (_, index) => ({
				label: `Telecommunications backlog ${index + 1}`,
				x: 0,
				y: 0,
			})),
		};
		const typed = await Effect.runPromise(
			buildQuadrantChart({ spec, options }).pipe(
				Effect.result,
				Effect.provideService(CodeModeRuntimeEnvironment, {
					createId: (prefix) => prefix + "_dense",
				}),
				Effect.provideService(CodeModeArtifactStorage, storage),
			),
		);
		if (Result.isSuccess(typed)) return expect.fail("Expected typed layout refusal");
		expect(typed.failure.reason._tag).toBe("Document");
		if (typed.failure.reason._tag === "Document")
			expect(typed.failure.reason.error._tag).toBe("QuadrantValidationError");
		const result = typed.failure.toResult();
		expect(result.ok).toBe(false);
		expect(result.status).toBe("invalid_quadrant_chart");
		expect(result.issues[0]).toMatchObject({ code: "quadrant_too_large", stage: "input" });
		expect(result.issues[0]?.hint).toContain("Spread the scores");
	});

	it.each([
		{
			name: "edges and middle",
			points: [
				{ label: "Origin", x: 0, y: 0 },
				{ label: "Center", x: 0.5, y: 0.5 },
				{ label: "Far corner", x: 1, y: 1 },
			],
		},
		{ name: "empty matrix", points: [] },
		{
			name: "ordinary prototype-like names",
			points: [
				{ label: "__proto__", x: 0.2, y: 0.8, group: "constructor" },
				{ label: "constructor", x: 0.7, y: 0.3, group: "__proto__" },
				{ label: "toString", x: 0.4, y: 0.4, group: "Constructor" },
			],
		},
	])("preserves $name through authored build and native export", async ({ points }) => {
		const built = await build({ ...positioning, points });
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		expect(built.normalizedSpec.points).toEqual(points);
		const native = built.artifact.formats.find((f) => f.format === "excalidraw")
			?.inline as Parameters<typeof validateExcalidrawScene>[0];
		const texts = native.elements.filter((e) => e.type === "text");
		for (const point of points) expect(texts.some((e) => e["text"] === point.label)).toBe(true);
		if (points.length === 0)
			expect(texts.filter((e) => e.id.startsWith("quadrant:name:"))).toHaveLength(4);
		if (points[0]?.label === "__proto__") {
			expect(built.quality.summary.edgeCount).toBe(2);
			expect(texts.find((e) => e.id === "quadrant:legend:0:label")?.["text"]).toBe("constructor");
			expect(texts.find((e) => e.id === "quadrant:legend:1:label")?.["text"]).toBe("__proto__");
			const dot = (i: number) => native.elements.find((e) => e.id === `node:quadrant:point:${i}`);
			expect(dot(0)?.backgroundColor).toBe(dot(2)?.backgroundColor);
			expect(dot(0)?.backgroundColor).not.toBe(dot(1)?.backgroundColor);
		}
	});

	it("rejects quadrant names in a list, which leaves their corners ambiguous", async () => {
		const result = await build({ ...positioning, quadrants: ["A", "B", "C", "D"] });
		expect(result.ok).toBe(false);
		expect(result.status).toBe("invalid_input");
		expect(result.issues[0]?.ref?.path).toContain("quadrants");
	});
});
