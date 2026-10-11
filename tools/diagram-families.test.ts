/**
 * Every canonical diagram family must complete the pipeline described in
 * docs/diagram-families.md. Each stage below is one test per family, so a
 * family added to DIAGRAM_TYPES without a stage fails with that stage's name.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
	buildCanonicalDocument,
	canonicalDocumentFromDiagram,
	CodeModeArtifactStorage,
	CodeModeArtifactStorageMemory,
	CodeModeRuntimeEnvironment,
	makeCodeModeRuntimeEnvironmentLayer,
	makeMemoryArtifactStorage,
} from "@sketchi/diagram-agent";
import {
	type CanonicalDiagram,
	DIAGRAM_TYPES,
	type DiagramTypeValue,
	diagramFixtures,
	getCanvasValidationIssues,
	parseCanonicalDiagram,
} from "@sketchi/diagram-core";
import { convertSceneToExcalidraw, validateExcalidrawScene } from "@sketchi/diagram-excalidraw";
import {
	buildDiagramGenerationMessages,
	candidateFromText,
	DiagramGenerationTypeSchema,
	UnsupportedDiagramIntentKindSchema,
} from "@sketchi/diagram-generation";
import { renderDiagram } from "@sketchi/diagram-renderer";
import { generationScenarioRegistry } from "@sketchi/diagram-scenarios";
import { Effect, Layer, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { DiagramBuilder, DiagramBuilderLive } from "../apps/cli/src/builder.ts";
import { decodeCanonicalDiagramDocument } from "../apps/cli/src/document.ts";
import { GENERATION_TYPE_OPTIONS } from "../apps/cli/src/generation-types.ts";
import {
	decodeGenerateRequest,
	isNativeGenerateType,
} from "../apps/playground/src/server/generation/request.ts";

const workspaceRoot = fileURLToPath(new URL("../", import.meta.url));

function fixtureFor(family: DiagramTypeValue): CanonicalDiagram {
	const fixture = diagramFixtures.find((diagram) => diagram.type === family);
	if (!fixture) {
		throw new Error(
			`diagram-core exports no fixture for "${family}"; add one to diagramFixtures (packages/diagram/core/src/fixtures.ts).`,
		);
	}
	return fixture;
}

function generationEnvelope(diagram: CanonicalDiagram): string {
	const { title, type, ...rest } = diagram;
	return JSON.stringify({
		title,
		intent: { requestedKind: type, nativeKind: type, requirements: [] },
		diagram: { ...rest, type },
	});
}

const cliBuilderLayer = DiagramBuilderLive.pipe(
	Layer.provide(
		Layer.mergeAll(
			CodeModeArtifactStorageMemory,
			makeCodeModeRuntimeEnvironmentLayer({ createId: (prefix) => `${prefix}_family` }),
		),
	),
);

/** The sentence telling the model which kinds to refuse. */
function unsupportedKindsSentence(system: string): string {
	return (
		/If the requested kind is ([^,]+(?:, [^,]+)*?), set nativeKind to null/u.exec(system)?.[1] ?? ""
	);
}

const stages: Record<string, (family: DiagramTypeValue) => void | Promise<void>> = {
	"core contract and fixture": (family) => {
		expect(existsSync(`${workspaceRoot}packages/diagram/core/src/types/${family}.ts`)).toBe(true);
		const fixture = fixtureFor(family);
		expect(parseCanonicalDiagram(fixture)).toEqual(fixture);
	},
	"deterministic renderer": (family) => {
		expect(getCanvasValidationIssues(renderDiagram(fixtureFor(family)))).toEqual([]);
	},
	"Excalidraw conversion": (family) => {
		const excalidraw = convertSceneToExcalidraw(renderDiagram(fixtureFor(family)));
		expect(validateExcalidrawScene(excalidraw)).toEqual({ ok: true, issues: [] });
	},
	"generation prompt": (family) => {
		expect(Schema.is(DiagramGenerationTypeSchema)(family)).toBe(true);
		expect(Schema.is(UnsupportedDiagramIntentKindSchema)(family)).toBe(false);
		const messages = buildDiagramGenerationMessages({
			id: "family-pipeline",
			request: `Draw a ${family} diagram.`,
			requestedType: family,
		});
		expect(messages.system).toContain(`Use diagram type "${family}".`);
		expect(messages.user).toContain(`"type":"${family}"`);
		// The model is never told to refuse a supported family.
		const refused = unsupportedKindsSentence(messages.system);
		expect(refused).not.toBe("");
		expect(refused.split(/,? or |, /u)).not.toContain(family);
		const modelSelected = buildDiagramGenerationMessages({
			id: "family-pipeline",
			request: "Draw something.",
		});
		expect(modelSelected.user).not.toContain(`"requestedKind":"${family}","nativeKind":null`);
	},
	"generation output parsing": (family) => {
		const candidate = candidateFromText({
			model: "fixture",
			provider: "fixture",
			text: generationEnvelope(fixtureFor(family)),
		});
		expect(candidate.error).toBeUndefined();
		expect(candidate.diagram?.type).toBe(family);
	},
	"Code Mode build": async (family) => {
		const result = await Effect.runPromise(
			buildCanonicalDocument(canonicalDocumentFromDiagram(fixtureFor(family)), {
				artifactFormats: ["scene", "excalidraw"],
			}).pipe(
				Effect.provideService(CodeModeArtifactStorage, makeMemoryArtifactStorage()),
				Effect.provideService(CodeModeRuntimeEnvironment, {
					createId: (prefix) => `${prefix}_family`,
				}),
			),
		);
		expect(result.issues).toEqual([]);
		expect(result.ok).toBe(true);
	},
	"CLI document dispatch": async (family) => {
		const document = canonicalDocumentFromDiagram(fixtureFor(family));
		const built = await Effect.runPromise(
			Effect.gen(function* () {
				const decoded = yield* decodeCanonicalDiagramDocument(document);
				const builder = yield* DiagramBuilder;
				return yield* builder.build(decoded);
			}).pipe(Effect.provide(cliBuilderLayer)),
		);
		expect(built.type).toBe(family);
		expect(built.excalidraw.elements.length).toBeGreaterThan(0);
	},
	"CLI generate type": (family) => {
		expect(GENERATION_TYPE_OPTIONS.map((option) => option.value)).toContain(family);
	},
	"generate API request": (family) => {
		const decoded = decodeGenerateRequest({ prompt: `Draw a ${family} diagram.`, type: family });
		expect(Result.isSuccess(decoded)).toBe(true);
		expect(isNativeGenerateType(family)).toBe(true);
	},
	"maintained scenarios": (family) => {
		expect(generationScenarioRegistry.some((scenario) => scenario.diagramType === family)).toBe(
			true,
		);
	},
	"Storybook story": (family) => {
		expect(
			existsSync(`${workspaceRoot}packages/diagram/ui/src/diagram-types/${family}.stories.tsx`),
		).toBe(true);
	},
};

describe("canonical diagram family pipeline (docs/diagram-families.md)", () => {
	it("documents every stage this test enforces", async () => {
		const { readFile } = await import("node:fs/promises");
		const checklist = await readFile(`${workspaceRoot}docs/diagram-families.md`, "utf8");
		for (const stage of Object.keys(stages)) {
			expect(checklist, stage).toContain(stage);
		}
	});

	for (const family of DIAGRAM_TYPES) {
		for (const [stage, check] of Object.entries(stages)) {
			it(`${family}: ${stage}`, async () => {
				expect.hasAssertions();
				await check(family);
			});
		}
	}
});
