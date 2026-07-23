import type { PatchableScene } from "@sketchi/diagram-agent";
import { Context, Effect, Layer, Schema } from "effect";

export interface PngRenderInput {
  readonly scene?: PatchableScene;
  readonly excalidraw: unknown;
}

export class HeadlessPngRenderError extends Schema.TaggedErrorClass<HeadlessPngRenderError>()(
  "HeadlessPngRenderError",
  {
    cause: Schema.Defect(),
    message: Schema.String,
  },
) {}

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
      HeadlessPngRenderError.make({
        cause,
        message: "Unable to render the stored Excalidraw artifact as PNG.",
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
      HeadlessPngRenderError.make({
        cause,
        message: "Unable to restore the Excalidraw share artifact.",
      }),
  });
}

export const CliPngRendererLive = Layer.succeed(CliPngRenderer, {
  renderPng,
  normalizeExcalidraw,
});
