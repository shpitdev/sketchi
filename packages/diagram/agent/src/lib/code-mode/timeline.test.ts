import { describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import {
	CANVAS_LIMITS,
	TIMELINE_MAX_EVENTS,
	TIMELINE_MAX_LANES,
	timelineFixture,
} from "@sketchi/diagram-core";
import { validateExcalidrawScene } from "@sketchi/diagram-excalidraw";
import { applyDiagramPatch, buildTimeline, CodeModeRuntimeEnvironment } from "./runtime.js";
import { CodeModeArtifactStorage, makeMemoryArtifactStorage } from "./artifacts.js";
import { BuildTimelineResultSchema } from "./contract.js";

function build(spec: unknown) {
	return Effect.runPromise(
		buildTimeline({
			spec,
			options: {
				inlineArtifacts: ["scene", "excalidraw"],
				artifactFormats: ["scene", "excalidraw"],
			},
		}).pipe(
			Effect.provideService(CodeModeRuntimeEnvironment, {
				createId: (prefix) => `${prefix}_timeline`,
			}),
			Effect.provideService(CodeModeArtifactStorage, makeMemoryArtifactStorage()),
		),
	);
}
const phasedSpec = {
	title: "Launch phases",
	today: "2026-03-10",
	lanes: ["Product", "Marketing"],
	events: [
		{ id: "build", label: "Build", date: "2026-02-16", end: "2026-05-29", lane: "Product" },
		{ id: "launch", label: "Launch", date: "2026-08-04", kind: "milestone", lane: "Product" },
		{ id: "blog", label: "Launch blog", date: "2026-08-04", lane: "Marketing" },
	],
};

describe("Code Mode native timeline", () => {
	it("carries spans, milestones, lanes and today into a patchable editable artifact", async () => {
		const storage = makeMemoryArtifactStorage();
		const run = <A>(
			effect: Effect.Effect<A, never, CodeModeRuntimeEnvironment | CodeModeArtifactStorage>,
		) =>
			Effect.runPromise(
				effect.pipe(
					Effect.provideService(CodeModeRuntimeEnvironment, {
						createId: (prefix) => `${prefix}_${Math.random().toString(36).slice(2)}`,
					}),
					Effect.provideService(CodeModeArtifactStorage, storage),
				),
			);
		const built = await run(
			buildTimeline({
				spec: phasedSpec,
				options: {
					inlineArtifacts: ["scene", "excalidraw"],
					artifactFormats: ["scene", "excalidraw"],
				},
			}),
		);
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		expect(built.normalizedSpec).toMatchObject({
			today: "2026-03-10",
			lanes: ["Product", "Marketing"],
			events: phasedSpec.events,
		});
		expect(built.quality.summary).toEqual({ nodeCount: 3, edgeCount: 0 });
		const excalidraw = built.artifact.formats.find((format) => format.format === "excalidraw")
			?.inline as Parameters<typeof validateExcalidrawScene>[0];
		expect(validateExcalidrawScene(excalidraw)).toEqual({ ok: true, issues: [] });
		const shapes = excalidraw.elements.filter((element) => element.type !== "text");
		expect(shapes.some((element) => element.type === "arrow" && element["startBinding"])).toBe(
			false,
		);
		expect(shapes.find((element) => element.id === "node:event:launch")?.type).toBe("diamond");
		const patched = await run(
			applyDiagramPatch({
				source: { artifactId: built.artifact.artifactId },
				operations: [
					{
						op: "setStyle",
						selector: { nodeIds: ["event:launch"] },
						style: { fillColor: "#c0392b" },
					},
				],
			}),
		);
		expect(patched.ok, JSON.stringify(patched.issues)).toBe(true);
	});
	it("rejects a span on an ordered timeline with a structured repair issue", async () => {
		const result = await build({
			title: "Ordered",
			events: [{ id: "a", label: "A", order: 1, end: "2026-01-01" }],
		});
		expect(result.ok).toBe(false);
		expect(result.issues.map((issue) => issue.code)).toContain("invalid_timeline_span");
	});
	it("builds chronological events into validated editable exports without losing content", async () => {
		const result = await build({
			...timelineFixture,
			events: [...timelineFixture.events].reverse(),
		});
		expect(result.ok).toBe(true);
		expect(() => Schema.decodeUnknownSync(BuildTimelineResultSchema)(result)).not.toThrow();
		if (!result.ok) throw new Error(JSON.stringify(result.issues));
		expect(result.normalizedSpec.events).toEqual(timelineFixture.events);
		const exported = result.artifact.formats.find(
			(format) => format.format === "excalidraw",
		)?.inline;
		expect(
			validateExcalidrawScene(exported as Parameters<typeof validateExcalidrawScene>[0]),
		).toEqual({ ok: true, issues: [] });
	});
	it.each([
		{ events: [] },
		{ events: [{ id: "a", label: "A", date: "2026-02-30" }] },
		{
			events: [
				{ id: "a", label: "A", order: 1 },
				{ id: "a", label: "B", order: 2 },
			],
		},
		{
			events: [
				{ id: "a", label: "A", order: 1 },
				{ id: "b", label: "B", date: "2026-10-01" },
			],
		},
	])("rejects invalid authoring input with structured repair issues", async (invalid) => {
		const result = await build({ title: "Invalid", ...invalid });
		expect(result.ok).toBe(false);
		expect(result.issues.length).toBeGreaterThan(0);
		expect(result.issues.every((issue) => issue.hint && issue.stage === "input")).toBe(true);
		expect(() => Schema.decodeUnknownSync(BuildTimelineResultSchema)(result)).not.toThrow();
	});
});

describe("Code Mode timeline size", () => {
	it("draws the largest chronology its family allows on one canvas", async () => {
		const lanes = Array.from(
			{ length: TIMELINE_MAX_LANES },
			(_, index) => `Workstream ${index + 1}`,
		);
		// Six weeks apart but for one pair on a lane a day apart. That pair once set the scale
		// and broke the axis between nearly every other pair, on every lane: 1,668 elements.
		let day = Date.UTC(2024, 0, 15);
		const events = Array.from({ length: TIMELINE_MAX_EVENTS }, (_, index) => {
			day += (index === 31 ? 1 : 42) * 86_400_000;
			return {
				id: `e${index + 1}`,
				label: `Milestone ${index + 1} for the program`,
				date: new Date(day).toISOString().slice(0, 10),
				lane: lanes[Math.floor((index * lanes.length) / TIMELINE_MAX_EVENTS)],
			};
		});
		const result = await build({ title: "Program milestones", lanes, events });

		if (!result.ok) throw new Error(JSON.stringify(result.issues));
		const scene = result.artifact.formats.find((format) => format.format === "scene")?.inline as {
			readonly elements: readonly unknown[];
		};
		expect(scene.elements.length).toBeLessThanOrEqual(CANVAS_LIMITS.maxElements);
		// The pair now takes one break of its own.
		expect(scene.elements.length).toBeLessThan(400);
	});
});
