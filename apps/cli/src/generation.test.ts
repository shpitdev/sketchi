import {
  CodeModeArtifactStorageMemory,
  makeCodeModeRuntimeEnvironmentLayer,
} from "@sketchi/diagram-agent";
import { afterEach, assert, describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { DiagramBuilder, DiagramBuilderLive } from "./builder.js";
import type { BuiltDiagram, StoredDiagram } from "./contracts.js";
import { decodeCanonicalDiagramDocument } from "./document.js";
import { CliStorageError } from "./errors.js";
import {
  DEFAULT_GENERATE_ENDPOINT,
  DEFAULT_GENERATION_MODEL,
  generateDiagram,
} from "./generation.js";
import { DiagramStore } from "./storage.js";
import { flowchartInput, mindmapInput } from "./__tests__/fixtures.js";

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

async function buildSuccessBody(input: unknown): Promise<string> {
  const body = await Effect.runPromise(
    Effect.gen(function* () {
      const document = yield* decodeCanonicalDiagramDocument(input);
      const builder = yield* DiagramBuilder;
      const built = yield* builder.build(document);
      return {
        ok: true,
        status: "generated",
        diagram: {
          document: built.document,
          scene: built.scene,
          excalidraw: built.excalidraw,
        },
        generation: {
          model: DEFAULT_GENERATION_MODEL,
          provider: "cloudflare-google-ai-studio",
        },
      };
    }).pipe(Effect.provide(builderLayer)),
  );
  return JSON.stringify(body);
}

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

function capturingStoreLayer(created: BuiltDiagram[]) {
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

function failingStoreLayer(attempts: { count: number }) {
  return Layer.succeed(DiagramStore, {
    create: Effect.fn("sketchi.cli.storage.testFailure")(function* () {
      attempts.count += 1;
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
}

const originalFetch = globalThis.fetch;

function stubFetch(handler: () => Response | Promise<Response>): void {
  globalThis.fetch = (() => Promise.resolve().then(handler)) as typeof fetch;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function runGenerate(created: BuiltDiagram[], type: "flowchart" | "mindmap") {
  return generateDiagram({
    endpoint: DEFAULT_GENERATE_ENDPOINT,
    model: DEFAULT_GENERATION_MODEL,
    prompt: "Create a diagram",
    type,
  }).pipe(Effect.provide(capturingStoreLayer(created)));
}

describe("prompt-assisted generation over the public generate API", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it.effect("persists a generated flowchart returned by the endpoint", () =>
    Effect.gen(function* () {
      const body = yield* Effect.promise(() =>
        buildSuccessBody(flowchartInput),
      );
      stubFetch(() => new Response(body, { status: 200 }));
      const created: BuiltDiagram[] = [];

      const result = yield* runGenerate(created, "flowchart");

      assert.strictEqual(result.diagram.manifest.id, flowchartInput.spec.id);
      assert.strictEqual(result.diagram.document.type, "flowchart");
      assert.strictEqual(result.provider, "cloudflare-google-ai-studio");
      assert.strictEqual(result.model, DEFAULT_GENERATION_MODEL);
      assert.strictEqual(created.length, 1);
    }),
  );

  it.effect("preserves the nested mindmap document from the endpoint", () =>
    Effect.gen(function* () {
      const body = yield* Effect.promise(() => buildSuccessBody(mindmapInput));
      stubFetch(() => new Response(body, { status: 200 }));
      const created: BuiltDiagram[] = [];

      const result = yield* runGenerate(created, "mindmap");

      assert.strictEqual(result.diagram.document.type, "mindmap");
      if (result.diagram.document.type === "mindmap") {
        assert.deepStrictEqual(
          result.diagram.document.spec.root.children?.map(
            (topic) => topic.label,
          ),
          ["Product", "Operations"],
        );
      }
      assert.strictEqual(created.length, 1);
    }),
  );

  it.effect("maps a network-down failure to a typed provider error", () =>
    Effect.gen(function* () {
      globalThis.fetch = (() =>
        Promise.reject(new Error("NETWORK_DOWN"))) as typeof fetch;
      const created: BuiltDiagram[] = [];

      const error = yield* Effect.flip(runGenerate(created, "flowchart"));

      assert.strictEqual(error._tag, "CliGenerationError");
      if (error._tag === "CliGenerationError") {
        assert.strictEqual(error.code, "provider_failure");
      }
      assert.strictEqual(created.length, 0);
    }),
  );

  it.effect("maps an endpoint rejection to a typed invalid-document error", () =>
    Effect.gen(function* () {
      stubFetch(() =>
        jsonResponse(
          {
            ok: false,
            status: "invalid_generated_document",
            issues: [
              {
                code: "invalid_generated_document",
                message: "The generated diagram failed validation.",
                hint: "Refine the prompt.",
              },
            ],
          },
          422,
        ),
      );
      const created: BuiltDiagram[] = [];

      const error = yield* Effect.flip(runGenerate(created, "flowchart"));

      assert.strictEqual(error._tag, "CliGenerationError");
      if (error._tag === "CliGenerationError") {
        assert.strictEqual(error.code, "invalid_generated_document");
        assert.deepStrictEqual(error.details, ["http_status:422"]);
      }
      assert.strictEqual(created.length, 0);
    }),
  );

  it.effect("maps a provider endpoint error to a typed provider failure", () =>
    Effect.gen(function* () {
      stubFetch(() =>
        jsonResponse(
          { ok: false, status: "provider_failed", issues: [] },
          502,
        ),
      );
      const created: BuiltDiagram[] = [];

      const error = yield* Effect.flip(runGenerate(created, "flowchart"));

      assert.strictEqual(error._tag, "CliGenerationError");
      if (error._tag === "CliGenerationError") {
        assert.strictEqual(error.code, "provider_failure");
      }
      assert.strictEqual(created.length, 0);
    }),
  );

  it.effect("maps an endpoint timeout to a typed timeout failure", () =>
    Effect.gen(function* () {
      stubFetch(() =>
        jsonResponse(
          { ok: false, status: "generation_timeout", issues: [] },
          504,
        ),
      );
      const created: BuiltDiagram[] = [];

      const error = yield* Effect.flip(runGenerate(created, "flowchart"));

      assert.strictEqual(error._tag, "CliGenerationError");
      if (error._tag === "CliGenerationError") {
        assert.strictEqual(error.code, "generation_timeout");
      }
      assert.strictEqual(created.length, 0);
    }),
  );

  it.effect("treats an unreadable success body as malformed output", () =>
    Effect.gen(function* () {
      stubFetch(() => jsonResponse({ ok: true }, 200));
      const created: BuiltDiagram[] = [];

      const error = yield* Effect.flip(runGenerate(created, "flowchart"));

      assert.strictEqual(error._tag, "CliGenerationError");
      if (error._tag === "CliGenerationError") {
        assert.strictEqual(error.code, "malformed_output");
      }
      assert.strictEqual(created.length, 0);
    }),
  );

  it.effect("rejects a returned document that fails schema validation", () =>
    Effect.gen(function* () {
      stubFetch(() =>
        jsonResponse(
          {
            ok: true,
            status: "generated",
            diagram: {
              document: { type: "flowchart", spec: { id: "x" } },
              scene: {},
              excalidraw: {},
            },
            generation: {
              model: DEFAULT_GENERATION_MODEL,
              provider: "cloudflare-google-ai-studio",
            },
          },
          200,
        ),
      );
      const created: BuiltDiagram[] = [];

      const error = yield* Effect.flip(runGenerate(created, "flowchart"));

      assert.strictEqual(error._tag, "CliGenerationError");
      if (error._tag === "CliGenerationError") {
        assert.strictEqual(error.code, "invalid_generated_document");
      }
      assert.strictEqual(created.length, 0);
    }),
  );

  it.effect("propagates the exact local store failure without partial state", () =>
    Effect.gen(function* () {
      const body = yield* Effect.promise(() =>
        buildSuccessBody(flowchartInput),
      );
      stubFetch(() => new Response(body, { status: 200 }));
      const attempts = { count: 0 };

      const error = yield* Effect.flip(
        generateDiagram({
          endpoint: DEFAULT_GENERATE_ENDPOINT,
          model: DEFAULT_GENERATION_MODEL,
          prompt: "Create a release flow",
          type: "flowchart",
        }).pipe(Effect.provide(failingStoreLayer(attempts))),
      );

      assert.strictEqual(error._tag, "CliStorageError");
      if (error._tag === "CliStorageError") {
        assert.strictEqual(error.code, "storage_commit_failed");
      }
      assert.strictEqual(attempts.count, 1);
    }),
  );
});
