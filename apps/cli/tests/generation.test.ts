// @effect-diagnostics nodeBuiltinImport:off -- The CLI contract harness owns a local HTTP server, real child processes and temporary document files.

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { ArtifactStorageMemory, makeBuildRuntimeEnvironmentLayer } from "@sketchi/diagrams/build";
import { afterEach, assert, describe, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Layer, Result } from "effect";
import { TestClock } from "effect/testing";

import { DiagramBuilder, DiagramBuilderLive } from "../src/builder";
import type { BuiltDiagram, StoredDiagram } from "../src/contracts";
import { decodeCanonicalDiagramDocument } from "../src/document";
import { exitCodeForFailure } from "../src/errors";
import { DEFAULT_GENERATE_ENDPOINT, generateDiagram } from "../src/generation";
import { DiagramPatcher } from "../src/patch";
import { DiagramStore } from "../src/store/service";
import { flowchartInput, sequenceInput, swappableFetch } from "./fixtures";

const builderLayer = DiagramBuilderLive.pipe(
	Layer.provide(
		Layer.mergeAll(
			ArtifactStorageMemory,
			makeBuildRuntimeEnvironmentLayer({
				createId: (prefix) => `${prefix}_generate_test`,
			}),
		),
	),
);

async function buildSuccessBody(input: unknown): Promise<string> {
	const body = await Effect.runPromise(
		Effect.gen(function* () {
			const document = yield* decodeCanonicalDiagramDocument(input);
			const builder = yield* DiagramBuilder;
			const built = yield* builder.build(document);
			return {
				ok: true,
				status: "generated",
				issues: built.warnings ?? [],
				diagram: {
					document: built.document,
					scene: built.scene,
					excalidraw: built.excalidraw,
				},
				generation: {
					model: "claude-haiku-5-5",
					provider: "cloudflare-anthropic",
				},
			};
		}).pipe(Effect.provide(builderLayer)),
	);
	return JSON.stringify(body);
}

function stored(diagram: BuiltDiagram): StoredDiagram {
	return {
		manifest: {
			schemaVersion: 1,
			id: diagram.id,
			type: diagram.type,
			title: diagram.title,
			revision: 1,
			authority: "canonical",
			formats: ["scene", "excalidraw"],
		},
		authority: "canonical",
		document: diagram.document,
		revisions: [],
		...(diagram.warnings?.length ? { warnings: diagram.warnings } : {}),
	};
}

function capturingStoreLayer(created: BuiltDiagram[]) {
	return Layer.merge(swappableFetch, capturingStore(created));
}

function capturingStore(created: BuiltDiagram[]) {
	return Layer.succeed(DiagramStore, {
		create: Effect.fn("sketchi.cli.storage.testCreate")(function* (diagram) {
			created.push(diagram);
			return stored(diagram);
		}),
		edit: () => Effect.die("unused edit"),
		readPatchSource: () => Effect.die("unused readPatchSource"),
		commitPatch: () => Effect.die("unused commitPatch"),
		show: () => Effect.die("unused show"),
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

function stubFetch(handler: (request: Request) => Response | Promise<Response>): void {
	globalThis.fetch = (input, init) =>
		Promise.resolve().then(() => handler(new Request(input, init)));
}

function jsonResponse(body: unknown, status: number): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function runGenerate(
	created: BuiltDiagram[],
	type?: Parameters<typeof generateDiagram>[0]["type"],
) {
	return generateDiagram({
		endpoint: DEFAULT_GENERATE_ENDPOINT,
		prompt: "Create a diagram",
		...(type ? { type } : {}),
		// @effect-diagnostics-next-line strictEffectProvide:off -- The test is the runtime entry point for this fixture layer.
	}).pipe(Effect.provide(Layer.merge(capturingStoreLayer(created), unusedPatcher)));
}

const binary = resolve(process.cwd(), "apps/cli/dist/sketchi.js");
const testParent = resolve(process.cwd(), ".memory/cli-tests");
const exec = promisify(execFile);

it.each(["generate", "revise"] as const)(
	"does not replay a %s POST after a 421 even when a second POST would succeed",
	async (command) => {
		const success = await buildSuccessBody(flowchartInput);
		const received: string[] = [];
		const path = "/api/v1/generate";
		const server = createServer((request, response) => {
			received.push(`${request.method} ${request.url}`);
			request.resume();
			request.on("end", () => {
				response.setHeader("content-type", "application/json");
				response.statusCode = received.length === 1 ? 421 : 200;
				response.end(response.statusCode === 421 ? "{}" : success);
			});
		});
		await mkdir(testParent, { recursive: true });
		const root = await mkdtemp(join(testParent, "generate-replay-"));
		try {
			// @effect-diagnostics-next-line newPromise:off -- The transport fixture exposes native Promise boundaries for an HTTP server and stalled fetch body.
			await new Promise<void>((listening) => server.listen(0, "127.0.0.1", listening));
			const address = server.address();
			if (!address || typeof address === "string") throw new Error("Expected a TCP address.");
			const run = (args: string[]) =>
				exec(process.execPath, [binary, ...args, "--output", "json"], {
					cwd: root,
					env: { ...process.env, HOME: root, USERPROFILE: root },
					timeout: 30_000,
				});
			const args: string[] = [command];
			if (command === "revise") {
				await run(["create", "--json", JSON.stringify(flowchartInput)]);
				args.push(flowchartInput.spec.id);
			}
			const code = await run([
				...args,
				"--prompt",
				"Draw a release approval flowchart",
				"--endpoint",
				`http://127.0.0.1:${String(address.port)}${path}`,
				"--format",
				"excalidraw",
			]).then(
				() => 0,
				(error: unknown) => {
					if (error instanceof Error && "code" in error && typeof error.code === "number") {
						return error.code;
					}
					throw error;
				},
			);
			assert.deepStrictEqual(received, [`POST ${path}`], `CLI exited ${String(code)}`);
			assert.strictEqual(code, 10);
		} finally {
			await server[Symbol.asyncDispose]();
			await rm(root, { force: true, recursive: true });
		}
	},
);

describe("prompt-assisted generation over the public generate API", () => {
	for (const stall of ["headers", "body"] as const) {
		it.effect(`bounds stalled generation ${stall} without persisting`, () =>
			Effect.gen(function* () {
				const started = yield* Deferred.make<void>();
				let signal: AbortSignal | null | undefined;
				let bodyCancelled = false;
				globalThis.fetch = (_input, init) => {
					signal = init?.signal;
					if (stall === "headers")
						// @effect-diagnostics-next-line newPromise:off -- The transport fixture exposes native Promise boundaries for an HTTP server and stalled fetch body.
						return new Promise<Response>(() => {
							Deferred.doneUnsafe(started, Effect.void);
						});
					return Promise.resolve(
						new Response(
							new ReadableStream<Uint8Array>({
								pull() {
									Deferred.doneUnsafe(started, Effect.void);
								},
								cancel() {
									bodyCancelled = true;
								},
							}),
						),
					);
				};
				const created: BuiltDiagram[] = [];
				const fiber = yield* Effect.flip(runGenerate(created)).pipe(Effect.forkChild);
				yield* Deferred.await(started);
				// A large diagram's model calls may take two minutes; the CLI waits past them.
				yield* TestClock.adjust("149 seconds");
				assert.isUndefined(fiber.pollUnsafe());
				yield* TestClock.adjust("1 second");
				assert.isDefined(fiber.pollUnsafe());
				const error = yield* Fiber.join(fiber);
				assert.strictEqual(error._tag, "CliGenerationError");
				if (error._tag === "CliGenerationError") {
					assert.strictEqual(error.code, "generation_timeout");
					assert.strictEqual(exitCodeForFailure(error), 11);
				}
				assert.isTrue(stall === "headers" ? signal?.aborted : bodyCancelled);
				assert.strictEqual(created.length, 0);
			}),
		);
	}

	it.effect("rejects oversized generation bodies before buffering or persisting", () =>
		Effect.gen(function* () {
			let cancelled = false;
			globalThis.fetch = () =>
				Promise.resolve(
					new Response(
						new ReadableStream<Uint8Array>({
							start(controller) {
								controller.enqueue(new Uint8Array(16 * 1024 * 1024 + 1));
							},
							cancel() {
								cancelled = true;
							},
						}),
					),
				);
			const created: BuiltDiagram[] = [];
			const error = yield* Effect.flip(runGenerate(created));
			assert.strictEqual(error._tag, "CliGenerationError");
			if (error._tag === "CliGenerationError") assert.strictEqual(error.code, "malformed_output");
			assert.isTrue(cancelled);
			assert.strictEqual(created.length, 0);
		}),
	);

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it.effect("accepts published warnings and rejects an unknown accepted code before storage", () =>
		Effect.gen(function* () {
			// @effect-diagnostics-next-line globalJsonInEffect:off -- The test handles fixture JSON independently of the product codec.
			const original = JSON.parse(yield* Effect.promise(() => buildSuccessBody(sequenceInput)));
			for (const code of ["unknown_icon", "sequence_future_warning"]) {
				const body = {
					...original,
					issues: [
						{
							code,
							severity: "warning",
							stage: "input",
							message: "Logo omitted.",
							hint: "Choose an offered logo.",
						},
					],
				};
				stubFetch(() => jsonResponse(body, 200));
				const created: BuiltDiagram[] = [];
				const result = yield* Effect.result(runGenerate(created, "sequence"));
				if (code === "unknown_icon") {
					assert.isTrue(Result.isSuccess(result));
					assert.strictEqual(created.length, 1);
				} else {
					assert.isTrue(Result.isFailure(result));
					assert.strictEqual(created.length, 0);
					if (Result.isFailure(result)) assert.strictEqual(exitCodeForFailure(result.failure), 12);
				}
			}
		}),
	);

	it.effect("persists a generated flowchart returned by the endpoint", () =>
		Effect.gen(function* () {
			const body = yield* Effect.promise(() => buildSuccessBody(flowchartInput));
			stubFetch(() => new Response(body, { status: 200 }));
			const created: BuiltDiagram[] = [];

			const result = yield* runGenerate(created, "flowchart");

			assert.strictEqual(result.diagram.manifest.id, flowchartInput.spec.id);
			assert.strictEqual(result.diagram.document.type, "flowchart");
			assert.strictEqual(result.provider, "cloudflare-anthropic");
			assert.strictEqual(result.model, "claude-haiku-5-5");
			assert.strictEqual(created.length, 1);
		}),
	);

	it.effect("maps a network-down failure to a typed provider error", () =>
		Effect.gen(function* () {
			globalThis.fetch = () => Promise.reject(new Error("NETWORK_DOWN"));
			const created: BuiltDiagram[] = [];

			const error = yield* Effect.flip(runGenerate(created, "flowchart"));

			assert.strictEqual(error._tag, "CliGenerationError");
			if (error._tag === "CliGenerationError") {
				assert.strictEqual(error.code, "provider_failure");
			}
			assert.strictEqual(created.length, 0);
		}),
	);

	it.effect("maps an endpoint rejection to a typed invalid-document error", () =>
		Effect.gen(function* () {
			stubFetch(() =>
				jsonResponse(
					{
						ok: false,
						status: "invalid_generated_document",
						issues: [
							{
								code: "invalid_generated_document",
								severity: "error",
								stage: "generation",
								message: "The generated diagram failed validation.",
								hint: "Refine the prompt.",
							},
						],
					},
					422,
				),
			);
			const created: BuiltDiagram[] = [];

			const error = yield* Effect.flip(runGenerate(created, "flowchart"));

			assert.strictEqual(error._tag, "CliGenerationError");
			if (error._tag === "CliGenerationError") {
				assert.strictEqual(error.code, "invalid_generated_document");
				assert.deepStrictEqual(error.details, [
					"http_status:422",
					"The generated diagram failed validation.",
					"Refine the prompt.",
				]);
			}
			assert.strictEqual(created.length, 0);
		}),
	);

	it.effect("maps a provider endpoint error to a typed provider failure", () =>
		Effect.gen(function* () {
			stubFetch(() => jsonResponse({ ok: false, status: "provider_failed", issues: [] }, 502));
			const created: BuiltDiagram[] = [];

			const error = yield* Effect.flip(runGenerate(created, "flowchart"));

			assert.strictEqual(error._tag, "CliGenerationError");
			if (error._tag === "CliGenerationError") {
				assert.strictEqual(error.code, "provider_failure");
			}
			assert.strictEqual(created.length, 0);
		}),
	);

	it.effect("maps an endpoint timeout to a typed timeout failure", () =>
		Effect.gen(function* () {
			stubFetch(() => jsonResponse({ ok: false, status: "generation_timeout", issues: [] }, 504));
			const created: BuiltDiagram[] = [];

			const error = yield* Effect.flip(runGenerate(created, "flowchart"));

			assert.strictEqual(error._tag, "CliGenerationError");
			if (error._tag === "CliGenerationError") {
				assert.strictEqual(error.code, "generation_timeout");
			}
			assert.strictEqual(created.length, 0);
		}),
	);

	it.effect("rejects a returned document that fails schema validation", () =>
		Effect.gen(function* () {
			stubFetch(() =>
				jsonResponse(
					{
						ok: true,
						status: "generated",
						issues: [],
						diagram: {
							document: { type: "flowchart", spec: { id: "x" } },
							scene: {},
							excalidraw: {},
						},
						generation: {
							model: "claude-haiku-5-5",
							provider: "cloudflare-anthropic",
						},
					},
					200,
				),
			);
			const created: BuiltDiagram[] = [];

			const error = yield* Effect.flip(runGenerate(created, "flowchart"));

			assert.strictEqual(error._tag, "CliGenerationError");
			if (error._tag === "CliGenerationError") {
				assert.strictEqual(error.code, "invalid_generated_document");
			}
			assert.strictEqual(created.length, 0);
		}),
	);
});
