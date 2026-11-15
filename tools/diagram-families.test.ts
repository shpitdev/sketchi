import { scenarioFlowchartDocument } from "@sketchi/diagram-scenarios";
import {
	CodeModeArtifactStorage,
	CodeModeArtifactStorageMemory,
} from "@sketchi/diagrams/build/code-mode/artifacts";
import { canonicalDocumentFromDiagram } from "@sketchi/diagrams/build/code-mode/documents";
import { makeCodeModeRuntimeEnvironmentLayer } from "@sketchi/diagrams/build/code-mode/runtime";
import {
	type CanonicalDiagram,
	type CanonicalDiagramDocument,
	DIAGRAM_TYPES,
	type DiagramTypeValue,
	familyForType,
	renderDiagram,
} from "@sketchi/diagrams/family";
import { candidateFromText } from "@sketchi/diagrams/generate/candidates";
import { getCanvasValidationIssues } from "@sketchi/drawing";
import { Effect, Layer, Result } from "effect";
import { describe, expect, it } from "vitest";

import { DiagramBuilder, DiagramBuilderLive } from "../apps/cli/src/builder.ts";
import { parseJsonDocument } from "../apps/cli/src/document.ts";

/** A family's fixture as a model answers it: a flowchart as its document, any other as its diagram. */
function generationEnvelope(diagram: CanonicalDiagram): string {
	if (diagram.type === "flowchart") {
		const { title, ...document } = scenarioFlowchartDocument(diagram);
		return JSON.stringify({ title, diagram: { type: "flowchart", ...document } });
	}
	const { title, type, ...rest } = diagram;
	return JSON.stringify({
		title,
		diagram: { ...rest, type },
	});
}

/** The document a family's fixture builds from: a flowchart's is written, not converted. */
function documentFor(family: DiagramTypeValue): CanonicalDiagramDocument {
	const diagram = familyForType(family).fixture;
	return diagram.type === "flowchart"
		? { type: "flowchart", spec: scenarioFlowchartDocument(diagram) }
		: canonicalDocumentFromDiagram(diagram);
}

const cliBuilderLayer = DiagramBuilderLive.pipe(
	Layer.provideMerge(
		Layer.mergeAll(
			CodeModeArtifactStorageMemory,
			makeCodeModeRuntimeEnvironmentLayer({ createId: (prefix) => `${prefix}_family` }),
		),
	),
);

describe("canonical diagram family consumers", () => {
	it.each(DIAGRAM_TYPES)(
		"builds %s document JSON into valid stored offline artifacts",
		async (family) => {
			const fixture = familyForType(family).fixture;
			await Effect.runPromise(
				Effect.gen(function* () {
					const document = yield* parseJsonDocument(JSON.stringify(documentFor(family)));
					const builder = yield* DiagramBuilder;
					const built = yield* builder.build(document);

					expect(built).toMatchObject({ id: fixture.id, type: family, title: fixture.title });
					expect(built.warnings).toEqual([]);
					expect(built.scene.elements.length).toBeGreaterThan(0);
					expect(built.scene.diagramId).toBe(fixture.id);
					expect(built.excalidraw).toMatchObject({ type: "excalidraw", version: 2 });
					expect(built.excalidraw.elements.length).toBeGreaterThan(0);

					const storage = yield* CodeModeArtifactStorage;
					const manifest = yield* storage.readManifest("artifact_family");
					expect(manifest?.diagramId).toBe(fixture.id);
					expect((yield* storage.read("artifact_family", "scene"))?.data).toEqual(built.scene);
					expect((yield* storage.read("artifact_family", "excalidraw"))?.data).toEqual(
						built.excalidraw,
					);
				}).pipe(Effect.provide(cliBuilderLayer)),
			);
		},
	);

	it.each(DIAGRAM_TYPES)("decodes generated %s JSON into a renderable diagram", (family) => {
		const fixture = familyForType(family).fixture;
		const candidate = candidateFromText({
			model: "fixture",
			provider: "fixture",
			text: generationEnvelope(fixture),
		});
		expect(candidate.error).toBeUndefined();
		const diagram = candidate.diagram ?? expect.fail("Generation output did not produce a diagram");
		expect(diagram).toMatchObject({ id: fixture.id, type: family, title: fixture.title });
		const scene = renderDiagram(diagram).pipe(Result.getOrThrow);
		expect(scene.diagramId).toBe(fixture.id);
		expect(scene.elements.length).toBeGreaterThan(0);
		expect(getCanvasValidationIssues(scene)).toEqual([]);
	});
});
