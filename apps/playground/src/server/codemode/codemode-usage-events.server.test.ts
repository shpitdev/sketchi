import { assert, describe, it } from "@effect/vitest";
import {
  makeTelemetryTestSink,
  makeWorkersTelemetryLayer,
  type TelemetryLogEvent,
  type TelemetryMetricEvent,
} from "@sketchi/observability";
import { Effect, Layer } from "effect";
import { TestClock } from "effect/testing";

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
