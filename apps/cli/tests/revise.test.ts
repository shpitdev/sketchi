import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

import { ArtifactStorageMemory, makeBuildRuntimeEnvironmentLayer } from "@sketchi/diagrams/build";
import { afterEach, assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { DiagramBuilder, DiagramBuilderLive } from "../src/builder";
import { decodeCanonicalDiagramDocument } from "../src/document";
import { DEFAULT_GENERATE_ENDPOINT, reviseDiagram } from "../src/generation";
import { exitCodeForFailure } from "../src/errors";
import { LocalFileSystem } from "../src/filesystem";
import { DiagramPatcher } from "../src/patch";
import { DiagramStore, makeStorageRootLayer } from "../src/store/service";
import { DiagramStoreLive } from "../src/store/live";
import { builtDiagram, flowchartInput, localFileSystemLive, swappableFetch } from "./fixtures";

const buildServicesLayer = Layer.mergeAll(
	ArtifactStorageMemory,
	makeBuildRuntimeEnvironmentLayer({ createId: (prefix) => `${prefix}_revise_test` }),
);
const builderLayer = DiagramBuilderLive.pipe(Layer.provide(buildServicesLayer));
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
		nodes: {
			start: "Change proposed",
			review: "Review evidence",
			approved: "Approved?",
			end: "Release approved",
			rework: "Rework change",
		},
		edges: [
			["start", "review"],
			["review", "approved"],
			["approved", "end", "yes"],
			["approved", "rework", "no"],
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

/** Answer the request only after `edit` commits through its own runtime, as a competing writer would. */
function stubFetchAfter<A, E>(edit: Effect.Effect<A, E>, response: string): void {
	stubFetch(async () => {
		await Effect.runPromise(edit);
		return response;
	});
}

function reviseRequest(diagramId = "release-flow") {
	return reviseDiagram({
		endpoint: DEFAULT_GENERATE_ENDPOINT,
		diagramId,
		prompt: "Add an approval decision after review",
	});
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
						Layer.merge(patcher, swappableFetch),
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

	it.effect("refuses to undo a change committed while the revision was generated", () =>
		withRealStore(
			Effect.gen(function* () {
				const store = yield* DiagramStore;
				yield* store.create(builtDiagram());
				const response = yield* Effect.promise(() => successBody(revisedInput));
				stubFetchAfter(
					store.edit("release-flow", builtDiagram({ title: "Edited meanwhile" })),
					response,
				);

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
});
