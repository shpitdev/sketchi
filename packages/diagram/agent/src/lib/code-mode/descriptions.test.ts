import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import type { CanvasSpec, CanvasTextElement } from "@sketchi/diagram-core";
import { validateExcalidrawScene } from "@sketchi/diagram-excalidraw";

import { CodeModeArtifactStorage, makeMemoryArtifactStorage } from "./artifacts.js";
import { buildFlowchart, CodeModeRuntimeEnvironment } from "./runtime.js";

function build(spec: unknown) {
	return Effect.runPromise(
		buildFlowchart({
			spec,
			options: {
				inlineArtifacts: ["scene", "excalidraw"],
				artifactFormats: ["scene", "excalidraw"],
			},
		}).pipe(
			Effect.provideService(CodeModeRuntimeEnvironment, {
				createId: (prefix) => `${prefix}_descriptions`,
			}),
			Effect.provideService(CodeModeArtifactStorage, makeMemoryArtifactStorage()),
		),
	);
}

function spec(apiDescription: string) {
	return {
		title: "AWS services",
		layout: { direction: "LR" },
		nodes: [
			{ id: "users", label: "Users", kind: "start" },
			{ id: "web", label: "Web service", kind: "process", description: "ECS Fargate" },
			{ id: "api", label: "API service", kind: "process", description: apiDescription },
			{ id: "db", label: "RDS PostgreSQL", kind: "end", shape: "database" },
		],
		edges: [
			{ source: "users", target: "web" },
			{ source: "web", target: "api" },
			{ source: "api", target: "db" },
		],
	};
}

describe("Code Mode node descriptions", () => {
	it("draws each description as a subtitle in the scene and the Excalidraw export", async () => {
		const built = await build(spec("ECS Fargate, two tasks"));
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		expect(built.issues).toEqual([]);
		const scene = built.artifact.formats.find((format) => format.format === "scene")
			?.inline as CanvasSpec;
		const descriptions = scene.elements.filter(
			(element): element is CanvasTextElement =>
				element.type === "text" && element.id.startsWith("description:"),
		);
		expect(descriptions.map((element) => [element.id, element.text.replaceAll("\n", " ")])).toEqual(
			[
				["description:web", "ECS Fargate"],
				["description:api", "ECS Fargate, two tasks"],
			],
		);
		const excalidraw = built.artifact.formats.find((format) => format.format === "excalidraw")
			?.inline as Parameters<typeof validateExcalidrawScene>[0];
		expect(validateExcalidrawScene(excalidraw).issues).toEqual([]);
	});

	it("draws a description past its line limit in full and warns", async () => {
		const essay =
			"Application entry point; package names have not been verified against repository source, so this node stands for the conceptual boundary only and every caller reaches it first";
		const built = await build(spec(essay));
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		expect(built.issues).toEqual([
			expect.objectContaining({
				code: "label_too_long",
				severity: "warning",
				ref: { kind: "node", id: "api", path: "spec.nodes.description" },
			}),
		]);
		const scene = built.artifact.formats.find((format) => format.format === "scene")
			?.inline as CanvasSpec;
		const description = scene.elements.find((element) => element.id === "description:api");
		expect(description?.type === "text" && description.text.replaceAll("\n", " ")).toBe(essay);
	});
});
