import {
  CodeModeArtifactStorageMemory,
  makeCodeModeRuntimeEnvironmentLayer,
} from "@sketchi/diagram-agent";
import { afterEach, assert, describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { DiagramBuilder, DiagramBuilderLive } from "./builder.js";
import type { BuiltDiagram, StoredDiagram } from "./contracts.js";
import { decodeCanonicalDiagramDocument, encodeJson } from "./document.js";
import { CliStorageError } from "./errors.js";
import { DiagramExporter, DiagramExporterLive } from "./exporter.js";
import {
  DEFAULT_GENERATE_ENDPOINT,
  DEFAULT_GENERATION_MODEL,
  generateDiagram,
} from "./generation.js";
import { DiagramStore } from "./storage.js";
import { CliPngRendererLive } from "./png-renderer.js";
import {
  flowchartInput,
  mindmapInput,
  sequenceInput,
} from "./__tests__/fixtures.js";

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
      authority: "canonical",
      formats: ["scene", "excalidraw"],
    },
    authority: "canonical",
    documentAuthoritative: true,
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
    readPatchSource: () => Effect.die("unused readPatchSource"),
    commitPatch: () => Effect.die("unused commitPatch"),
    show: () => Effect.die("unused show"),
    list: () => Effect.die("unused list"),
    replaceWithDetached: () => Effect.die("unused replaceWithDetached"),
    readRevision: () => Effect.die("unused readRevision"),
    restore: () => Effect.die("unused restore"),
    readExportSource: () => Effect.die("unused readExportSource"),
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
    readPatchSource: () => Effect.die("unused readPatchSource"),
    commitPatch: () => Effect.die("unused commitPatch"),
    show: () => Effect.die("unused show"),
    list: () => Effect.die("unused list"),
    replaceWithDetached: () => Effect.die("unused replaceWithDetached"),
    readRevision: () => Effect.die("unused readRevision"),
    restore: () => Effect.die("unused restore"),
    readExportSource: () => Effect.die("unused readExportSource"),
  });
}

function generatedArtifactStoreLayer(created: BuiltDiagram[]) {
  return Layer.succeed(DiagramStore, {
    create: Effect.fn("sketchi.cli.storage.testGeneratedCreate")(
      function* (diagram) {
        created.push(diagram);
        return stored(diagram);
      },
    ),
    edit: () => Effect.die("unused edit"),
    readPatchSource: () => Effect.die("unused readPatchSource"),
    commitPatch: () => Effect.die("unused commitPatch"),
    show: () => Effect.die("unused show"),
    list: () => Effect.die("unused list"),
    replaceWithDetached: () => Effect.die("unused replaceWithDetached"),
    readRevision: () => Effect.die("unused readRevision"),
    restore: () => Effect.die("unused restore"),
    readExportSource: (diagramId, format) => {
      const diagram = created.find((candidate) => candidate.id === diagramId);
      if (!diagram) return Effect.die(`missing generated diagram ${diagramId}`);
      if (format === "png") {
        return Effect.succeed({
          _tag: "RenderPng" as const,
          scene: new TextEncoder().encode(encodeJson(diagram.scene)),
          excalidraw: new TextEncoder().encode(encodeJson(diagram.excalidraw)),
        });
      }
      return Effect.succeed({
        _tag: "StoredArtifact" as const,
        bytes: new TextEncoder().encode(
          encodeJson(format === "scene" ? diagram.scene : diagram.excalidraw),
        ),
      });
    },
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

function runGenerate(
  created: BuiltDiagram[],
  type: "flowchart" | "mindmap" | "sequence",
) {
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

  it.effect("persists a native sequence returned by the endpoint", () =>
    Effect.gen(function* () {
      const body = yield* Effect.promise(() => buildSuccessBody(sequenceInput));
      stubFetch(() => new Response(body, { status: 200 }));
      const created: BuiltDiagram[] = [];

      const result = yield* runGenerate(created, "sequence");

      assert.strictEqual(result.diagram.document.type, "sequence");
      if (result.diagram.document.type === "sequence") {
        assert.deepStrictEqual(
          result.diagram.document.spec.participants.map(
            (participant) => participant.label,
          ),
          ["Browser", "API", "Database"],
        );
      }
      assert.strictEqual(created.length, 1);
    }),
  );

  it.effect(
    "exports every generated canonical response directly to PNG",
    () => {
      const created: BuiltDiagram[] = [];
      const storeLayer = generatedArtifactStoreLayer(created);
      const exporterLayer = DiagramExporterLive.pipe(
        Layer.provide(Layer.mergeAll(storeLayer, CliPngRendererLive)),
      );
      return Effect.gen(function* () {
        for (const [type, input] of [
          ["flowchart", flowchartInput],
          ["mindmap", mindmapInput],
          ["sequence", sequenceInput],
        ] satisfies ReadonlyArray<
          readonly ["flowchart" | "mindmap" | "sequence", unknown]
        >) {
          const body = yield* Effect.promise(() => buildSuccessBody(input));
          stubFetch(() => new Response(body, { status: 200 }));
          const generated = yield* generateDiagram({
            endpoint: DEFAULT_GENERATE_ENDPOINT,
            model: DEFAULT_GENERATION_MODEL,
            prompt: "Create a diagram",
            type,
          });
          const exporter = yield* DiagramExporter;
          const png = yield* exporter.exportArtifact(
            generated.diagram.manifest.id,
            "png",
          );
          assert.deepStrictEqual(
            [...png.slice(0, 8)],
            [137, 80, 78, 71, 13, 10, 26, 10],
          );
        }
      }).pipe(Effect.provide(Layer.mergeAll(storeLayer, exporterLayer)));
    },
    { timeout: 15_000 },
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

  it.effect(
    "maps an endpoint rejection to a typed invalid-document error",
    () =>
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
          assert.deepStrictEqual(error.details, [
            "http_status:422",
            "The generated diagram failed validation.",
            "Refine the prompt.",
          ]);
        }
        assert.strictEqual(created.length, 0);
      }),
  );

  it.effect("surfaces every endpoint issue message and hint", () =>
    Effect.gen(function* () {
      stubFetch(() =>
        jsonResponse(
          {
            ok: false,
            status: "malformed_output",
            issues: [
              {
                message: "End node cannot have outgoing edges.",
                hint: "Change the retry outcome to a process node.",
              },
              {
                message: "Decision branch is missing a label.",
                hint: "Label every decision outcome.",
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
        assert.deepStrictEqual(error.details, [
          "http_status:422",
          "End node cannot have outgoing edges.",
          "Change the retry outcome to a process node.",
          "Decision branch is missing a label.",
          "Label every decision outcome.",
        ]);
      }
    }),
  );

  it.effect("maps a provider endpoint error to a typed provider failure", () =>
    Effect.gen(function* () {
      stubFetch(() =>
        jsonResponse({ ok: false, status: "provider_failed", issues: [] }, 502),
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

  it.effect(
    "propagates the exact local store failure without partial state",
    () =>
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
