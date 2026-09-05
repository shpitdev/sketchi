import type { PatchableScene } from "@sketchi/diagram-agent";
import { Context, Effect, Layer } from "effect";

import { HeadlessPngRenderError } from "./render-diagnostics.js";

export interface PngRenderInput {
  readonly scene?: PatchableScene;
  readonly excalidraw: unknown;
}

export class CliPngRenderer extends Context.Service<
  CliPngRenderer,
  {
    readonly renderPng: (
      input: PngRenderInput,
    ) => Effect.Effect<Uint8Array, HeadlessPngRenderError>;
    readonly normalizeExcalidraw: (
      input: unknown,
    ) => Effect.Effect<unknown, HeadlessPngRenderError>;
  }
>()("@sketchi/cli/CliPngRenderer") {}

function renderPng(
  input: PngRenderInput,
): Effect.Effect<Uint8Array, HeadlessPngRenderError> {
  return Effect.tryPromise({
    try: async () => {
      const runtime = await import("./png-renderer-runtime.js");
      return runtime.renderPngBytes(input);
    },
    catch: (cause) =>
      cause instanceof HeadlessPngRenderError
        ? cause
        : HeadlessPngRenderError.make({
            cause,
            code: "rasterization_failed",
            stage: "rasterization",
            message: "Unable to rasterize the stored diagram as PNG.",
            details: [],
          }),
  });
}

function normalizeExcalidraw(
  input: unknown,
): Effect.Effect<unknown, HeadlessPngRenderError> {
  return Effect.tryPromise({
    try: async () => {
      const runtime = await import("./png-renderer-runtime.js");
      return runtime.normalizeExcalidrawArtifact(input);
    },
    catch: (cause) =>
      cause instanceof HeadlessPngRenderError
        ? cause
        : HeadlessPngRenderError.make({
            cause,
            code: "invalid_render_artifact",
            stage: "artifact",
            message: "Unable to restore the Excalidraw share artifact.",
            details: [],
          }),
  });
}

export const CliPngRendererLive = Layer.succeed(CliPngRenderer, {
  renderPng,
  normalizeExcalidraw,
});

export { HeadlessPngRenderError } from "./render-diagnostics.js";
