import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
	CodeModeArtifactStorageMemory,
	makeCodeModeRuntimeEnvironmentLayer,
} from "@sketchi/diagram-agent";
import { afterEach, assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { DiagramBuilder, DiagramBuilderLive } from "./builder.js";
import type { BuiltDiagram, DiagramAuthority, StoredDiagram } from "./contracts.js";
import { decodeCanonicalDiagramDocument, type DiagramDocument } from "./document.js";
import { DEFAULT_GENERATE_ENDPOINT, reviseDiagram } from "./generation.js";
import { exitCodeForFailure } from "./errors.js";
import { LocalFileSystem } from "./filesystem.js";
import { DiagramStore, DiagramStoreLive, makeStorageRootLayer } from "./storage.js";
import { builtDiagram, flowchartInput, localFileSystemLive } from "./__tests__/fixtures.js";

const builderLayer = DiagramBuilderLive.pipe(
	Layer.provide(
		Layer.mergeAll(
			CodeModeArtifactStorageMemory,
			makeCodeModeRuntimeEnvironmentLayer({ createId: (prefix) => `${prefix}_revise_test` }),
		),
	),
);

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

async function successBody(input: unknown): Promise<string> {
	const built = await build(input);
	return JSON.stringify({
		ok: true,
		status: "generated",
		issues: [],
		diagram: { document: built.document, scene: built.scene, excalidraw: built.excalidraw },
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

function storeLayer(current: StoredDiagram, edited: BuiltDiagram[]) {
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
		commitPatch: () => Effect.die("unused commitPatch"),
		show: () => Effect.succeed(current),
		list: () => Effect.die("unused list"),
		ids: () => Effect.die("unused ids"),
		replaceWithDetached: () => Effect.die("unused replaceWithDetached"),
		readRevision: () => Effect.die("unused readRevision"),
		restore: () => Effect.die("unused restore"),
		readExportSource: () => Effect.die("unused readExportSource"),
	});
}

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
	return reviseRequest(current.manifest.id).pipe(Effect.provide(storeLayer(current, edited)));
}

const testParent = resolve(process.cwd(), ".memory/cli-tests");

/** A real store in a fresh directory, removed afterwards. */
function withRealStore<A, E>(use: Effect.Effect<A, E, DiagramStore>) {
	return Effect.acquireUseRelease(
		Effect.promise(async () => {
			await mkdir(testParent, { recursive: true });
			return mkdtemp(join(testParent, "revise-"));
		}),
		(root) =>
			use.pipe(
				Effect.provide(
					Layer.fresh(DiagramStoreLive).pipe(
						Layer.provide(
							Layer.mergeAll(
								Layer.succeed(LocalFileSystem, localFileSystemLive),
								makeStorageRootLayer(root),
							),
						),
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
