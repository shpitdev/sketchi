import { validateExcalidrawScene } from "@sketchi/drawing/excalidraw";
import { Effect } from "effect";
import { expect, it } from "vitest";

import { CodeModeArtifactStorage, makeMemoryArtifactStorage } from "../../../build/artifacts";
import { buildQuadrantChart } from "../../../build/builds";
import { CodeModeRuntimeEnvironment } from "../../../build/runtime";
import { buildResponse } from "../../../build/operation";
import { quadrantFixture } from "../document";

it("keeps prototype-like labels and groups apart through build and export", async () => {
	const points = [
		{ label: "__proto__", x: 0.2, y: 0.8, group: "constructor" },
		{ label: "constructor", x: 0.7, y: 0.3, group: "__proto__" },
		{ label: "toString", x: 0.4, y: 0.4, group: "Constructor" },
	];
	const built = await Effect.runPromise(
		buildResponse(
			buildQuadrantChart({
				spec: { ...quadrantFixture, points },
				options: { inlineArtifacts: ["excalidraw"], artifactFormats: ["excalidraw"] },
			}),
		).pipe(
			Effect.provideService(CodeModeRuntimeEnvironment, { createId: (prefix) => `${prefix}_1` }),
			Effect.provideService(CodeModeArtifactStorage, makeMemoryArtifactStorage()),
		),
	);
	if (!built.ok) throw new Error(JSON.stringify(built.issues));
	expect(built.normalizedSpec.points).toEqual(points);
	const native = built.artifact.formats.find((format) => format.format === "excalidraw")
		?.inline as Parameters<typeof validateExcalidrawScene>[0];
	expect(validateExcalidrawScene(native)).toEqual({ ok: true, issues: [] });
	const fill = (index: number) =>
		native.elements.find((element) => element.id === `node:quadrant:point:${index}`)
			?.backgroundColor;
	// "constructor" and "Constructor" are one group; "__proto__" is another.
	expect(fill(0)).toBe(fill(2));
	expect(fill(0)).not.toBe(fill(1));
});
