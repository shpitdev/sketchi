import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import {
	PlaygroundBindings,
	PlaygroundPlatformCallbacks,
	PlaygroundRequestMetadata,
} from "../context.server";
import { runPlaygroundEffect } from "../runtime.server";

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
				const bindings = yield* PlaygroundBindings;
				const metadata = yield* PlaygroundRequestMetadata;
				const platform = yield* PlaygroundPlatformCallbacks;
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
				runPlaygroundEffect(readRequestServices, {
					env: { SKETCHI_STUDIO_MODEL: "first-model" },
					platform: {
						waitUntilPromise: firstWaitUntil,
					},
					request: firstRequest,
				}),
				runPlaygroundEffect(readRequestServices, {
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
});
