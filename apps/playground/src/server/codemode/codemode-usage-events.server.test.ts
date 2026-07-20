import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import { vi } from "vitest";

import {
  PlaygroundBindings,
  PlaygroundClockLive,
  PlaygroundIds,
  PlaygroundPlatformCallbacks,
  PlaygroundRequestMetadata,
  type PlaygroundRequestServices,
} from "../runtime/playground-context.server";
import {
  PlaygroundCodeModeUsage,
  PlaygroundCodeModeUsageLive,
} from "./codemode-usage-events.server";

const usageTestLayer = Layer.mergeAll(
  PlaygroundClockLive,
  Layer.succeed(PlaygroundIds, {
    create: (prefix) => `${prefix}_test`,
  }),
  PlaygroundCodeModeUsageLive,
);

function requestServices(input: {
  pipeline: { send(records: readonly unknown[]): Promise<void> };
  scheduled: Array<Effect.Effect<void, never, PlaygroundRequestServices>>;
}) {
  const request = new Request("https://studio.test/api/v1/flowcharts/build", {
    method: "POST",
  });
  return <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.provideService(PlaygroundBindings, {
        CODEMODE_USAGE_EVENTS: input.pipeline,
      }),
      Effect.provideService(PlaygroundPlatformCallbacks, {
        waitUntil: (scheduled) => input.scheduled.push(scheduled),
        waitUntilPromise: () => undefined,
      }),
      Effect.provideService(PlaygroundRequestMetadata, {
        method: "POST",
        origin: "https://studio.test",
        path: "/api/v1/flowcharts/build",
        request,
        traceId: "trace_usage_test",
      }),
    );
}

describe("Code Mode usage waitUntil boundary", () => {
  it.layer(usageTestLayer)("deferred sink execution", (it) => {
    it.effect(
      "returns before a successful sink and preserves TestClock time",
      () =>
        Effect.gen(function* () {
          yield* TestClock.setTime(
            new Date("2026-07-20T12:00:00.000Z").getTime(),
          );
          const scheduled: Array<
            Effect.Effect<void, never, PlaygroundRequestServices>
          > = [];
          const records: unknown[] = [];
          const provideRequest = requestServices({
            pipeline: {
              async send(batch) {
                records.push(...batch);
              },
            },
            scheduled,
          });
          const usage = yield* PlaygroundCodeModeUsage;
          const context = yield* provideRequest(usage.createContext);
          yield* provideRequest(
            usage.capture({
              context,
              durationMs: 4,
              operation: "buildFlowchart",
              requestBody: { spec: {} },
              responseBody: { ok: true },
              statusCode: 200,
              surface: "api",
            }),
          );

          assert.strictEqual(records.length, 0);
          assert.strictEqual(scheduled.length, 1);
          const scheduledEffect = scheduled[0];
          if (!scheduledEffect) {
            throw new Error("Expected a deferred usage effect.");
          }
          yield* provideRequest(scheduledEffect);
          assert.strictEqual(records.length, 1);
          assert.deepInclude(records[0], {
            event_time: "2026-07-20T12:00:00.000Z",
            status: "ok",
          });
        }),
    );

    it.effect(
      "contains a typed sink failure without changing response latency",
      () =>
        Effect.gen(function* () {
          const scheduled: Array<
            Effect.Effect<void, never, PlaygroundRequestServices>
          > = [];
          let sinkCalls = 0;
          const warning = vi
            .spyOn(console, "warn")
            .mockImplementation(() => {});
          const provideRequest = requestServices({
            pipeline: {
              async send() {
                sinkCalls += 1;
                throw new Error("usage sink unavailable");
              },
            },
            scheduled,
          });
          const usage = yield* PlaygroundCodeModeUsage;
          const context = yield* provideRequest(usage.createContext);
          yield* provideRequest(
            usage.capture({
              context,
              durationMs: 1,
              operation: "execute",
              requestBody: { code: "async () => ({ ok: true })" },
              responseBody: { ok: true },
              surface: "mcp",
            }),
          );

          assert.strictEqual(sinkCalls, 0);
          assert.strictEqual(scheduled.length, 1);
          const scheduledEffect = scheduled[0];
          if (!scheduledEffect) {
            throw new Error("Expected a deferred usage effect.");
          }
          yield* provideRequest(scheduledEffect);
          assert.strictEqual(sinkCalls, 1);
          assert.strictEqual(warning.mock.calls.length, 1);
          warning.mockRestore();
        }),
    );
  });
});
