// Positive fixtures deliberately unwrap Results: failure is invalid maintained input.
import {
	canonicalDocumentFromDiagram,
	type CanonicalDiagramDocument,
	CodeModeArtifactStorage,
	CodeModeArtifactStorageMemory,
	makeCodeModeRuntimeEnvironmentLayer,
} from "@sketchi/diagram-agent";
import {
	type CanonicalDiagram,
	DIAGRAM_TYPES,
	type DiagramTypeValue,
	diagramFixtures,
	getCanvasValidationIssues,
	parseCanonicalDiagram,
} from "@sketchi/diagram-core";
import { candidateFromText } from "@sketchi/diagram-generation";
import { renderDiagram } from "@sketchi/diagram-renderer";
import { scenarioFlowchartDocument } from "@sketchi/diagram-scenarios";
import { Effect, Layer, Result } from "effect";
import { describe, expect, it } from "vitest";

import { DiagramBuilder, DiagramBuilderLive } from "../apps/cli/src/builder.ts";
import { parseJsonDocument } from "../apps/cli/src/document.ts";

function fixtureFor(family: DiagramTypeValue): CanonicalDiagram {
	const fixture = diagramFixtures.find((diagram) => diagram.type === family);
	if (!fixture) {
		throw new Error(
			`diagram-core exports no fixture for "${family}"; add one to diagramFixtures (packages/diagram/core/src/fixtures.ts).`,
		);
	}
	return fixture;
}

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
	const diagram = fixtureFor(family);
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
			const fixture = fixtureFor(family);
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
		const fixture = fixtureFor(family);
		const candidate = candidateFromText({
			model: "fixture",
			provider: "fixture",
			text: generationEnvelope(fixture),
		});
		expect(candidate.error).toBeUndefined();
		const diagram = parseCanonicalDiagram(
			candidate.diagram ?? expect.fail("Generation output did not produce a diagram"),
		).pipe(Result.getOrThrow);
		expect(diagram).toEqual(candidate.diagram);
		expect(diagram).toMatchObject({ id: fixture.id, type: family, title: fixture.title });
		const scene = renderDiagram(diagram).pipe(Result.getOrThrow);
		expect(scene.diagramId).toBe(fixture.id);
		expect(scene.elements.length).toBeGreaterThan(0);
		expect(getCanvasValidationIssues(scene)).toEqual([]);
	});
});
