import { assert, describe, it } from "@effect/vitest";
import { Effect, Fiber, Layer, Metric } from "effect";

import {
  makeTelemetryTestSink,
  makeWorkersTelemetryLayer,
  recordMetric,
  TelemetryCorrelation,
  type TelemetryLogEvent,
  type TelemetryMetricEvent,
  type TelemetrySpanEvent,
  withTelemetryCorrelation,
} from "./effect-telemetry.js";

const requestCounter = Metric.counter("sketchi_test_requests", {
  description: "Test request count",
  incremental: true,
});

function isSpanEvent(event: {
  readonly event: string;
}): event is TelemetrySpanEvent {
  return event.event === "effect.span";
}

function isLogEvent(event: {
  readonly event: string;
}): event is TelemetryLogEvent {
  return event.event === "effect.log";
}

function isMetricEvent(event: {
  readonly event: string;
}): event is TelemetryMetricEvent {
  return event.event === "effect.metric";
}

describe("Workers Effect telemetry", () => {
  it.effect("releases the exporter after a normally completed scope", () => {
    const { probe, sink } = makeTelemetryTestSink();
    const layer = makeWorkersTelemetryLayer({
      resource: { serviceName: "sketchi-lifecycle-test" },
      sink,
    });
    return Effect.gen(function* () {
      yield* Effect.scoped(Layer.build(layer));
      assert.deepStrictEqual(probe.starts, [
        { serviceName: "sketchi-lifecycle-test" },
      ]);
      assert.deepStrictEqual(probe.shutdowns, [
        { serviceName: "sketchi-lifecycle-test" },
      ]);
    });
  });

  it.effect(
    "exports bounded spans, logs, annotations, and metric updates",
    () => {
      const { probe, sink } = makeTelemetryTestSink();
      const layer = makeWorkersTelemetryLayer({
        resource: {
          environment: "test",
          serviceName: "sketchi-test",
          serviceVersion: "1.0.0",
        },
        sink,
      });

      return Effect.gen(function* () {
        yield* withTelemetryCorrelation(
          withTelemetryCorrelation(
            Effect.gen(function* () {
              const correlation = yield* TelemetryCorrelation;
              assert.strictEqual(correlation.runId, "run_test");
              assert.strictEqual(correlation.artifactId, "artifact_test");
              assert.isUndefined(correlation.projectId);
              assert.isUndefined(correlation.requestId);
              yield* Effect.logInfo("full secret prompt must not be exported", {
                model: "x".repeat(129),
                operation: "buildFlowchart",
                prompt: "must never be exported",
              });
              yield* recordMetric(requestCounter, 1, {
                operation: "buildFlowchart",
                outcome: "success",
                surface: "api",
              });
            }).pipe(Effect.withSpan("codeMode.buildFlowchart")),
            {
              artifactId: "artifact_test",
              attemptId: "attempt_test",
              projectId: "project secret with spaces",
              requestId: "x".repeat(129),
            },
          ),
          {
            runId: "run_test",
            traceId: "trace_test",
          },
        );

        const snapshots = yield* Metric.snapshot;
        const requestSnapshot = snapshots.find(
          (snapshot) => snapshot.id === "sketchi_test_requests",
        );
        assert.isDefined(requestSnapshot);

        const spans = probe.events.filter(isSpanEvent);
        const logs = probe.events.filter(isLogEvent);
        const metrics = probe.events.filter(isMetricEvent);
        assert.strictEqual(spans.length, 1);
        assert.strictEqual(logs.length, 1);
        assert.strictEqual(metrics.length, 1);
        assert.strictEqual(spans[0]?.name, "codeMode.buildFlowchart");
        assert.strictEqual(spans[0]?.attributes["sketchi.run_id"], "run_test");
        assert.strictEqual(
          logs[0]?.annotations["sketchi.trace_id"],
          "trace_test",
        );
        assert.strictEqual(logs[0]?.fields["operation"], "buildFlowchart");
        assert.strictEqual(logs[0]?.message, "Effect log event");
        assert.notInclude(
          JSON.stringify(probe.events),
          "full secret prompt must not be exported",
        );
        assert.isFalse("model" in (logs[0]?.fields ?? {}));
        assert.isFalse("prompt" in (logs[0]?.fields ?? {}));
        assert.deepStrictEqual(metrics[0]?.attributes, {
          operation: "buildFlowchart",
          outcome: "success",
          surface: "api",
        });
        assert.strictEqual(metrics[0]?.trace_id, spans[0]?.trace_id);
        assert.strictEqual(metrics[0]?.span_id, spans[0]?.span_id);
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect(
    "shuts the exporter down once when its scope is interrupted",
    () => {
      const { probe, sink } = makeTelemetryTestSink();
      const layer = makeWorkersTelemetryLayer({
        resource: { serviceName: "sketchi-interrupt-test" },
        sink,
      });
      const started = Effect.gen(function* () {
        yield* TelemetryCorrelation;
        return yield* Effect.never;
      }).pipe(Effect.provide(layer));

      return Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(started, {
          startImmediately: true,
        });
        while (probe.starts.length === 0) {
          yield* Effect.yieldNow;
        }
        yield* Fiber.interrupt(fiber);
        assert.strictEqual(probe.starts.length, 1);
        assert.strictEqual(probe.shutdowns.length, 1);
        assert.strictEqual(
          probe.shutdowns[0]?.serviceName,
          "sketchi-interrupt-test",
        );
      });
    },
  );
});
