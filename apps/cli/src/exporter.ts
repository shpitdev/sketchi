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
import { CliPngRenderer, type HeadlessPngRenderError } from "./png-renderer.js";
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

function renderFailed(diagramId: string, error?: HeadlessPngRenderError) {
  const recoveryCommand = `sketchi export ${diagramId} --format png --dest ${diagramId}.png`;
  return CliExportError.make({
    code: error?.code ?? "invalid_render_artifact",
    format: "png",
    diagramId,
    storagePath: `~/.sketchi/diagrams/${diagramId}`,
    recoveryCommand,
    message:
      error?.message ?? "Unable to read the stored PNG source artifacts.",
    hint: `The canonical record is preserved. Retry with: ${recoveryCommand}`,
    details: error
      ? [`stage:${error.stage}`, ...error.details]
      : ["stage:artifact"],
  });
}

function decodeJson(
  diagramId: string,
  bytes: Uint8Array,
): Effect.Effect<unknown, CliExportError> {
  return Effect.try({
    try: () => JSON.parse(new TextDecoder().decode(bytes)),
    catch: () => renderFailed(diagramId),
  });
}

export const DiagramExporterLive = Layer.effect(
  DiagramExporter,
  Effect.gen(function* () {
    const store = yield* DiagramStore;
    const renderer = yield* CliPngRenderer;

    const renderStoredPng = Effect.fn("sketchi.cli.export.renderPng")(
      function* (
        diagramId: string,
        artifacts: {
          readonly scene?: Uint8Array;
          readonly excalidraw: Uint8Array;
        },
      ) {
        const excalidrawJson = yield* decodeJson(
          diagramId,
          artifacts.excalidraw,
        );
        const excalidraw = ExcalidrawFileSchema.safeParse(excalidrawJson);
        if (!excalidraw.success) return yield* renderFailed(diagramId);
        const scene = artifacts.scene
          ? RenderedDiagramSceneSchema.safeParse(
              yield* decodeJson(diagramId, artifacts.scene),
            )
          : undefined;
        if (scene && !scene.success) return yield* renderFailed(diagramId);
        const png = yield* renderer
          .renderPng({
            ...(scene?.success ? { scene: scene.data } : {}),
            excalidraw: excalidraw.data,
          })
          .pipe(Effect.mapError((error) => renderFailed(diagramId, error)));
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
        : yield* renderStoredPng(diagramId, source);
    });

    return { exportArtifact };
  }),
);
