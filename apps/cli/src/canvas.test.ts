import { CanvasSpec, CreateCanvasRequestSchema } from "@sketchi/diagram-agent";
import { afterEach, assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";

import {
  createCanvasDiagram,
  DEFAULT_CANVAS_ENDPOINT,
  parseCanvasSpec,
} from "./canvas.js";
import {
  type BuiltDiagram,
  DiagramRecordManifest,
  type StoredDiagram,
} from "./contracts.js";
import { exitCodeForFailure } from "./errors.js";
import { DiagramStore } from "./storage.js";

const canvasSpec = Schema.decodeUnknownSync(CanvasSpec)({
  kind: "canvas",
  version: 1,
  diagramId: "universal-canvas",
  title: "Universal Canvas",
  width: 640,
  height: 360,
  accentColor: "#2563eb",
  backgroundColor: "#ffffff",
  elements: [
    {
      type: "node",
      id: "card",
      nodeId: "card",
      shape: "rectangle",
      x: 40,
      y: 40,
      width: 240,
      height: 120,
      label: "Universal Canvas",
    },
  ],
  layers: [],
  layouts: [],
  zOrder: ["card"],
});

const excalidraw = {
  type: "excalidraw",
  version: 2,
  source: "https://sketchi.app",
  elements: [],
  appState: {},
  files: {},
};

function stored(diagram: BuiltDiagram): StoredDiagram {
  return {
    manifest: DiagramRecordManifest.make({
      schemaVersion: 1,
      id: diagram.id,
      type: diagram.type,
      title: diagram.title,
      revision: 1,
      authority: "canonical",
      formats: ["scene", "excalidraw"],
    }),
    authority: "canonical",
    documentAuthoritative: true,
    document: diagram.document,
    revisions: [],
  };
}

function capturingStoreLayer(created: BuiltDiagram[]) {
  return Layer.succeed(DiagramStore, {
    create: Effect.fn("sketchi.cli.canvas.testCreate")(function* (diagram) {
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

function acceptedResponse(): Response {
  return Response.json({
    ok: true,
    status: "accepted",
    buildId: "canvas-build-1",
    normalizedSpec: canvasSpec,
    artifact: {
      artifactId: "canvas-artifact-1",
      diagramId: canvasSpec.diagramId,
      formats: [
        { format: "scene", mimeType: "application/json" },
        {
          format: "excalidraw",
          mimeType: "application/json",
          inline: excalidraw,
        },
      ],
    },
    issues: [],
  });
}

const originalFetch = globalThis.fetch;

describe("Universal Canvas public API client", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it.effect(
    "submits CanvasSpec and preserves the validated built diagram",
    () => {
      const created: BuiltDiagram[] = [];
      let decodedRequest:
        | ReturnType<typeof CreateCanvasRequestSchema.parse>
        | undefined;
      globalThis.fetch = (input, init) => {
        const request = new Request(input, init);
        return request.json().then((body) => {
          decodedRequest = CreateCanvasRequestSchema.parse(body);
          return acceptedResponse();
        });
      };

      return Effect.gen(function* () {
        const result = yield* createCanvasDiagram({
          endpoint: DEFAULT_CANVAS_ENDPOINT,
          spec: canvasSpec,
        });

        assert.strictEqual(result.artifactId, "canvas-artifact-1");
        assert.strictEqual(result.diagram.manifest.type, "canvas");
        assert.strictEqual(result.diagram.document.type, "canvas");
        assert.strictEqual(created.length, 1);
        assert.deepStrictEqual(decodedRequest?.options?.artifactFormats, [
          "scene",
          "excalidraw",
        ]);
        assert.deepStrictEqual(decodedRequest?.options?.inlineArtifacts, [
          "excalidraw",
        ]);
      }).pipe(Effect.provide(capturingStoreLayer(created)));
    },
  );

  it.effect("rejects malformed CanvasSpec before any request", () =>
    Effect.gen(function* () {
      let requested = false;
      globalThis.fetch = () => {
        requested = true;
        return Promise.resolve(acceptedResponse());
      };
      const error = yield* Effect.flip(
        parseCanvasSpec('{"kind":"canvas","version":1}'),
      );

      assert.strictEqual(error._tag, "CliValidationError");
      assert.isFalse(requested);
    }),
  );

  it.effect(
    "reports an unsafe CanvasSpec diagramId at the correct path",
    () => {
      const created: BuiltDiagram[] = [];
      let requested = false;
      globalThis.fetch = () => {
        requested = true;
        return Promise.resolve(acceptedResponse());
      };

      return Effect.gen(function* () {
        const error = yield* Effect.flip(
          createCanvasDiagram({
            endpoint: DEFAULT_CANVAS_ENDPOINT,
            spec: { ...canvasSpec, diagramId: "unsafe/id" },
          }),
        );

        assert.strictEqual(error._tag, "CliValidationError");
        if (error._tag === "CliValidationError") {
          assert.deepStrictEqual(error.details, ["spec.diagramId"]);
        }
        assert.isFalse(requested);
        assert.strictEqual(created.length, 0);
      }).pipe(Effect.provide(capturingStoreLayer(created)));
    },
  );

  it.effect("maps a typed server rejection without committing", () => {
    const created: BuiltDiagram[] = [];
    globalThis.fetch = () =>
      Promise.resolve(
        Response.json(
          {
            ok: false,
            status: "invalid_canvas",
            issues: [
              {
                code: "invalid_canvas_geometry",
                severity: "error",
                stage: "canvas",
                ref: { kind: "diagram", path: "elements" },
                message: "Canvas geometry is invalid.",
                hint: "Correct the CanvasSpec geometry.",
              },
            ],
          },
          { status: 422 },
        ),
      );

    return Effect.gen(function* () {
      const error = yield* Effect.flip(
        createCanvasDiagram({
          endpoint: DEFAULT_CANVAS_ENDPOINT,
          spec: canvasSpec,
        }),
      );

      assert.strictEqual(error._tag, "CliCanvasError");
      if (error._tag === "CliCanvasError") {
        assert.strictEqual(error.code, "canvas_rejected");
        assert.include(error.details, "http_status:422");
      }
      assert.strictEqual(created.length, 0);
    }).pipe(Effect.provide(capturingStoreLayer(created)));
  });

  const serverFailures = [
    {
      status: "render_failed",
      issueCode: "render_failed",
      issueStage: "render",
    },
    {
      status: "export_failed",
      issueCode: "export_invalid_scene",
      issueStage: "export",
    },
    {
      status: "storage_failed",
      issueCode: "storage_write_failed",
      issueStage: "storage",
    },
  ] satisfies ReadonlyArray<{
    readonly status: "export_failed" | "render_failed" | "storage_failed";
    readonly issueCode:
      | "export_invalid_scene"
      | "render_failed"
      | "storage_write_failed";
    readonly issueStage: "export" | "render" | "storage";
  }>;

  for (const { issueCode, issueStage, status } of serverFailures) {
    it.effect(
      `maps ${status} to an endpoint failure without committing`,
      () => {
        const created: BuiltDiagram[] = [];
        globalThis.fetch = () =>
          Promise.resolve(
            Response.json(
              {
                ok: false,
                status,
                issues: [
                  {
                    code: issueCode,
                    severity: "error",
                    stage: issueStage,
                    ref: { kind: "diagram" },
                    message: `Server reported ${status}.`,
                    hint: "Retry later.",
                  },
                ],
              },
              { status: 500 },
            ),
          );

        return Effect.gen(function* () {
          const error = yield* Effect.flip(
            createCanvasDiagram({
              endpoint: DEFAULT_CANVAS_ENDPOINT,
              spec: canvasSpec,
            }),
          );

          assert.strictEqual(error._tag, "CliCanvasError");
          if (error._tag === "CliCanvasError") {
            assert.strictEqual(error.code, "endpoint_failure");
            assert.include(error.details, `status:${status}`);
            assert.strictEqual(exitCodeForFailure(error), 10);
          }
          assert.strictEqual(created.length, 0);
        }).pipe(Effect.provide(capturingStoreLayer(created)));
      },
    );
  }

  it.effect(
    "rejects a normalized CanvasSpec with a different diagramId",
    () => {
      const created: BuiltDiagram[] = [];
      globalThis.fetch = () =>
        Promise.resolve(
          Response.json({
            ok: true,
            status: "accepted",
            buildId: "canvas-build-renamed",
            normalizedSpec: { ...canvasSpec, diagramId: "renamed-canvas" },
            artifact: {
              artifactId: "canvas-artifact-renamed",
              diagramId: "renamed-canvas",
              formats: [
                { format: "scene", mimeType: "application/json" },
                {
                  format: "excalidraw",
                  mimeType: "application/json",
                  inline: excalidraw,
                },
              ],
            },
            issues: [],
          }),
        );

      return Effect.gen(function* () {
        const error = yield* Effect.flip(
          createCanvasDiagram({
            endpoint: DEFAULT_CANVAS_ENDPOINT,
            spec: canvasSpec,
          }),
        );

        assert.strictEqual(error._tag, "CliCanvasError");
        if (error._tag === "CliCanvasError") {
          assert.strictEqual(error.code, "malformed_response");
          assert.include(
            error.details,
            "normalizedSpec.diagramId does not match submitted spec.diagramId",
          );
        }
        assert.strictEqual(created.length, 0);
      }).pipe(Effect.provide(capturingStoreLayer(created)));
    },
  );

  it.effect("rejects malformed accepted responses without committing", () => {
    const created: BuiltDiagram[] = [];
    globalThis.fetch = () =>
      Promise.resolve(
        Response.json({ ok: true, status: "accepted" }, { status: 200 }),
      );

    return Effect.gen(function* () {
      const error = yield* Effect.flip(
        createCanvasDiagram({
          endpoint: DEFAULT_CANVAS_ENDPOINT,
          spec: canvasSpec,
        }),
      );

      assert.strictEqual(error._tag, "CliCanvasError");
      if (error._tag === "CliCanvasError") {
        assert.strictEqual(error.code, "malformed_response");
      }
      assert.strictEqual(created.length, 0);
    }).pipe(Effect.provide(capturingStoreLayer(created)));
  });

  it.effect("maps network failure without committing", () => {
    const created: BuiltDiagram[] = [];
    globalThis.fetch = () => Promise.reject(new Error("offline"));

    return Effect.gen(function* () {
      const error = yield* Effect.flip(
        createCanvasDiagram({
          endpoint: DEFAULT_CANVAS_ENDPOINT,
          spec: canvasSpec,
        }),
      );

      assert.strictEqual(error._tag, "CliCanvasError");
      if (error._tag === "CliCanvasError") {
        assert.strictEqual(error.code, "network_failure");
      }
      assert.strictEqual(created.length, 0);
    }).pipe(Effect.provide(capturingStoreLayer(created)));
  });
});
