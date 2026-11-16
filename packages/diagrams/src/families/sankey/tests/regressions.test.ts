import { validateExcalidrawScene } from "@sketchi/drawing/excalidraw";
import { Effect } from "effect";
import { expect, it } from "vitest";

import { CodeModeArtifactStorage, makeMemoryArtifactStorage } from "../../../build/artifacts.js";
import { buildSankey } from "../../../build/builds.js";
import { CodeModeRuntimeEnvironment } from "../../../build/runtime.js";
import { buildResponse } from "../../../build/operation.js";

it("builds and exports nodes whose ids and labels name Object members", async () => {
	const built = await Effect.runPromise(
		buildResponse(
			buildSankey({
				spec: {
					title: "Object members",
					nodes: [
						{ id: "__proto__", label: "constructor" },
						{ id: "constructor", label: "__proto__" },
						{ id: "toString", label: "hasOwnProperty" },
					],
					links: [
						{ source: "__proto__", target: "constructor", value: 5 },
						{ source: "__proto__", target: "toString", value: 2 },
					],
				},
				options: { inlineArtifacts: ["excalidraw"], artifactFormats: ["excalidraw"] },
			}),
		).pipe(
			Effect.provideService(CodeModeRuntimeEnvironment, { createId: (prefix) => `${prefix}_1` }),
			Effect.provideService(CodeModeArtifactStorage, makeMemoryArtifactStorage()),
		),
	);
	if (!built.ok) throw new Error(JSON.stringify(built.issues));
	expect(built.normalizedSpec.nodes.map((node) => node.id)).toEqual([
		"__proto__",
		"constructor",
		"toString",
	]);
	const excalidraw = built.artifact.formats.find((format) => format.format === "excalidraw")
		?.inline as Parameters<typeof validateExcalidrawScene>[0];
	expect(validateExcalidrawScene(excalidraw)).toEqual({ ok: true, issues: [] });
});
