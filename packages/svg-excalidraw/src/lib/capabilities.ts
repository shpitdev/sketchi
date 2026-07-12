import type { CanonicalSvgDocument, SvgCapabilityReport } from "./types";

const BLOCKING_DIAGNOSTICS = new Set([
  "adaptive-flattening-depth-exceeded",
  "css-at-rule-unsupported",
  "css-nesting-unsupported",
  "css-selector-unsupported",
  "duplicate-id",
  "invalid-geometry",
  "invalid-transform",
  "native-unsupported-clip",
  "native-unsupported-feature",
  "parse-error",
  "symbol-viewport-unsupported",
  "unsupported-element",
  "unsupported-presentation-property",
  "use-cycle",
  "use-expansion-limit-exceeded",
  "use-reference-missing",
]);

export function inspectSvgCapabilities(
  document: CanonicalSvgDocument,
): SvgCapabilityReport {
  const colors = new Set(
    document.shapes.flatMap((shape) =>
      [shape.fill?.color, shape.stroke?.color].filter(
        (color): color is string => color !== undefined,
      ),
    ),
  );
  return {
    diagnostics: document.diagnostics,
    features: document.features,
    nativeTrace: document.diagnostics.some((entry) =>
      BLOCKING_DIAGNOSTICS.has(entry.code),
    )
      ? "unsupported"
      : "supported",
    summary: {
      disjointMultipath: document.shapes.some(
        (shape) => shape.subpaths.length > 1,
      ),
      evenOdd: document.shapes.some((shape) => shape.fillRule === "evenodd"),
      gradient:
        document.features.gradient > 0 ||
        document.shapes.some(
          (shape) =>
            shape.fill?.source === "gradient" ||
            shape.stroke?.source === "gradient",
        ),
      multicolor: colors.size > 1,
      realClip: document.shapes.some((shape) => shape.clipPathIds.length > 0),
      strokeOnly: document.shapes.some(
        (shape) => shape.fill === null && shape.stroke !== null,
      ),
      stylePaint: document.shapes.some(
        (shape) =>
          shape.fill?.source === "stylesheet" ||
          shape.fill?.source === "inline" ||
          shape.stroke?.source === "stylesheet" ||
          shape.stroke?.source === "inline",
      ),
      trivialClipsRemoved: document.diagnostics.filter(
        (entry) => entry.code === "trivial-clip-removed",
      ).length,
      usesResolved: document.metrics.usesResolved,
    },
  };
}
