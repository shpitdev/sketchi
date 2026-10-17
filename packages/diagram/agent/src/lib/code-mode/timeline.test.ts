import { describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import { timelineFixture } from "@sketchi/diagram-core";
import { validateExcalidrawScene } from "@sketchi/diagram-excalidraw";
import { buildTimeline, CodeModeRuntimeEnvironment } from "./runtime.js";
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
describe("Code Mode native timeline", () => {
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
