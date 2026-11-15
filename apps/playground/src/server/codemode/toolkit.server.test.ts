import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber } from "effect";
import { PlaygroundRequestMetadata } from "../runtime/context.server";
import { PlaygroundRequestCallbacks, runPlaygroundEffect } from "../runtime/runtime.server";
import { getCodeModeDocs, searchCodeModeDocs } from "./mcp-docs.server";
import { SketchiToolkit, dispatchSketchiTool, makeSketchiToolHandlers } from "./toolkit.server";

describe("shared Sketchi Toolkit", () => {
	it("runs the actual docs, search and execute handlers without an MCP server", async () => {
		const result = await runPlaygroundEffect(
			Effect.gen(function* () {
				const callbacks = yield* PlaygroundRequestCallbacks;
				return yield* Effect.all({
					docs: dispatchSketchiTool(SketchiToolkit.tools.docs, {}),
					search: dispatchSketchiTool(SketchiToolkit.tools.search, {
						query: "flowchart",
						limit: 2,
					}),
					execute: dispatchSketchiTool(SketchiToolkit.tools.execute, {
						code: "async () => ({ ok: false })",
					}),
				}).pipe(
					Effect.provide(
						makeSketchiToolHandlers(callbacks.runPromise, {
							executor: {
								execute: async () => ({ result: { ok: false, reason: "optional step skipped" } }),
							},
						}),
					),
				);
			}),
			{
				env: {},
				request: new Request("https://shared.test/mcp"),
				platform: { waitUntilPromise: () => {} },
			},
		);
		expect(result.docs).toEqual(getCodeModeDocs({}));
		expect(result.search).toEqual(searchCodeModeDocs({ query: "flowchart", limit: 2 }));
		expect(result.execute).toMatchObject({
			ok: true,
			result: { ok: false, reason: "optional step skipped" },
			builds: [],
		});
	});

	it.effect("finalizes an injected handler when its Toolkit consumer is interrupted", () =>
		Effect.gen(function* () {
			const started = yield* Deferred.make<void>();
			const released = yield* Deferred.make<void>();
			const handlers = SketchiToolkit.toLayer({
				docs: () =>
					Effect.acquireUseRelease(
						Deferred.succeed(started, undefined),
						() => Effect.never,
						() => Deferred.succeed(released, undefined),
					),
				search: (input) => Effect.succeed(searchCodeModeDocs(input)),
				execute: () => Effect.die("This test must not execute code"),
			});
			const fiber = yield* dispatchSketchiTool(SketchiToolkit.tools.docs, {}).pipe(
				Effect.provide(handlers),
				Effect.forkChild,
			);
			yield* Deferred.await(started);
			yield* Fiber.interrupt(fiber);
			expect(yield* Deferred.isDone(released)).toBe(true);
		}),
	);

	it("captures request metadata independently for concurrent Toolkit calls", async () => {
		const handlers = SketchiToolkit.toLayer({
			docs: (input) => Effect.succeed(getCodeModeDocs(input)),
			search: (input) => Effect.succeed(searchCodeModeDocs(input)),
			execute: () =>
				Effect.map(PlaygroundRequestMetadata, (metadata) => ({
					ok: true,
					builds: [],
					result: metadata.origin,
				})),
		});
		const call = (origin: string) =>
			runPlaygroundEffect(
				dispatchSketchiTool(SketchiToolkit.tools.execute, { code: "async () => null" }).pipe(
					Effect.provide(handlers),
				),
				{
					env: {},
					request: new Request(`${origin}/mcp`),
					platform: { waitUntilPromise: () => {} },
				},
			);
		const results = await Promise.all([call("https://first.test"), call("https://second.test")]);
		expect(results.map((result) => result.result)).toEqual([
			"https://first.test",
			"https://second.test",
		]);
	});
});
