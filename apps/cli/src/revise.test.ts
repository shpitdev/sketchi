import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
	CodeModeArtifactStorageMemory,
	makeCodeModeRuntimeEnvironmentLayer,
} from "@sketchi/diagram-agent";
import { afterEach, assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { DiagramBuilder, DiagramBuilderLive } from "./builder.js";
import type {
	BuiltDiagram,
	DiagramAuthority,
	PatchedDiagramArtifacts,
	StoredDiagram,
} from "./contracts.js";
import { decodeCanonicalDiagramDocument, type DiagramDocument } from "./document.js";
import { DEFAULT_GENERATE_ENDPOINT, reviseDiagram } from "./generation.js";
import { exitCodeForFailure } from "./errors.js";
import { LocalFileSystem } from "./filesystem.js";
import { DiagramPatcher, DiagramPatcherLive } from "./patch.js";
import { DiagramStore, DiagramStoreLive, makeStorageRootLayer } from "./storage.js";
import {
	builtDiagram,
	compositeStateMachineInput,
	flowchartInput,
	localFileSystemLive,
} from "./__tests__/fixtures.js";

const codeModeLayer = Layer.mergeAll(
	CodeModeArtifactStorageMemory,
	makeCodeModeRuntimeEnvironmentLayer({ createId: (prefix) => `${prefix}_revise_test` }),
);
const builderLayer = DiagramBuilderLive.pipe(Layer.provide(codeModeLayer));
const patcherLayer = DiagramPatcherLive.pipe(Layer.provide(codeModeLayer));

const build = (input: unknown) =>
	Effect.runPromise(
		Effect.gen(function* () {
			const document = yield* decodeCanonicalDiagramDocument(input);
			const builder = yield* DiagramBuilder;
			return yield* builder.build(document);
		}).pipe(Effect.provide(builderLayer)),
	);

/** The flowchart fixture with an approval decision added after review. */
const revisedInput = {
	type: "flowchart",
	spec: {
		...flowchartInput.spec,
		nodes: [
			{ id: "start", label: "Change proposed", kind: "start" },
			{ id: "review", label: "Review evidence", kind: "process" },
			{ id: "approved", label: "Approved?", kind: "decision" },
			{ id: "end", label: "Release approved", kind: "end" },
			{ id: "rework", label: "Rework change", kind: "end" },
		],
		edges: [
			{ source: "start", target: "review" },
			{ source: "review", target: "approved" },
			{ source: "approved", target: "end", label: "yes" },
			{ source: "approved", target: "rework", label: "no" },
		],
	},
};

async function successBody(
	input: unknown,
	patch?: { operations: unknown[] },
	issues: readonly unknown[] = [],
): Promise<string> {
	const built = await build(input);
	return JSON.stringify({
		ok: true,
		status: "generated",
		issues,
		diagram: {
			document: built.document,
			scene: built.scene,
			excalidraw: built.excalidraw,
			...(patch ? { patch } : {}),
		},
		generation: { model: "claude-haiku-5-5", provider: "cloudflare-anthropic" },
	});
}

function storedRecord(
	document: DiagramDocument,
	authority: DiagramAuthority,
	id = "release-flow",
): StoredDiagram {
	return {
		manifest: {
			schemaVersion: 1,
			id,
			type: document.type,
			title: document.spec.title,
			revision: 1,
			authority,
			formats: ["scene", "excalidraw"],
			prompt: "Map release approval",
		},
		authority,
		document,
		revisions: [],
	};
}

function storeLayer(
	current: StoredDiagram,
	edited: BuiltDiagram[],
	patched: PatchedDiagramArtifacts[] = [],
) {
	return Layer.succeed(DiagramStore, {
		create: () => Effect.die("unused create"),
		edit: Effect.fn("sketchi.cli.storage.testEdit")(function* (diagramId, diagram) {
			edited.push(diagram);
			return {
				...current,
				manifest: { ...current.manifest, id: diagramId, revision: current.manifest.revision + 1 },
				document: diagram.document,
				revisions: ["000001/"],
			};
		}),
		readPatchSource: () => Effect.die("unused readPatchSource"),
		commitPatch: Effect.fn("sketchi.cli.storage.testCommitPatch")(
			function* (diagramId, expectedRevision, artifacts) {
				patched.push(artifacts);
				return {
					...current,
					manifest: {
						...current.manifest,
						id: diagramId,
						revision: expectedRevision + 1,
						authority: "patched" as const,
					},
					authority: "patched" as const,
				};
			},
		),
		show: () => Effect.succeed(current),
		list: () => Effect.die("unused list"),
		ids: () => Effect.die("unused ids"),
		replaceWithDetached: () => Effect.die("unused replaceWithDetached"),
		readRevision: () => Effect.die("unused readRevision"),
		restore: () => Effect.die("unused restore"),
		readExportSource: () => Effect.die("unused readExportSource"),
	});
}

/** Responses without styles never patch. */
const unusedPatcher = Layer.succeed(DiagramPatcher, { patch: () => Effect.die("unused patch") });

const originalFetch = globalThis.fetch;

function stubFetch(handler: (body: Record<string, unknown>) => string | Promise<string>): void {
	globalThis.fetch = async (input, init) => {
		const request = new Request(input, init);
		const body = (await request.json()) as Record<string, unknown>;
		return new Response(await handler(body), { status: 200 });
	};
}

function reviseRequest(diagramId = "release-flow") {
	return reviseDiagram({
		endpoint: DEFAULT_GENERATE_ENDPOINT,
		diagramId,
		prompt: "Add an approval decision after review",
	});
}

function revise(current: StoredDiagram, edited: BuiltDiagram[]) {
	return reviseRequest(current.manifest.id).pipe(
		Effect.provide(Layer.merge(storeLayer(current, edited), unusedPatcher)),
	);
}

const testParent = resolve(process.cwd(), ".memory/cli-tests");

/** A real store in a fresh directory, removed afterwards. */
function withRealStore<A, E>(
	use: Effect.Effect<A, E, DiagramStore | DiagramPatcher>,
	patcher: Layer.Layer<DiagramPatcher> = unusedPatcher,
) {
	return Effect.acquireUseRelease(
		Effect.promise(async () => {
			await mkdir(testParent, { recursive: true });
			return mkdtemp(join(testParent, "revise-"));
		}),
		(root) =>
			use.pipe(
				Effect.provide(
					Layer.merge(
						Layer.fresh(DiagramStoreLive).pipe(
							Layer.provide(
								Layer.mergeAll(
									Layer.succeed(LocalFileSystem, localFileSystemLive),
									makeStorageRootLayer(root),
								),
							),
						),
						patcher,
					),
				),
			),
		(root) => Effect.promise(() => rm(root, { force: true, recursive: true })),
	);
}

describe("revising a stored diagram with a request", () => {
	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it.effect("sends the stored document with the request and keeps the result as a revision", () =>
		Effect.gen(function* () {
			const original = yield* Effect.promise(() => build(flowchartInput));
			const sent: Array<Record<string, unknown>> = [];
			const response = yield* Effect.promise(() => successBody(revisedInput));
			stubFetch((body) => {
				sent.push(body);
				return response;
			});
			const edited: BuiltDiagram[] = [];
			const result = yield* revise(storedRecord(original.document, "canonical"), edited);

			assert.deepStrictEqual(sent[0], {
				prompt: "Add an approval decision after review",
				base: { type: "flowchart", spec: JSON.parse(JSON.stringify(original.document.spec)) },
			});
			assert.strictEqual(edited[0]?.id, "release-flow");
			assert.strictEqual(edited[0]?.document.spec.title, "Release approval");
			assert.strictEqual(result.diagram.manifest.revision, 2);
			assert.strictEqual(result.model, "claude-haiku-5-5");
		}),
	);

	it.effect("draws the colors a request asks for as the revision after the content", () =>
		Effect.gen(function* () {
			const original = yield* Effect.promise(() => build(flowchartInput));
			const response = yield* Effect.promise(() =>
				successBody(flowchartInput, {
					operations: [
						{
							op: "setStyle",
							selector: { nodeIds: ["review"] },
							style: { strokeColor: "#dc2626" },
						},
					],
				}),
			);
			stubFetch(() => response);
			const edited: BuiltDiagram[] = [];
			const patched: PatchedDiagramArtifacts[] = [];
			const result = yield* reviseDiagram({
				endpoint: DEFAULT_GENERATE_ENDPOINT,
				diagramId: "release-flow",
				prompt: "Draw the review step in red",
			}).pipe(
				Effect.provide(
					Layer.merge(
						storeLayer(storedRecord(original.document, "canonical"), edited, patched),
						patcherLayer,
					),
				),
			);

			assert.strictEqual(edited.length, 1);
			assert.strictEqual(patched.length, 1);
			assert.strictEqual(result.diagram.authority, "patched");
			assert.include(JSON.stringify(patched[0]?.scene), "#dc2626");
		}),
	);

	it.effect("keeps the generation's warnings on a revision it also styles", () =>
		withRealStore(
			Effect.gen(function* () {
				const store = yield* DiagramStore;
				yield* store.create(builtDiagram());
				// A composite state without an initial substate builds with a warning.
				const { warnings = [] } = yield* Effect.promise(() => build(compositeStateMachineInput));
				assert.isAbove(warnings.length, 0);
				const response = yield* Effect.promise(() =>
					successBody(
						flowchartInput,
						{
							operations: [
								{
									op: "setStyle",
									selector: { nodeIds: ["review"] },
									style: { strokeColor: "#dc2626" },
								},
							],
						},
						warnings,
					),
				);
				stubFetch(() => response);

				const result = yield* reviseRequest();
				assert.strictEqual(result.diagram.authority, "patched");
				assert.deepStrictEqual(
					result.diagram.warnings?.map((warning) => warning.code),
					warnings.map((warning) => warning.code),
				);
			}),
			patcherLayer,
		),
	);

	it.effect("refuses a patched record without calling the API", () =>
		Effect.gen(function* () {
			const original = yield* Effect.promise(() => build(flowchartInput));
			let called = false;
			stubFetch(() => {
				called = true;
				return "{}";
			});
			const error = yield* Effect.flip(revise(storedRecord(original.document, "patched"), []));
			assert.strictEqual(error._tag, "CliValidationError");
			assert.isFalse(called);
		}),
	);

	it.effect("keeps a record made without an explicit id on its stored id", () =>
		Effect.gen(function* () {
			const { id: _id, ...specWithoutId } = flowchartInput.spec;
			const original = yield* Effect.promise(() =>
				build({ ...flowchartInput, spec: specWithoutId }),
			);
			assert.notProperty(original.document.spec, "id");
			const sent: Array<Record<string, unknown>> = [];
			stubFetch((body) => {
				sent.push(body);
				// Like the API: the revision stays on the base's explicit id, if it has one.
				const { id: _revisedId, ...revisedSpec } = revisedInput.spec;
				const base = body["base"] as { spec: { id?: string } };
				return successBody({
					...revisedInput,
					spec: {
						...revisedSpec,
						title: "Release approval with sign-off",
						...(base.spec.id === undefined ? {} : { id: base.spec.id }),
					},
				});
			});
			const edited: BuiltDiagram[] = [];
			yield* revise(storedRecord(original.document, "canonical", "release-approval"), edited);

			const base = sent[0]?.["base"] as { spec: { id?: string } };
			assert.strictEqual(base.spec.id, "release-approval");
			assert.strictEqual(edited[0]?.id, "release-approval");
			assert.strictEqual(edited[0]?.title, "Release approval with sign-off");
		}),
	);

	it.effect("refuses to undo a change committed while the revision was generated", () =>
		withRealStore(
			Effect.gen(function* () {
				const store = yield* DiagramStore;
				yield* store.create(builtDiagram());
				const response = yield* Effect.promise(() => successBody(revisedInput));
				stubFetch(async () => {
					await Effect.runPromise(
						store.edit("release-flow", builtDiagram({ title: "Edited meanwhile" })),
					);
					return response;
				});

				const error = yield* Effect.flip(reviseRequest());
				assert.strictEqual(error._tag, "CliStorageError");
				if (error._tag === "CliStorageError") assert.strictEqual(error.code, "edit_conflict");
				assert.strictEqual(exitCodeForFailure(error), 6);
				const current = yield* store.show("release-flow");
				assert.strictEqual(current.manifest.revision, 2);
				assert.strictEqual(current.manifest.title, "Edited meanwhile");
			}),
		),
	);

	it.effect("refuses a revised document that names another diagram", () =>
		Effect.gen(function* () {
			const original = yield* Effect.promise(() => build(flowchartInput));
			const response = yield* Effect.promise(() =>
				successBody({ ...revisedInput, spec: { ...revisedInput.spec, id: "other-flow" } }),
			);
			stubFetch(() => response);
			const edited: BuiltDiagram[] = [];
			const error = yield* Effect.flip(
				revise(storedRecord(original.document, "canonical"), edited),
			);
			assert.strictEqual(error._tag, "CliGenerationError");
			assert.strictEqual(edited.length, 0);
		}),
	);
});
