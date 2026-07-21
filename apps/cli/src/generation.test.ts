import {
  CodeModeArtifactStorageMemory,
  makeCodeModeRuntimeEnvironmentLayer,
} from "@sketchi/diagram-agent";
import {
  candidateFromText,
  CLOUDFLARE_AI_GATEWAY_PROVIDER_KEY_DIAGNOSTIC,
  CLOUDFLARE_AI_GATEWAY_TOKEN_REJECTED_DIAGNOSTIC,
  DiagramGenerationClient,
  DiagramGenerationHttpError,
} from "@sketchi/diagram-generation";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { DiagramBuilderLive } from "./builder.js";
import type { BuiltDiagram, StoredDiagram } from "./contracts.js";
import { CliStorageError } from "./errors.js";
import { generateDiagram } from "./generation.js";
import { DiagramStore } from "./storage.js";

const flowchart = {
  id: "generated-release-flow",
  title: "Generated release flow",
  type: "flowchart",
  nodes: [
    { id: "start", label: "Change proposed", kind: "start" },
    { id: "review", label: "Review evidence", kind: "process" },
    { id: "end", label: "Release approved", kind: "end" },
  ],
  edges: [
    { id: "start-review", source: "start", target: "review" },
    { id: "review-end", source: "review", target: "end" },
  ],
  layout: { direction: "TB", edgeRouting: "orthogonal" },
  style: { accentColor: "#0f766e", backgroundColor: "#ffffff" },
};

const mindmap = {
  id: "generated-launch-map",
  title: "Generated launch map",
  type: "mindmap",
  nodes: [
    {
      id: "topic-0",
      label: "Launch readiness",
      kind: "root",
      metadata: { depth: 0, siblingIndex: 0 },
    },
    {
      id: "topic-0-0",
      label: "Product review",
      kind: "topic",
      metadata: { depth: 1, siblingIndex: 0 },
    },
    {
      id: "topic-0-1",
      label: "Operations review",
      kind: "topic",
      metadata: { depth: 1, siblingIndex: 1 },
    },
  ],
  edges: [
    {
      id: "branch-0-0",
      source: "topic-0",
      target: "topic-0-0",
      metadata: { depth: 1, siblingIndex: 0 },
    },
    {
      id: "branch-0-1",
      source: "topic-0",
      target: "topic-0-1",
      metadata: { depth: 1, siblingIndex: 1 },
    },
  ],
  layout: { direction: "LR", edgeRouting: "curved" },
  style: { accentColor: "#7c3aed", backgroundColor: "#ffffff" },
};

function clientLayer(text: string) {
  return Layer.succeed(DiagramGenerationClient, {
    provider: "cloudflare-google-ai-studio",
    generate: Effect.fn("diagramGeneration.test.generate")(() =>
      Effect.succeed(
        candidateFromText({
          model: "gemini-test",
          provider: "cloudflare-google-ai-studio",
          text,
        }),
      ),
    ),
  });
}

const builderLayer = DiagramBuilderLive.pipe(
  Layer.provide(
    Layer.mergeAll(
      CodeModeArtifactStorageMemory,
      makeCodeModeRuntimeEnvironmentLayer({
        createId: (prefix) => `${prefix}_generate_test`,
      }),
    ),
  ),
);

function stored(diagram: BuiltDiagram): StoredDiagram {
  return {
    manifest: {
      schemaVersion: 1,
      id: diagram.id,
      type: diagram.type,
      title: diagram.title,
      revision: 1,
      formats: ["scene", "excalidraw"],
    },
    document: diagram.document,
    revisions: [],
  };
}

function successfulStoreLayer(created: BuiltDiagram[]) {
  return Layer.succeed(DiagramStore, {
    create: Effect.fn("sketchi.cli.storage.testCreate")(function* (diagram) {
      created.push(diagram);
      return stored(diagram);
    }),
    edit: () => Effect.die("unused edit"),
    show: () => Effect.die("unused show"),
    list: () => Effect.die("unused list"),
    readArtifact: () => Effect.die("unused readArtifact"),
  });
}

function appLayer(text: string, store: Layer.Layer<DiagramStore>) {
  return Layer.mergeAll(builderLayer, clientLayer(text), store);
}

function failingClientLayer(error: DiagramGenerationHttpError) {
  return Layer.succeed(DiagramGenerationClient, {
    provider: "cloudflare-google-ai-studio",
    generate: Effect.fn("diagramGeneration.test.failure")(() =>
      Effect.fail(error),
    ),
  });
}

function providerFailure(
  status: number,
  diagnostic: string,
): DiagramGenerationHttpError {
  return DiagramGenerationHttpError.make({
    diagnostics: [
      `Cloudflare AI Gateway request failed with HTTP ${String(status)}.`,
      diagnostic,
    ],
    durationMs: 0,
    provider: "cloudflare-google-ai-studio",
    raw: {},
    retryable: false,
    status,
  });
}

describe("prompt-assisted generation workflow", () => {
  const createdFlowcharts: BuiltDiagram[] = [];
  it.layer(
    appLayer(
      JSON.stringify(flowchart),
      successfulStoreLayer(createdFlowcharts),
    ),
  )("flowchart success", (it) => {
    it.effect(
      "validates, builds, and persists through the manual store path",
      () =>
        Effect.gen(function* () {
          const result = yield* generateDiagram({
            model: "gemini-test",
            prompt: "Create a release flow",
            type: "flowchart",
          });

          assert.strictEqual(result.diagram.manifest.id, flowchart.id);
          assert.strictEqual(result.diagram.document.type, "flowchart");
          assert.strictEqual(result.provider, "cloudflare-google-ai-studio");
          assert.strictEqual(createdFlowcharts.length, 1);
          assert.deepStrictEqual(
            createdFlowcharts[0]?.document,
            result.diagram.document,
          );
        }),
    );
  });

  const rejectedTokenCreates: BuiltDiagram[] = [];
  it.layer(
    Layer.mergeAll(
      builderLayer,
      failingClientLayer(
        providerFailure(401, CLOUDFLARE_AI_GATEWAY_TOKEN_REJECTED_DIAGNOSTIC),
      ),
      successfulStoreLayer(rejectedTokenCreates),
    ),
  )("rejected gateway token", (it) => {
    it.effect("maps to an actionable provider failure before persistence", () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(
          generateDiagram({
            model: "gemini-test",
            prompt: "Create a release flow",
            type: "flowchart",
          }),
        );

        assert.strictEqual(error._tag, "CliGenerationError");
        if (error._tag === "CliGenerationError") {
          assert.strictEqual(error.code, "provider_failure");
          assert.strictEqual(
            error.message,
            CLOUDFLARE_AI_GATEWAY_TOKEN_REJECTED_DIAGNOSTIC,
          );
          assert.include(error.hint, "CF_AIG_TOKEN");
          assert.deepStrictEqual(error.details, ["http_status:401"]);
        }
        assert.strictEqual(rejectedTokenCreates.length, 0);
      }),
    );
  });

  const missingProviderKeyCreates: BuiltDiagram[] = [];
  it.layer(
    Layer.mergeAll(
      builderLayer,
      failingClientLayer(
        providerFailure(400, CLOUDFLARE_AI_GATEWAY_PROVIDER_KEY_DIAGNOSTIC),
      ),
      successfulStoreLayer(missingProviderKeyCreates),
    ),
  )("missing stored gateway provider key", (it) => {
    it.effect("maps to an actionable provider failure before persistence", () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(
          generateDiagram({
            model: "gemini-test",
            prompt: "Create a release flow",
            type: "flowchart",
          }),
        );

        assert.strictEqual(error._tag, "CliGenerationError");
        if (error._tag === "CliGenerationError") {
          assert.strictEqual(error.code, "provider_failure");
          assert.strictEqual(
            error.message,
            CLOUDFLARE_AI_GATEWAY_PROVIDER_KEY_DIAGNOSTIC,
          );
          assert.include(error.hint, "BYOK");
          assert.deepStrictEqual(error.details, ["http_status:400"]);
        }
        assert.strictEqual(missingProviderKeyCreates.length, 0);
      }),
    );
  });

  const createdMindmaps: BuiltDiagram[] = [];
  it.layer(
    appLayer(JSON.stringify(mindmap), successfulStoreLayer(createdMindmaps)),
  )("mindmap success", (it) => {
    it.effect(
      "converts validated mindmap IR to the authoritative nested spec",
      () =>
        Effect.gen(function* () {
          const result = yield* generateDiagram({
            model: "gemini-test",
            prompt: "Create a launch mindmap",
            type: "mindmap",
          });

          assert.strictEqual(result.diagram.document.type, "mindmap");
          if (result.diagram.document.type === "mindmap") {
            assert.deepStrictEqual(
              result.diagram.document.spec.root.children?.map(
                (topic) => topic.label,
              ),
              ["Product review", "Operations review"],
            );
          }
          assert.strictEqual(createdMindmaps.length, 1);
        }),
    );
  });

  const malformedCreates: BuiltDiagram[] = [];
  it.layer(appLayer("not json", successfulStoreLayer(malformedCreates)))(
    "malformed output",
    (it) => {
      it.effect(
        "returns a typed malformed-output error before persistence",
        () =>
          Effect.gen(function* () {
            const error = yield* Effect.flip(
              generateDiagram({
                model: "gemini-test",
                prompt: "Create a flow",
                type: "flowchart",
              }),
            );

            assert.strictEqual(error._tag, "CliGenerationError");
            if (error._tag === "CliGenerationError") {
              assert.strictEqual(error.code, "malformed_output");
            }
            assert.strictEqual(malformedCreates.length, 0);
          }),
      );
    },
  );

  const invalidCreates: BuiltDiagram[] = [];
  const invalidJson = JSON.stringify({
    ...flowchart,
    nodes: [{ id: "start", label: "Only start", kind: "start" }],
    edges: [],
  });
  it.layer(appLayer(invalidJson, successfulStoreLayer(invalidCreates)))(
    "invalid semantic document",
    (it) => {
      it.effect(
        "returns a typed schema error before build or persistence",
        () =>
          Effect.gen(function* () {
            const error = yield* Effect.flip(
              generateDiagram({
                model: "gemini-test",
                prompt: "Create a flow",
                type: "flowchart",
              }),
            );

            assert.strictEqual(error._tag, "CliGenerationError");
            if (error._tag === "CliGenerationError") {
              assert.strictEqual(error.code, "invalid_generated_document");
            }
            assert.strictEqual(invalidCreates.length, 0);
          }),
      );
    },
  );

  const invalidBuildCreates: BuiltDiagram[] = [];
  const lowQualityMindmap = JSON.stringify({
    ...mindmap,
    nodes: [
      {
        id: "topic-0",
        label: "Mindmap",
        kind: "root",
        metadata: { depth: 0, siblingIndex: 0 },
      },
      {
        id: "topic-0-0",
        label: "Topic",
        kind: "topic",
        metadata: { depth: 1, siblingIndex: 0 },
      },
    ],
    edges: [
      {
        id: "branch-0-0",
        source: "topic-0",
        target: "topic-0-0",
        metadata: { depth: 1, siblingIndex: 0 },
      },
    ],
  });
  it.layer(
    appLayer(lowQualityMindmap, successfulStoreLayer(invalidBuildCreates)),
  )("invalid Code Mode build", (it) => {
    it.effect("keeps build rejection typed and leaves storage untouched", () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(
          generateDiagram({
            model: "gemini-test",
            prompt: "Create a generic mindmap",
            type: "mindmap",
          }),
        );

        assert.strictEqual(error._tag, "CliValidationError");
        assert.strictEqual(invalidBuildCreates.length, 0);
      }),
    );
  });

  let storageAttempts = 0;
  const failingStore = Layer.succeed(DiagramStore, {
    create: Effect.fn("sketchi.cli.storage.testFailure")(function* () {
      storageAttempts += 1;
      return yield* CliStorageError.make({
        code: "storage_commit_failed",
        message: "Storage test failure.",
        hint: "Retry.",
      });
    }),
    edit: () => Effect.die("unused edit"),
    show: () => Effect.die("unused show"),
    list: () => Effect.die("unused list"),
    readArtifact: () => Effect.die("unused readArtifact"),
  });
  it.layer(appLayer(JSON.stringify(flowchart), failingStore))(
    "storage failure",
    (it) => {
      it.effect("preserves the exact manual store failure", () =>
        Effect.gen(function* () {
          const error = yield* Effect.flip(
            generateDiagram({
              model: "gemini-test",
              prompt: "Create a release flow",
              type: "flowchart",
            }),
          );

          assert.strictEqual(error._tag, "CliStorageError");
          if (error._tag === "CliStorageError") {
            assert.strictEqual(error.code, "storage_commit_failed");
          }
          assert.strictEqual(storageAttempts, 1);
        }),
      );
    },
  );
});
