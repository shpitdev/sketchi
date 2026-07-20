import { assert, describe, expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";

import {
  PlaygroundBindings,
  PlaygroundPlatformCallbacks,
  PlaygroundRequestMetadata,
} from "./playground-context.server";
import {
  makePlaygroundRuntime,
  PlaygroundRequestCallbacks,
  runPlaygroundEffect,
} from "./playground-runtime.server";

function requestBoundary(
  request: Request,
  waitUntilPromise: (promise: Promise<unknown>) => void = () => undefined,
) {
  return {
    env: {},
    platform: { waitUntilPromise },
    request,
  };
}

const observeRequestContext = Effect.gen(function* () {
  const metadata = yield* PlaygroundRequestMetadata;
  const span = yield* Effect.currentSpan;
  const parent = Option.getOrUndefined(span.parent);
  return {
    parentSpanId: parent?.spanId,
    spanName: span.name,
    spanId: span.spanId,
    spanTraceId: span.traceId,
    traceId: metadata.traceId,
  };
});

describe("Playground request runtime", () => {
  it.effect(
    "isolates bindings, metadata, and callbacks across concurrent requests",
    () =>
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
            env: { SKETCHI_AI_MODEL: "first-model" },
            platform: {
              waitUntilPromise: firstWaitUntil,
            },
            request: firstRequest,
          }),
          runPlaygroundEffect(readRequestServices, {
            env: { SKETCHI_AI_MODEL: "second-model" },
            platform: {
              waitUntilPromise: secondWaitUntil,
            },
            request: secondRequest,
          }),
        ]);

        assert.strictEqual(first.bindings.SKETCHI_AI_MODEL, "first-model");
        assert.strictEqual(first.metadata.origin, "https://first.test");
        assert.strictEqual(first.metadata.path, "/one?value=1");
        assert.strictEqual(first.metadata.traceId, "trace-first");
        assert.strictEqual(first.platform.waitUntilPromise, firstWaitUntil);
        assert.strictEqual(second.bindings.SKETCHI_AI_MODEL, "second-model");
        assert.strictEqual(second.metadata.origin, "https://second.test");
        assert.strictEqual(second.metadata.path, "/two?value=2");
        assert.strictEqual(second.metadata.traceId, "trace-second");
        assert.strictEqual(second.platform.waitUntilPromise, secondWaitUntil);
      }),
  );

  it.effect("preserves request metadata and trace across callbacks", () =>
    Effect.promise(async () => {
      const request = new Request("https://studio.test/mcp", {
        headers: { "x-sketchi-trace-id": "trace-callback" },
      });
      const result = await runPlaygroundEffect(
        Effect.gen(function* () {
          const callbacks = yield* PlaygroundRequestCallbacks;
          const requestContext = yield* observeRequestContext;
          return {
            callback: callbacks.runPromise(observeRequestContext),
            requestContext,
          };
        }),
        requestBoundary(request),
      );

      const callbackContext = await result.callback;
      assert.strictEqual(
        callbackContext.spanTraceId,
        result.requestContext.spanTraceId,
      );
      assert.strictEqual(
        callbackContext.parentSpanId,
        result.requestContext.spanId,
      );
      assert.strictEqual(
        callbackContext.spanName,
        "playground.request.callback",
      );
      assert.strictEqual(callbackContext.traceId, "trace-callback");
    }),
  );

  it.effect("interrupts request callbacks when the request is aborted", () =>
    Effect.promise(async () => {
      const controller = new AbortController();
      const started = Promise.withResolvers<void>();
      let interrupted = false;
      const result = await runPlaygroundEffect(
        Effect.gen(function* () {
          const callbacks = yield* PlaygroundRequestCallbacks;
          return {
            callback: callbacks.runPromise(
              Effect.sync(() => started.resolve()).pipe(
                Effect.andThen(Effect.never),
                Effect.onInterrupt(() =>
                  Effect.sync(() => {
                    interrupted = true;
                  }),
                ),
              ),
            ),
          };
        }),
        requestBoundary(
          new Request("https://studio.test/api/chat", {
            signal: controller.signal,
          }),
        ),
      );

      await started.promise;
      controller.abort();
      await expect(result.callback).rejects.toBeDefined();
      assert.isTrue(interrupted);
    }),
  );

  it.effect(
    "defers waitUntil work without delaying the response and keeps request context",
    () =>
      Effect.promise(async () => {
        const release = Promise.withResolvers<void>();
        let scheduled: Promise<unknown> | undefined;
        const observation = Promise.withResolvers<{
          parentSpanId: string | undefined;
          spanId: string;
          spanName: string;
          spanTraceId: string;
          traceId: string;
        }>();
        let deferredCompleted = false;
        const response = await runPlaygroundEffect(
          Effect.gen(function* () {
            const platform = yield* PlaygroundPlatformCallbacks;
            const requestContext = yield* observeRequestContext;
            platform.waitUntil(
              Effect.promise(() => release.promise).pipe(
                Effect.andThen(
                  observeRequestContext.pipe(
                    Effect.tap((context) =>
                      Effect.sync(() => {
                        deferredCompleted = true;
                        observation.resolve(context);
                      }),
                    ),
                    Effect.orDie,
                  ),
                ),
                Effect.asVoid,
              ),
            );
            return { requestContext, status: 202 };
          }),
          requestBoundary(
            new Request("https://studio.test/api/v1/flowcharts/build", {
              headers: { "x-sketchi-trace-id": "trace-deferred" },
              method: "POST",
            }),
            (promise) => {
              scheduled = promise;
            },
          ),
        );

        assert.strictEqual(response.status, 202);
        assert.isFalse(deferredCompleted);
        assert.isDefined(scheduled);
        release.resolve();
        await scheduled;
        const observed = await observation.promise;
        assert.strictEqual(
          observed.spanTraceId,
          response.requestContext.spanTraceId,
        );
        assert.strictEqual(
          observed.parentSpanId,
          response.requestContext.spanId,
        );
        assert.strictEqual(observed.spanName, "playground.request.deferred");
        assert.strictEqual(observed.traceId, "trace-deferred");
      }),
  );

  it.effect("interrupts deferred work when the host runtime is disposed", () =>
    Effect.promise(async () => {
      const runtime = makePlaygroundRuntime();
      const started = Promise.withResolvers<void>();
      let interrupted = false;
      let scheduled: Promise<unknown> | undefined;

      try {
        const response = await runtime.run(
          Effect.gen(function* () {
            const platform = yield* PlaygroundPlatformCallbacks;
            platform.waitUntil(
              Effect.sync(() => started.resolve()).pipe(
                Effect.andThen(Effect.never),
                Effect.onInterrupt(() =>
                  Effect.sync(() => {
                    interrupted = true;
                  }),
                ),
              ),
            );
            return new Response(null, { status: 204 });
          }),
          requestBoundary(
            new Request("https://studio.test/api/v1/flowcharts/build"),
            (promise) => {
              scheduled = promise;
            },
          ),
        );

        assert.strictEqual(response.status, 204);
        await started.promise;
        assert.isDefined(scheduled);
        await runtime.dispose();
        await expect(scheduled).rejects.toBeDefined();
        assert.isTrue(interrupted);
      } finally {
        await runtime.dispose();
      }
    }),
  );
});
