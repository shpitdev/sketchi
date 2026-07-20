import { assert, layer } from "@effect/vitest";
import { Cause, Effect, Exit, Fiber, Layer } from "effect";
import { FastCheck } from "effect/testing";

import { CodeModeArtifactStorageMemory } from "./code-mode-artifacts";
import { DIAGRAM_PATCH_OPERATION_NAMES } from "./code-mode-contract";
import {
  applyDiagramPatch,
  buildFlowchart,
  makeCodeModeRuntimeEnvironmentLayer,
} from "./code-mode-runtime";

let renderingSignal: AbortSignal | undefined;
const renderingStarted = Promise.withResolvers<void>();
const patchOperationNames = new Set<string>(DIAGRAM_PATCH_OPERATION_NAMES);

const runtimeLayer = Layer.mergeAll(
  CodeModeArtifactStorageMemory,
  makeCodeModeRuntimeEnvironmentLayer({
    createId: (prefix) => `${prefix}-effect-test`,
    renderer: {
      renderPng: ({ signal }) => {
        renderingSignal = signal;
        renderingStarted.resolve();
        return new Promise<never>(() => undefined);
      },
    },
  }),
);

layer(runtimeLayer)("Code Mode Effect workflow", (it) => {
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
      assert.isTrue(renderingSignal?.aborted);
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
