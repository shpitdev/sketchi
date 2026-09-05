import { Schema } from "effect";

export const PngRenderFailureCode = Schema.Literals([
  "invalid_render_artifact",
  "render_limit_exceeded",
  "unsupported_render_glyph",
  "rasterization_failed",
]);

export const PngRenderFailureStage = Schema.Literals([
  "artifact",
  "geometry",
  "font",
  "rasterization",
]);

export class HeadlessPngRenderError extends Schema.TaggedErrorClass<HeadlessPngRenderError>()(
  "HeadlessPngRenderError",
  {
    cause: Schema.Defect(),
    code: PngRenderFailureCode,
    stage: PngRenderFailureStage,
    message: Schema.String,
    details: Schema.Array(Schema.String),
  },
) {}
