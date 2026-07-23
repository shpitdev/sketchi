import { assert, describe, it, layer } from "@effect/vitest";
import { convertSceneToExcalidraw } from "@sketchi/diagram-excalidraw";
import {
  renderSequenceDiagram,
  type RenderedDiagramScene as RendererScene,
} from "@sketchi/diagram-renderer";
import {
  makeTelemetryTestSink,
  makeWorkersTelemetryLayer,
  type TelemetryMetricEvent,
  type TelemetrySpanEvent,
} from "@sketchi/observability";
import { Cause, Effect, Exit, Fiber, Layer, Schema } from "effect";
import { FastCheck } from "effect/testing";

import { CodeModeArtifactStorageMemory } from "./code-mode-artifacts";
import {
  BuildFlowchartRequestSchema,
  BuildSequenceDiagramRequestSchema,
  DIAGRAM_PATCH_OPERATION_NAMES,
  MindmapTopicSchema,
  RenderedDiagramSceneSchema,
} from "./code-mode-contract";
import {
  applyDiagramPatch,
  buildFlowchart,
  makeCodeModeRuntimeEnvironmentLayer,
} from "./code-mode-runtime";

const renderingStarted = Promise.withResolvers<void>();
const patchOperationNames = new Set<string>(DIAGRAM_PATCH_OPERATION_NAMES);

const runtimeLayer = Layer.mergeAll(
  CodeModeArtifactStorageMemory,
  makeCodeModeRuntimeEnvironmentLayer({
    createId: (prefix) => `${prefix}-effect-test`,
    renderer: {
      renderPng: () =>
        Effect.sync(() => renderingStarted.resolve()).pipe(
          Effect.andThen(Effect.never),
        ),
    },
  }),
);

describe("Code Mode telemetry", () => {
  it.effect(
    "records bounded stage spans, correlation, and boundary metrics",
    () => {
      const { probe, sink } = makeTelemetryTestSink();
      const telemetryLayer = makeWorkersTelemetryLayer({
        resource: { serviceName: "sketchi-codemode-test" },
        sink,
      });

      return Effect.gen(function* () {
        const result = yield* buildFlowchart({
          requestId: "request-effect-telemetry",
          spec: {
            title: "Simple approval flow",
            nodes: [
              { id: "request", label: "Request arrives", kind: "start" },
              { id: "approve", label: "Approved?", kind: "decision" },
              { id: "done", label: "Done", kind: "end" },
              { id: "revise", label: "Revise", kind: "end" },
            ],
            edges: [
              { source: "request", target: "approve" },
              { source: "approve", target: "done", label: "yes" },
              { source: "approve", target: "revise", label: "no" },
            ],
            layout: { direction: "TB" },
          },
        });
        assert.isTrue(result.ok);

        const spans = probe.events.filter(
          (event): event is TelemetrySpanEvent => event.event === "effect.span",
        );
        const metrics = probe.events.filter(
          (event): event is TelemetryMetricEvent =>
            event.event === "effect.metric",
        );
        assert.deepInclude(
          spans.find(
            (span) => span.name === "codeMode.buildFlowchart.normalize",
          )?.attributes,
          { "sketchi.request_id": "request-effect-telemetry" },
        );
        assert.deepInclude(
          metrics.find(
            (metric) => metric.metric === "sketchi_codemode_requests",
          )?.attributes,
          {
            operation: "buildFlowchart",
            outcome: "success",
            surface: "code_mode",
          },
        );
        assert.isTrue(
          metrics.some(
            (metric) => metric.metric === "sketchi_codemode_artifacts",
          ),
        );
      }).pipe(Effect.provide(Layer.merge(runtimeLayer, telemetryLayer)));
    },
  );
});

layer(runtimeLayer)("Code Mode Effect workflow", (it) => {
  it.effect("preserves golden request encoding and failure output", () =>
    Effect.gen(function* () {
      const decoded = BuildFlowchartRequestSchema.parse({
        spec: {
          nodes: [{ id: "start", kind: "start", label: "Start" }],
          title: "Golden flow",
        },
      });
      const encoded = yield* Schema.encodeEffect(BuildFlowchartRequestSchema)(
        decoded,
      );
      assert.deepStrictEqual(encoded, {
        spec: {
          title: "Golden flow",
          nodes: [{ id: "start", label: "Start", kind: "start" }],
          edges: [],
          layout: { direction: "TB" },
          style: { accentColor: "#000000", backgroundColor: "#ffffff" },
        },
      });

      const failure = BuildFlowchartRequestSchema.safeParse({
        requestId: "",
        spec: { nodes: [], title: "" },
      });
      assert.isFalse(failure.success);
      if (failure.success) {
        return assert.fail("Invalid golden request unexpectedly decoded.");
      }
      assert.deepStrictEqual(failure.error.issues, [
        {
          code: "custom",
          message: "Too small: expected string to have >=1 characters",
          path: ["requestId"],
        },
        {
          code: "custom",
          message: "Too small: expected string to have >=1 characters",
          path: ["spec", "title"],
        },
        {
          code: "custom",
          message: "Too small: expected array to have >=1 items",
          path: ["spec", "nodes"],
        },
      ]);
    }),
  );

  it.effect.prop(
    "round-trips arbitrary recursive mindmap topics",
    { topic: MindmapTopicSchema },
    ({ topic }) =>
      Effect.gen(function* () {
        const encoded = yield* Schema.encodeEffect(MindmapTopicSchema)(topic);
        const decoded =
          yield* Schema.decodeUnknownEffect(MindmapTopicSchema)(encoded);
        assert.deepStrictEqual(decoded, topic);
      }),
  );

  it.effect("validates and defaults the sequence diagram contract", () =>
    Effect.gen(function* () {
      const decoded = BuildSequenceDiagramRequestSchema.parse({
        spec: {
          title: "Checkout",
          participants: [
            { id: "customer", label: "Customer" },
            { id: "store", label: "Store" },
          ],
          messages: [
            {
              source: "customer",
              target: "store",
              label: "Checkout",
              type: "message",
            },
          ],
        },
      });
      const encoded = yield* Schema.encodeEffect(
        BuildSequenceDiagramRequestSchema,
      )(decoded);
      assert.deepStrictEqual(encoded, {
        spec: {
          title: "Checkout",
          participants: [
            { id: "customer", label: "Customer" },
            { id: "store", label: "Store" },
          ],
          messages: [
            {
              source: "customer",
              target: "store",
              label: "Checkout",
              type: "message",
            },
          ],
          style: { accentColor: "#000000", backgroundColor: "#ffffff" },
        },
      });

      const malformed = BuildSequenceDiagramRequestSchema.safeParse({
        spec: {
          title: "Checkout",
          participants: [{ id: "store", label: "Store" }],
          messages: [{ source: "store", target: "store" }],
        },
      });
      assert.isFalse(malformed.success);
      if (malformed.success) {
        return assert.fail("Malformed sequence message unexpectedly decoded.");
      }
      assert.deepInclude(malformed.error.issues[0], {
        path: ["spec", "messages", 0, "label"],
      });
    }),
  );

  it.effect("preserves sequence stroke styles through scene encoding", () =>
    Effect.gen(function* () {
      const rendered = renderSequenceDiagram({
        id: "return-message",
        title: "Return message",
        participants: [
          { id: "client", label: "Client" },
          { id: "api", label: "API" },
        ],
        messages: [
          {
            id: "response",
            source: "api",
            target: "client",
            label: "Response",
            type: "return",
          },
        ],
        style: { accentColor: "#000000", backgroundColor: "#ffffff" },
      });
      const encoded = yield* Schema.encodeEffect(RenderedDiagramSceneSchema)(
        RenderedDiagramSceneSchema.parse(rendered),
      );
      const decoded = yield* Schema.decodeUnknownEffect(
        RenderedDiagramSceneSchema,
      )(encoded);
      const converted = convertSceneToExcalidraw(decoded as RendererScene);

      assert.deepInclude(
        converted.elements.find((element) => element.id === "arrow:response"),
        { strokeStyle: "dashed" },
      );
      assert.deepInclude(
        converted.elements.find(
          (element) => element.id === "node:api:lifeline",
        ),
        { customData: { sketchiRendererRole: "sequence-lifeline" } },
      );
    }),
  );

  it.effect("forwards renderer cancellation and preserves interruption", () =>
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(
        buildFlowchart({
          spec: {
            title: "Simple approval flow",
            nodes: [
              { id: "request", label: "Request arrives", kind: "start" },
              { id: "approve", label: "Approved?", kind: "decision" },
              { id: "done", label: "Done", kind: "end" },
              { id: "revise", label: "Revise", kind: "end" },
            ],
            edges: [
              { source: "request", target: "approve" },
              { source: "approve", target: "done", label: "yes" },
              { source: "approve", target: "revise", label: "no" },
            ],
            layout: { direction: "TB" },
          },
          options: { artifactFormats: ["png"] },
        }),
      );
      yield* Effect.promise(() => renderingStarted.promise);
      yield* Fiber.interrupt(fiber);
      const exit = yield* Fiber.await(fiber);

      if (Exit.isSuccess(exit)) {
        return assert.fail(
          "Interrupted Code Mode build unexpectedly succeeded.",
        );
      }
      assert.isTrue(Cause.hasInterrupts(exit.cause));
    }),
  );

  it.effect.prop(
    "keeps arbitrary unsupported patch operations on the canonical schema issue path",
    {
      operation: FastCheck.string({ minLength: 1, maxLength: 40 }).filter(
        (operation) => !patchOperationNames.has(operation),
      ),
    },
    ({ operation }) =>
      Effect.gen(function* () {
        const result = yield* applyDiagramPatch({
          source: { artifactId: "artifact-source" },
          operations: [{ op: operation }],
        });

        assert.isFalse(result.ok);
        if (result.ok) {
          return assert.fail("Unsupported patch operation was accepted.");
        }
        assert.strictEqual(result.status, "invalid_input");
        assert.deepInclude(result.issues[0], {
          code: "unsupported_patch_operation",
          ref: { kind: "request", path: "operations.[0].op" },
        });
        assert.include(
          result.issues[0]?.hint,
          DIAGRAM_PATCH_OPERATION_NAMES.join(", "),
        );
      }),
  );
});
