export const MAX_RENDER_ELEMENT_DIMENSION = 8_192;
export const MAX_RENDER_CANVAS_DIMENSION = 8_192;
// The original 4 Mi-square-unit and 16 MP limits rejected valid canonical
// diagrams observed in production. A bounded 50% increase admits those cases
// while preserving hard pre-raster geometry and allocation ceilings.
export const MAX_RENDER_CANVAS_AREA = 6_291_456;
export const MAX_RENDER_OUTPUT_PIXELS = 25_165_824;
export const PNG_EXPORT_SCALE = 2;
export const PNG_EXPORT_MIN_SCALE = 1;
export const PNG_EXPORT_PADDING = 20;

export interface RenderLimitDiagnostic {
  readonly code:
    | "invalid_geometry"
    | "element_dimension"
    | "canvas_dimension"
    | "canvas_area"
    | "output_dimension"
    | "output_pixels";
  readonly message: string;
  readonly observed?: number;
  readonly limit?: number;
}

type ElementGeometry = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

function isGeometry(value: unknown): value is ElementGeometry {
  if (!isUnknownRecord(value)) return false;
  const candidate = value;
  return (
    typeof candidate["x"] === "number" &&
    Number.isFinite(candidate["x"]) &&
    typeof candidate["y"] === "number" &&
    Number.isFinite(candidate["y"]) &&
    typeof candidate["width"] === "number" &&
    Number.isFinite(candidate["width"]) &&
    typeof candidate["height"] === "number" &&
    Number.isFinite(candidate["height"])
  );
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function diagnostic(
  code: RenderLimitDiagnostic["code"],
  message: string,
  observed?: number,
  limit?: number,
): RenderLimitDiagnostic {
  return {
    code,
    message,
    ...(observed === undefined ? {} : { observed }),
    ...(limit === undefined ? {} : { limit }),
  };
}

export function renderLimitDiagnostic(
  elements: ReadonlyArray<unknown>,
  titleHeight = 0,
): RenderLimitDiagnostic | undefined {
  let minimumX = Number.POSITIVE_INFINITY;
  let minimumY = Number.POSITIVE_INFINITY;
  let maximumX = Number.NEGATIVE_INFINITY;
  let maximumY = Number.NEGATIVE_INFINITY;

  for (const element of elements) {
    if (!isGeometry(element)) {
      return diagnostic("invalid_geometry", "element geometry is invalid");
    }
    const width = Math.abs(element.width);
    const height = Math.abs(element.height);
    if (
      width > MAX_RENDER_ELEMENT_DIMENSION ||
      height > MAX_RENDER_ELEMENT_DIMENSION
    ) {
      return diagnostic(
        "element_dimension",
        `element dimension exceeds ${String(MAX_RENDER_ELEMENT_DIMENSION)}`,
        Math.max(width, height),
        MAX_RENDER_ELEMENT_DIMENSION,
      );
    }

    // A rotation-independent radius deliberately overestimates the element's
    // axis-aligned extent, keeping the pre-raster allocation guard fail-closed.
    const radius = Math.hypot(width, height) / 2;
    const centerX = element.x + element.width / 2;
    const centerY = element.y + element.height / 2;
    minimumX = Math.min(minimumX, centerX - radius);
    minimumY = Math.min(minimumY, centerY - radius);
    maximumX = Math.max(maximumX, centerX + radius);
    maximumY = Math.max(maximumY, centerY + radius);
  }

  if (elements.length === 0) return undefined;
  const canvasWidth = maximumX - minimumX;
  const canvasHeight = maximumY - minimumY;
  if (
    canvasWidth > MAX_RENDER_CANVAS_DIMENSION ||
    canvasHeight > MAX_RENDER_CANVAS_DIMENSION
  ) {
    return diagnostic(
      "canvas_dimension",
      `canvas dimension exceeds ${String(MAX_RENDER_CANVAS_DIMENSION)}`,
      Math.max(canvasWidth, canvasHeight),
      MAX_RENDER_CANVAS_DIMENSION,
    );
  }
  const canvasArea = canvasWidth * canvasHeight;
  if (canvasArea > MAX_RENDER_CANVAS_AREA) {
    return diagnostic(
      "canvas_area",
      `canvas area exceeds ${String(MAX_RENDER_CANVAS_AREA)}`,
      canvasArea,
      MAX_RENDER_CANVAS_AREA,
    );
  }

  const outputWidth =
    (canvasWidth + PNG_EXPORT_PADDING * 2) * PNG_EXPORT_MIN_SCALE;
  const outputHeight =
    (canvasHeight + PNG_EXPORT_PADDING * 2 + titleHeight) *
    PNG_EXPORT_MIN_SCALE;
  const outputPixels = outputWidth * outputHeight;
  if (outputPixels > MAX_RENDER_OUTPUT_PIXELS) {
    return diagnostic(
      "output_pixels",
      `PNG output exceeds ${String(MAX_RENDER_OUTPUT_PIXELS)} pixels at minimum scale`,
      outputPixels,
      MAX_RENDER_OUTPUT_PIXELS,
    );
  }
  return undefined;
}

export function renderLimitFailure(
  elements: ReadonlyArray<unknown>,
  titleHeight = 0,
): string | undefined {
  return renderLimitDiagnostic(elements, titleHeight)?.message;
}

export function adaptivePngExportScale(
  width: number,
  height: number,
): number | RenderLimitDiagnostic {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return diagnostic(
      "invalid_geometry",
      "rendered SVG dimensions are invalid",
    );
  }
  const maximumOutputDimension = MAX_RENDER_CANVAS_DIMENSION * PNG_EXPORT_SCALE;
  const maximumScale = Math.min(
    PNG_EXPORT_SCALE,
    maximumOutputDimension / width,
    maximumOutputDimension / height,
    Math.sqrt(MAX_RENDER_OUTPUT_PIXELS / (width * height)),
  );
  if (maximumScale < PNG_EXPORT_MIN_SCALE) {
    const outputPixels = width * height;
    return outputPixels > MAX_RENDER_OUTPUT_PIXELS
      ? diagnostic(
          "output_pixels",
          `PNG output exceeds ${String(MAX_RENDER_OUTPUT_PIXELS)} pixels at minimum scale`,
          outputPixels,
          MAX_RENDER_OUTPUT_PIXELS,
        )
      : diagnostic(
          "output_dimension",
          "rendered SVG dimension exceeds the PNG limit at minimum scale",
          Math.max(width, height),
          maximumOutputDimension,
        );
  }
  // Keep a small deterministic margin beneath the allocation ceiling because
  // rasterizers round fractional output dimensions to whole pixels.
  return Math.max(
    PNG_EXPORT_MIN_SCALE,
    Math.floor(maximumScale * 1_000) / 1_000,
  );
}

export function renderedSvgLimitFailure(
  width: number,
  height: number,
): string | undefined {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return "rendered SVG dimensions are invalid";
  }
  if (
    width > MAX_RENDER_CANVAS_DIMENSION * PNG_EXPORT_SCALE ||
    height > MAX_RENDER_CANVAS_DIMENSION * PNG_EXPORT_SCALE
  ) {
    return "rendered SVG dimension exceeds the PNG limit";
  }
  return width * height > MAX_RENDER_OUTPUT_PIXELS
    ? `PNG output exceeds ${String(MAX_RENDER_OUTPUT_PIXELS)} pixels`
    : undefined;
}
