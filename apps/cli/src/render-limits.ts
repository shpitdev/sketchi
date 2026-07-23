export const MAX_RENDER_ELEMENT_DIMENSION = 8_192;
export const MAX_RENDER_CANVAS_DIMENSION = 8_192;
export const MAX_RENDER_CANVAS_AREA = 4_194_304;
export const MAX_RENDER_OUTPUT_PIXELS = 16_777_216;
export const PNG_EXPORT_SCALE = 2;
export const PNG_EXPORT_PADDING = 20;

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

export function renderLimitFailure(
  elements: ReadonlyArray<unknown>,
  titleHeight = 0,
): string | undefined {
  let minimumX = Number.POSITIVE_INFINITY;
  let minimumY = Number.POSITIVE_INFINITY;
  let maximumX = Number.NEGATIVE_INFINITY;
  let maximumY = Number.NEGATIVE_INFINITY;

  for (const element of elements) {
    if (!isGeometry(element)) return "element geometry is invalid";
    const width = Math.abs(element.width);
    const height = Math.abs(element.height);
    if (
      width > MAX_RENDER_ELEMENT_DIMENSION ||
      height > MAX_RENDER_ELEMENT_DIMENSION
    ) {
      return `element dimension exceeds ${String(MAX_RENDER_ELEMENT_DIMENSION)}`;
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
    return `canvas dimension exceeds ${String(MAX_RENDER_CANVAS_DIMENSION)}`;
  }
  if (canvasWidth * canvasHeight > MAX_RENDER_CANVAS_AREA) {
    return `canvas area exceeds ${String(MAX_RENDER_CANVAS_AREA)}`;
  }

  const outputWidth = (canvasWidth + PNG_EXPORT_PADDING * 2) * PNG_EXPORT_SCALE;
  const outputHeight =
    (canvasHeight + PNG_EXPORT_PADDING * 2 + titleHeight) * PNG_EXPORT_SCALE;
  if (outputWidth * outputHeight > MAX_RENDER_OUTPUT_PIXELS) {
    return `PNG output exceeds ${String(MAX_RENDER_OUTPUT_PIXELS)} pixels`;
  }
  return undefined;
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
