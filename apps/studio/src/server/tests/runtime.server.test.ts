import { assert, describe, it } from "@effect/vitest";
import type { TelemetrySpanRow } from "@sketchi/observability";
import { Effect, Stream } from "effect";

import { StudioBindings, StudioPlatformCallbacks, StudioRequestMetadata } from "../context.server";
import { runStudioEffect } from "../runtime.server";

describe("Playground request runtime", () => {
	it.effect("isolates bindings, metadata, and callbacks across concurrent requests", () =>
		Effect.promise(async () => {
			let arrivals = 0;
			const release = Promise.withResolvers<void>();
			const readRequestServices = Effect.gen(function* () {
				arrivals += 1;
				if (arrivals === 2) {
					release.resolve();
				}
				yield* Effect.promise(() => release.promise);
				const bindings = yield* StudioBindings;
				const metadata = yield* StudioRequestMetadata;
				const platform = yield* StudioPlatformCallbacks;
				return { bindings, metadata, platform };
			});
			const firstWaitUntil = () => undefined;
			const secondWaitUntil = () => undefined;
			const firstRequest = new Request("https://first.test/one?value=1", {
				headers: { "x-sketchi-trace-id": "trace-first" },
			});
			const secondRequest = new Request("https://second.test/two?value=2", {
				headers: { "x-sketchi-trace-id": "trace-second" },
			});
			const [first, second] = await Promise.all([
				runStudioEffect(readRequestServices, {
					env: { SKETCHI_STUDIO_MODEL: "first-model" },
					platform: {
						waitUntilPromise: firstWaitUntil,
					},
					request: firstRequest,
				}),
				runStudioEffect(readRequestServices, {
					env: { SKETCHI_STUDIO_MODEL: "second-model" },
					platform: {
						waitUntilPromise: secondWaitUntil,
					},
					request: secondRequest,
				}),
			]);

			assert.strictEqual(first.bindings.SKETCHI_STUDIO_MODEL, "first-model");
			assert.strictEqual(first.metadata.origin, "https://first.test");
			assert.strictEqual(first.metadata.path, "/one?value=1");
			assert.strictEqual(first.metadata.traceId, "trace-first");
			assert.strictEqual(first.platform.waitUntilPromise, firstWaitUntil);
			assert.strictEqual(second.bindings.SKETCHI_STUDIO_MODEL, "second-model");
			assert.strictEqual(second.metadata.origin, "https://second.test");
			assert.strictEqual(second.metadata.path, "/two?value=2");
			assert.strictEqual(second.metadata.traceId, "trace-second");
			assert.strictEqual(second.platform.waitUntilPromise, secondWaitUntil);
		}),
	);

	it.effect("sends a request's spans once its stream and callbacks end, under its waitUntil", () =>
		Effect.promise(async () => {
			const encoder = new TextEncoder();
			const callbackRelease = Promise.withResolvers<void>();
			const sendGate = Promise.withResolvers<void>();
			const sendStarted = Promise.withResolvers<void>();
			const pending: Promise<unknown>[] = [];
			const rows: TelemetrySpanRow[] = [];
			const late = { callback: false, stream: false };
			const lateAtSend: (typeof late)[] = [];
			let source!: ReadableStreamDefaultController<Uint8Array>;
			const handler = Effect.gen(function* () {
				const platform = yield* StudioPlatformCallbacks;
				platform.waitUntil(
					Effect.promise(() => callbackRelease.promise).pipe(
						Effect.andThen(Effect.logInfo("late callback")),
					),
				);
				return new Response(
					new ReadableStream<Uint8Array>({
						start: (controller) => {
							source = controller;
							controller.enqueue(encoder.encode("data: one\n\n"));
						},
					}),
					{ headers: { "content-type": "text/event-stream" } },
				);
			});
			const response = await runStudioEffect(handler, {
				env: {
					TELEMETRY_SPANS: {
						send: (batch) => {
							lateAtSend.push({ ...late });
							rows.push(...(batch as TelemetrySpanRow[]));
							sendStarted.resolve();
							return sendGate.promise;
						},
					},
				},
				platform: { waitUntilPromise: (promise) => void pending.push(promise) },
				request: new Request("https://studio.test/api/studio/chat", {
					headers: { "x-sketchi-run-id": "run-stream" },
				}),
			});
			const reader = response.body!.getReader();
			assert.strictEqual(new TextDecoder().decode((await reader.read()).value), "data: one\n\n");
			source.enqueue(encoder.encode("data: é two\n\n"));
			source.close();
			await reader.read();
			late.stream = (await reader.read()).done;
			late.callback = true;
			callbackRelease.resolve();
			await sendStarted.promise;
			// The send completes a task later; the request's waitUntil must still be waiting for it.
			let sent = false;
			setImmediate(() => {
				sent = true;
				sendGate.resolve();
			});
			await Promise.all(pending);
			assert.isTrue(sent);

			assert.deepStrictEqual(lateAtSend[0], { callback: true, stream: true });
			const root = rows.find((row) => row.name === "playground.request");
			const stream = rows.find((row) => row.name === "playground.response.stream");
			const deferred = rows.find((row) => row.name === "playground.request.deferred");
			assert.strictEqual(stream?.parent_span_id, root?.span_id);
			assert.strictEqual(deferred?.parent_span_id, root?.span_id);
			// @effect-diagnostics-next-line globalJsonInEffect:off -- The test handles fixture JSON independently of the product codec.
			assert.deepInclude(JSON.parse(stream?.attributes ?? "{}"), {
				"http.response.body": "data: one\n\ndata: é two\n\n",
			});
			// @effect-diagnostics-next-line globalJsonInEffect:off -- The test handles fixture JSON independently of the product codec.
			assert.notProperty(JSON.parse(stream?.attributes ?? "{}"), "http.response.body.complete");
			assert.include(deferred?.events, "late callback");
			for (const row of rows) {
				assert.strictEqual(row.run_id, "run-stream", row.name);
				assert.strictEqual(row.trace_id, root?.trace_id, row.name);
			}
			const parts = rows.map((row) => `${row.span_id}:${row.part_index}`);
			assert.strictEqual(new Set(parts).size, parts.length);
		}),
	);

	// A client that leaves mid-stream, or a model call past its deadline, ends spans inside the
	// streamed body after the handler returned; they must still reach the request's rows.
	it.effect.each([
		["the client cancels the body", "cancel"],
		["the request is aborted", "abort"],
		["the model call misses its deadline", "deadline"],
	] as const)("keeps a stream's failed and interrupted spans when %s", ([, ending]) =>
		Effect.promise(async () => {
			const pending: Promise<unknown>[] = [];
			const rows: TelemetrySpanRow[] = [];
			const late: unknown[][] = [];
			const aborted = new AbortController();
			const model =
				ending === "deadline"
					? Effect.never.pipe(
							Effect.withSpan("test.model.attempt"),
							Effect.timeoutOrElse({
								duration: "1 millis",
								// @effect-diagnostics-next-line globalErrorInEffectFailure:off -- Inject an untagged host failure to exercise the request runtime failure boundary.
								orElse: () => Effect.fail(new Error("model deadline")),
							}),
						)
					: Effect.never;
			const handler = Effect.gen(function* () {
				const { request } = yield* StudioRequestMetadata;
				const context = yield* Effect.context<never>();
				const events = Stream.make("data: one\n\n").pipe(
					Stream.concat(Stream.fromEffect(model.pipe(Effect.withSpan("test.model")))),
					Stream.encodeText,
				);
				return new Response(
					Stream.toReadableStreamWith(events, context, { signal: request.signal }),
					{
						headers: { "content-type": "text/event-stream" },
					},
				);
			}).pipe(Effect.withSpan("test.chat"));
			const consoleError = console.error;
			console.error = (...args: unknown[]) => void late.push(args);
			try {
				const response = await runStudioEffect(handler, {
					env: {
						TELEMETRY_SPANS: {
							send: (batch) => {
								rows.push(...(batch as TelemetrySpanRow[]));
								return Promise.resolve();
							},
						},
					},
					platform: { waitUntilPromise: (promise) => void pending.push(promise) },
					request: new Request("https://studio.test/api/studio/chat", { signal: aborted.signal }),
				});
				const reader = response.body!.getReader();
				await reader.read();
				if (ending === "cancel") await reader.cancel("client left");
				else if (ending === "abort") {
					aborted.abort();
					await reader.read();
				} else await reader.read().catch(() => undefined);
				await Promise.all(pending);
			} finally {
				console.error = consoleError;
			}
			const named = (name: string) => rows.find((row) => row.name === name);
			assert.deepStrictEqual(
				late.map(([message, detail]) => [message, (detail as { name?: string })?.name]),
				[],
			);
			assert.strictEqual(
				named("test.model")?.outcome,
				ending === "deadline" ? "failure" : "interrupted",
			);
			if (ending === "deadline")
				assert.strictEqual(named("test.model.attempt")?.outcome, "interrupted");
			assert.isDefined(named("playground.response.stream"));
			assert.isDefined(named("playground.request"));
		}),
	);
});
