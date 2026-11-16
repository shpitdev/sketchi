import { type CanvasSpec } from "@sketchi/drawing";
import { validateExcalidrawScene } from "@sketchi/drawing/excalidraw";
import { Effect } from "effect";
import { expect, it } from "vitest";

import {
	CodeModeArtifactStorage,
	makeMemoryArtifactStorage,
} from "../../../build/code-mode/artifacts.js";
import { buildWireframe } from "../../../build/code-mode/builds.js";
import { CodeModeRuntimeEnvironment } from "../../../build/code-mode/runtime.js";
import { buildResponse } from "../../../build/operation.js";

const build = (spec: unknown) =>
	Effect.runPromise(
		buildResponse(
			buildWireframe({
				spec,
				options: {
					inlineArtifacts: ["scene", "excalidraw"],
					artifactFormats: ["scene", "excalidraw"],
				},
			}),
		).pipe(
			Effect.provideService(CodeModeRuntimeEnvironment, {
				createId: (prefix) => `${prefix}_${Math.random().toString(36).slice(2)}`,
			}),
			Effect.provideService(CodeModeArtifactStorage, makeMemoryArtifactStorage()),
		),
	);

it("keeps repeated tab and nav items' element ids unique, so the export stays valid", async () => {
	for (const type of ["tabs", "nav"]) {
		const built = await build({
			title: "Repeated",
			screens: [
				{ name: "Screen", children: [{ type, items: ["Orders", "Orders"], active: "Orders" }] },
			],
		});
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		const formats = new Map(built.artifact.formats.map((format) => [format.format, format.inline]));
		const ids = (formats.get("scene") as CanvasSpec).elements.map((element) => element.id);
		expect(new Set(ids).size).toBe(ids.length);
		expect(
			validateExcalidrawScene(
				formats.get("excalidraw") as Parameters<typeof validateExcalidrawScene>[0],
			),
		).toEqual({ ok: true, issues: [] });
	}
});

it.each(["constructor", "__proto__", "toString", "hasOwnProperty"])(
	"refuses the inherited name %s as a type or device as invalid input, never crashing",
	async (name) => {
		const typed = await build({
			title: "Bad",
			screens: [{ name: "Bad", children: [{ type: name }] }],
		});
		expect(typed).toMatchObject({ ok: false, status: "invalid_input" });
		const device = await build({
			title: "Bad",
			screens: [{ name: "Bad", device: name, children: [{ type: "divider" }] }],
		});
		expect(device).toMatchObject({ ok: false, status: "invalid_input" });
	},
);
