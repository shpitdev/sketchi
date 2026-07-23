import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { encodeJson } from "./document.js";
import { DiagramExporter, DiagramExporterLive } from "./exporter.js";
import { CliPngRenderer, HeadlessPngRenderError } from "./png-renderer.js";
import { DiagramStore } from "./storage.js";
import { builtDiagram } from "./__tests__/fixtures.js";

const generatedPng = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

function missingPngStoreLayer() {
  const built = builtDiagram();
  return Layer.succeed(DiagramStore, {
    create: () => Effect.die("unused create"),
    edit: () => Effect.die("unused edit"),
    readPatchSource: () => Effect.die("unused readPatchSource"),
    commitPatch: () => Effect.die("unused commitPatch"),
    show: () => Effect.die("unused show"),
    list: () => Effect.die("unused list"),
    replaceWithDetached: () => Effect.die("unused replaceWithDetached"),
    readRevision: () => Effect.die("unused readRevision"),
    restore: () => Effect.die("unused restore"),
    readExportSource: () =>
      Effect.succeed({
        _tag: "RenderPng" as const,
        scene: new TextEncoder().encode(encodeJson(built.scene)),
        excalidraw: new TextEncoder().encode(encodeJson(built.excalidraw)),
      }),
  });
}

function exporterLayer(
  store: Layer.Layer<DiagramStore>,
  renderer: (typeof CliPngRenderer)["Service"],
) {
  return DiagramExporterLive.pipe(
    Layer.provide(
      Layer.mergeAll(store, Layer.succeed(CliPngRenderer, renderer)),
    ),
  );
}

describe("diagram export orchestration", () => {
  it.effect("renders a PNG when the stored fast path is unavailable", () => {
    const store = missingPngStoreLayer();
    return Effect.gen(function* () {
      const exporter = yield* DiagramExporter;
      const png = yield* exporter.exportArtifact("release-flow", "png");
      assert.deepStrictEqual(png, generatedPng);
    }).pipe(
      Effect.provide(
        exporterLayer(store, {
          renderPng: () => Effect.succeed(generatedPng),
          normalizeExcalidraw: () => Effect.die("unused normalize"),
        }),
      ),
    );
  });

  it.effect("returns a stored PNG without invoking the renderer", () => {
    let renderCalls = 0;
    const store = Layer.succeed(DiagramStore, {
      create: () => Effect.die("unused create"),
      edit: () => Effect.die("unused edit"),
      readPatchSource: () => Effect.die("unused readPatchSource"),
      commitPatch: () => Effect.die("unused commitPatch"),
      show: () => Effect.die("unused show"),
      list: () => Effect.die("unused list"),
      replaceWithDetached: () => Effect.die("unused replaceWithDetached"),
      readRevision: () => Effect.die("unused readRevision"),
      restore: () => Effect.die("unused restore"),
      readExportSource: (_diagramId, format) =>
        format === "png"
          ? Effect.succeed({
              _tag: "StoredArtifact" as const,
              bytes: generatedPng,
            })
          : Effect.die(`unexpected ${format} read`),
    });
    return Effect.gen(function* () {
      const exporter = yield* DiagramExporter;
      const png = yield* exporter.exportArtifact("release-flow", "png");
      assert.deepStrictEqual(png, generatedPng);
      assert.strictEqual(renderCalls, 0);
    }).pipe(
      Effect.provide(
        exporterLayer(store, {
          renderPng: () => {
            renderCalls += 1;
            return Effect.succeed(new Uint8Array());
          },
          normalizeExcalidraw: () => Effect.die("unused normalize"),
        }),
      ),
    );
  });

  it.effect("maps renderer resource failures to render_failed", () => {
    const store = missingPngStoreLayer();
    return Effect.gen(function* () {
      const exporter = yield* DiagramExporter;
      const error = yield* Effect.flip(
        exporter.exportArtifact("release-flow", "png"),
      );
      assert.strictEqual(error._tag, "CliExportError");
      if (error._tag === "CliExportError") {
        assert.strictEqual(error.code, "render_failed");
      }
    }).pipe(
      Effect.provide(
        exporterLayer(store, {
          renderPng: () =>
            Effect.fail(
              HeadlessPngRenderError.make({
                cause: new Error("missing embedded font"),
                message: "Unable to render PNG.",
              }),
            ),
          normalizeExcalidraw: () => Effect.die("unused normalize"),
        }),
      ),
    );
  });
});
