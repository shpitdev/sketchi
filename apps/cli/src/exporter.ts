import {
  ExcalidrawFileSchema,
  RenderedDiagramSceneSchema,
} from "@sketchi/diagram-agent";
import { Context, Effect, Layer } from "effect";

import type { DiagramFormat } from "./contracts.js";
import {
  CliExportError,
  CliFilesystemError,
  CliStorageError,
} from "./errors.js";
import { CliPngRenderer } from "./png-renderer.js";
import { DiagramStore } from "./storage.js";

export class DiagramExporter extends Context.Service<
  DiagramExporter,
  {
    readonly exportArtifact: (
      diagramId: string,
      format: DiagramFormat,
    ) => Effect.Effect<
      Uint8Array,
      CliExportError | CliFilesystemError | CliStorageError
    >;
  }
>()("@sketchi/cli/DiagramExporter") {}

function renderFailed() {
  return CliExportError.make({
    code: "render_failed",
    format: "png",
    message: "Unable to render the stored diagram as PNG.",
    hint: "Verify the stored scene and Excalidraw artifacts, then retry.",
  });
}

function decodeJson(bytes: Uint8Array): Effect.Effect<unknown, CliExportError> {
  return Effect.try({
    try: () => JSON.parse(new TextDecoder().decode(bytes)),
    catch: renderFailed,
  });
}

export const DiagramExporterLive = Layer.effect(
  DiagramExporter,
  Effect.gen(function* () {
    const store = yield* DiagramStore;
    const renderer = yield* CliPngRenderer;

    const renderStoredPng = Effect.fn("sketchi.cli.export.renderPng")(
      function* (artifacts: {
        readonly scene: Uint8Array;
        readonly excalidraw: Uint8Array;
      }) {
        const sceneJson = yield* decodeJson(artifacts.scene);
        const excalidrawJson = yield* decodeJson(artifacts.excalidraw);
        const scene = RenderedDiagramSceneSchema.safeParse(sceneJson);
        const excalidraw = ExcalidrawFileSchema.safeParse(excalidrawJson);
        if (!scene.success || !excalidraw.success) return yield* renderFailed();
        const png = yield* renderer
          .renderPng({ scene: scene.data, excalidraw: excalidraw.data })
          .pipe(Effect.mapError(renderFailed));
        return png instanceof Uint8Array ? png : new Uint8Array(png);
      },
    );

    const exportArtifact = Effect.fn("sketchi.cli.export.artifact")(function* (
      diagramId: string,
      format: DiagramFormat,
    ) {
      const source = yield* store.readExportSource(diagramId, format);
      return source._tag === "StoredArtifact"
        ? source.bytes
        : yield* renderStoredPng(source);
    });

    return { exportArtifact };
  }),
);
