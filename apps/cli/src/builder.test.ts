import {
  CodeModeArtifactStorageMemory,
  makeCodeModeRuntimeEnvironmentLayer,
} from "@sketchi/diagram-agent";
import { assert, layer } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { DiagramBuilder, DiagramBuilderLive } from "./builder.js";
import {
  canonicalDocument,
  flowchartInput,
  mindmapInput,
} from "./__tests__/fixtures.js";

const builderLayer = DiagramBuilderLive.pipe(
  Layer.provide(
    Layer.mergeAll(
      CodeModeArtifactStorageMemory,
      makeCodeModeRuntimeEnvironmentLayer({
        createId: (prefix) => `${prefix}_cli_layer_test`,
      }),
    ),
  ),
);

layer(builderLayer)("Effect-native Code Mode builder layer", (it) => {
  it.effect(
    "builds both canonical document types into stored offline artifacts",
    () =>
      Effect.gen(function* () {
        const builder = yield* DiagramBuilder;
        const flowchart = yield* builder.build(
          canonicalDocument(flowchartInput),
        );
        const mindmap = yield* builder.build(canonicalDocument(mindmapInput));

        assert.strictEqual(flowchart.type, "flowchart");
        assert.isAbove(flowchart.scene.elements.length, 0);
        assert.strictEqual(flowchart.excalidraw.type, "excalidraw");
        assert.strictEqual(mindmap.type, "mindmap");
        assert.isAbove(mindmap.scene.elements.length, 0);
        assert.strictEqual(mindmap.png, undefined);
      }),
  );

  it.effect("maps Code Mode quality failures to typed CLI validation", () =>
    Effect.gen(function* () {
      const builder = yield* DiagramBuilder;
      const invalid = canonicalDocument({
        type: "flowchart",
        spec: {
          id: "broken-decision",
          title: "Broken decision",
          nodes: [
            { id: "start", label: "Start", kind: "start" },
            { id: "decision", label: "Ready?", kind: "decision" },
            { id: "end", label: "Done", kind: "end" },
          ],
          edges: [
            { source: "start", target: "decision" },
            { source: "decision", target: "end", label: "Yes" },
          ],
        },
      });
      const error = yield* Effect.flip(builder.build(invalid));

      assert.strictEqual(error._tag, "CliValidationError");
      if (error._tag === "CliValidationError") {
        assert.isAbove(error.details.length, 0);
      }
    }),
  );
});
