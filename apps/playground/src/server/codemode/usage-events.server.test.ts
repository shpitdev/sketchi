import { assert, describe, expect, it } from "@effect/vitest";
import {
  makeTelemetryTestSink,
  makeWorkersTelemetryLayer,
  type TelemetryLogEvent,
  type TelemetryMetricEvent,
} from "@sketchi/observability";
import { Effect, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";

import type { CodeModeObjectBucket } from "@sketchi/diagram-agent";

import {
  PlaygroundBindings,
  PlaygroundClockLive,
  PlaygroundIds,
  PlaygroundPlatformCallbacks,
  PlaygroundRequestMetadata,
  type PlaygroundRequestServices,
} from "../runtime/context.server";
import {
  PlaygroundCodeModeUsage,
  PlaygroundCodeModeUsageLive,
} from "./usage-events.server";

const usageTestLayer = Layer.mergeAll(
  PlaygroundClockLive,
  Layer.succeed(PlaygroundIds, {
    create: (prefix) => `${prefix}_test`,
  }),
  PlaygroundCodeModeUsageLive,
);

function requestServices(input: {
  bucket?: CodeModeObjectBucket;
  issuePipeline?: { send(records: readonly unknown[]): Promise<void> };
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
        ...(input.bucket ? { SKETCHI_ARTIFACTS: input.bucket } : {}),
        ...(input.issuePipeline
          ? { CODEMODE_USAGE_ISSUES: input.issuePipeline }
          : {}),
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
          assert.deepStrictEqual(records[0], {
            artifact_count: 0,
            artifact_delivery: false,
            attempt_id: "attempt_test",
            duration_ms: 4,
            event_date: "2026-07-20",
            event_id: "event_test",
            event_key:
              "codemode/usage/2026/07/20/run_test/attempt_test/event_test/event.json",
            event_time: "2026-07-20T12:00:00.000Z",
            issue_count: 0,
            operation: "buildFlowchart",
            request_method: "POST",
            request_path: "/api/v1/flowcharts/build",
            request_snapshot_bytes: 11,
            response_snapshot_bytes: 11,
            run_id: "run_test",
            schema: "sketchi.codemode.usage.v1",
            status: "ok",
            status_code: 200,
            surface: "api",
          });
        }),
    );

    it.effect("preserves the exact failure event and issue rows", () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(
          new Date("2026-07-20T12:00:00.000Z").getTime(),
        );
        const scheduled: Array<
          Effect.Effect<void, never, PlaygroundRequestServices>
        > = [];
        const eventRows: unknown[] = [];
        const issueRows: unknown[] = [];
        const provideRequest = requestServices({
          issuePipeline: {
            async send(batch) {
              issueRows.push(...batch);
            },
          },
          pipeline: {
            async send(batch) {
              eventRows.push(...batch);
            },
          },
          scheduled,
        });
        const usage = yield* PlaygroundCodeModeUsage;
        const context = yield* provideRequest(usage.createContext);
        yield* provideRequest(
          usage.capture({
            context,
            durationMs: 7,
            operation: "buildFlowchart",
            requestBody: { spec: {} },
            responseBody: {
              issues: [
                {
                  code: "invalid_node",
                  message: "Node missing",
                  severity: "error",
                  stage: "validation",
                },
              ],
              ok: false,
            },
            statusCode: 400,
            surface: "api",
          }),
        );

        const scheduledEffect = scheduled[0];
        if (!scheduledEffect) {
          throw new Error("Expected a deferred usage effect.");
        }
        yield* provideRequest(scheduledEffect);
        assert.deepStrictEqual(eventRows, [
          {
            artifact_count: 0,
            artifact_delivery: false,
            attempt_id: "attempt_test",
            duration_ms: 7,
            error_message: "Node missing",
            event_date: "2026-07-20",
            event_id: "event_test",
            event_key:
              "codemode/usage/2026/07/20/run_test/attempt_test/event_test/event.json",
            event_time: "2026-07-20T12:00:00.000Z",
            issue_codes: "invalid_node",
            issue_count: 1,
            operation: "buildFlowchart",
            request_method: "POST",
            request_path: "/api/v1/flowcharts/build",
            request_snapshot_bytes: 11,
            response_snapshot_bytes: 112,
            run_id: "run_test",
            schema: "sketchi.codemode.usage.v1",
            status: "error",
            status_code: 400,
            surface: "api",
          },
        ]);
        assert.deepStrictEqual(issueRows, [
          {
            attempt_id: "attempt_test",
            event_date: "2026-07-20",
            event_id: "event_test",
            event_key:
              "codemode/usage/2026/07/20/run_test/attempt_test/event_test/event.json",
            event_time: "2026-07-20T12:00:00.000Z",
            issue_code: "invalid_node",
            issue_message: "Node missing",
            issue_path: "response.issues[0]",
            issue_severity: "error",
            issue_stage: "validation",
            operation: "buildFlowchart",
            run_id: "run_test",
            schema: "sketchi.codemode.usage.v1",
            status: "error",
            surface: "api",
          },
        ]);
      }),
    );

    it.effect(
      "contains a typed sink failure without changing response latency",
      () => {
        const { probe, sink } = makeTelemetryTestSink();
        const telemetryLayer = makeWorkersTelemetryLayer({
          resource: { serviceName: "sketchi-usage-test" },
          sink,
        });
        return Effect.gen(function* () {
          const scheduled: Array<
            Effect.Effect<void, never, PlaygroundRequestServices>
          > = [];
          let sinkCalls = 0;
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
          const logs = probe.events.filter(
            (event): event is TelemetryLogEvent => event.event === "effect.log",
          );
          const metrics = probe.events.filter(
            (event): event is TelemetryMetricEvent =>
              event.event === "effect.metric",
          );
          assert.strictEqual(logs.length, 1);
          assert.deepStrictEqual(logs[0]?.fields, {
            error_tag: "CodeModeUsageCaptureError",
            operation: "execute",
            sink: "analytics",
            surface: "mcp",
          });
          assert.strictEqual(
            logs[0]?.annotations["sketchi.run_id"],
            "run_test",
          );
          assert.deepInclude(
            metrics.find(
              (metric) =>
                metric.metric === "sketchi_codemode_usage_capture_failures",
            )?.attributes,
            {
              failure_category: "CodeModeUsageCaptureError",
              operation: "execute",
              sink: "analytics",
              surface: "mcp",
            },
          );
        }).pipe(Effect.provide(telemetryLayer));
      },
    );
  });
});

describe("usage capture sink isolation", () => {
  it.effect(
    "completes the artifact write while analytics never resolves",
    () => {
      const { probe, sink } = makeTelemetryTestSink();
      return Effect.gen(function* () {
        const scheduled: Array<
          Effect.Effect<void, never, PlaygroundRequestServices>
        > = [];
        const analyticsStarted = Promise.withResolvers<void>();
        const stalledAnalytics = Promise.withResolvers<void>();
        const artifactKeys: string[] = [];
        let captureCompleted = false;
        const provideRequest = requestServices({
          scheduled,
          pipeline: {
            send() {
              analyticsStarted.resolve();
              return stalledAnalytics.promise;
            },
          },
          bucket: {
            get: () => Promise.resolve(null),
            async put(key) {
              artifactKeys.push(key);
            },
          },
        });
        const usage = yield* PlaygroundCodeModeUsage;
        const context = yield* provideRequest(usage.createContext);
        yield* provideRequest(
          usage.capture({
            context,
            durationMs: 1,
            operation: "execute",
            requestBody: {},
            responseBody: { ok: true },
            surface: "mcp",
          }),
        );
        const deferred = scheduled[0];
        if (!deferred) throw new Error("Expected scheduled capture");
        const fiber = yield* Effect.forkChild(
          provideRequest(deferred).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                captureCompleted = true;
              }),
            ),
          ),
        );
        try {
          yield* Effect.promise(() => analyticsStarted.promise);
          yield* TestClock.adjust("1 second");
          expect(artifactKeys).toHaveLength(1);
          expect(artifactKeys[0]).toContain(
            "/run_test/attempt_test/event_test/event.json",
          );
          const writes = probe.events.filter(
            (event): event is TelemetryMetricEvent =>
              event.event === "effect.metric" &&
              event.metric === "sketchi_codemode_usage_capture_writes",
          );
          expect(writes).toEqual([
            expect.objectContaining({
              attributes: expect.objectContaining({
                sink: "artifacts",
                outcome: "success",
              }),
            }),
          ]);
          expect(captureCompleted).toBe(false);
        } finally {
          yield* Fiber.interrupt(fiber);
        }
      }).pipe(
        Effect.provide(
          Layer.merge(
            usageTestLayer,
            makeWorkersTelemetryLayer({
              resource: { serviceName: "usage-stalled-test" },
              sink,
            }),
          ),
        ),
      );
    },
  );
  it.each([
    { analyticsFails: true, artifactsFail: true },
    { analyticsFails: true, artifactsFail: false },
    { analyticsFails: false, artifactsFail: true },
    { analyticsFails: false, artifactsFail: false },
  ])(
    "records each sink independently: %j",
    async ({ analyticsFails, artifactsFail }) => {
      const { probe, sink } = makeTelemetryTestSink();
      const scheduled: Array<
        Effect.Effect<void, never, PlaygroundRequestServices>
      > = [];
      const provideRequest = requestServices({
        scheduled,
        pipeline: {
          async send() {
            if (analyticsFails) throw new Error("analytics failed");
          },
        },
        bucket: {
          get: () => Promise.resolve(null),
          async put() {
            if (artifactsFail) throw new Error("artifacts failed");
          },
        },
      });
      await Effect.runPromise(
        Effect.gen(function* () {
          const usage = yield* PlaygroundCodeModeUsage;
          const context = yield* provideRequest(usage.createContext);
          yield* provideRequest(
            usage.capture({
              context,
              durationMs: 1,
              operation: "execute",
              requestBody: {},
              responseBody: { ok: true },
              surface: "mcp",
            }),
          );
          const deferred = scheduled[0];
          if (!deferred) throw new Error("Expected scheduled capture");
          yield* provideRequest(deferred);
        }).pipe(
          Effect.provide(
            Layer.merge(
              usageTestLayer,
              makeWorkersTelemetryLayer({
                resource: { serviceName: "usage-isolation-test" },
                sink,
              }),
            ),
          ),
        ),
      );
      const writes = probe.events.filter(
        (event): event is TelemetryMetricEvent =>
          event.event === "effect.metric" &&
          event.metric === "sketchi_codemode_usage_capture_writes",
      );
      expect(writes).toHaveLength(2);
      expect(writes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            attributes: expect.objectContaining({
              sink: "analytics",
              outcome: analyticsFails ? "failure" : "success",
            }),
          }),
          expect.objectContaining({
            attributes: expect.objectContaining({
              sink: "artifacts",
              outcome: artifactsFail ? "failure" : "success",
            }),
          }),
        ]),
      );
      const logs = probe.events.filter(
        (event): event is TelemetryLogEvent => event.event === "effect.log",
      );
      expect(logs.map((event) => String(event.fields.sink)).sort()).toEqual([
        ...(analyticsFails ? ["analytics"] : []),
        ...(artifactsFail ? ["artifacts"] : []),
      ]);
    },
  );
});
