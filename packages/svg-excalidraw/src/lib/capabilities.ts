import {
  contoursAreNestedOrDisjoint,
  keyholeBridgeIsSafe,
  regionsFromRings,
} from "./geometry";
import type {
  CanonicalSvgDocument,
  SvgCapabilityReport,
  SvgDiagnostic,
} from "./types";

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
  "native-unsupported-topology",
  "parse-error",
  "symbol-viewport-unsupported",
  "unsupported-element",
  "unsupported-presentation-property",
  "use-cycle",
  "use-expansion-limit-exceeded",
  "use-reference-missing",
]);

function compareDiagnostics(left: SvgDiagnostic, right: SvgDiagnostic): number {
  const leftKey = `${left.sourcePath ?? ""}\u0000${left.code}\u0000${left.message}`;
  const rightKey = `${right.sourcePath ?? ""}\u0000${right.code}\u0000${right.message}`;
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

export function inspectSvgCapabilities(
  document: CanonicalSvgDocument,
): SvgCapabilityReport {
  const topologyDiagnostics: SvgDiagnostic[] = document.shapes.flatMap(
    (shape): readonly SvgDiagnostic[] => {
      if (shape.fill === null) {
        return [];
      }
      const rings = shape.subpaths.map((subpath) => subpath.points);
      if (shape.fillRule === "evenodd") {
        return [];
      }
      if (!contoursAreNestedOrDisjoint(rings)) {
        return [
          {
            code: "native-unsupported-topology",
            elementId: shape.elementId,
            feature: null,
            message:
              "Intersecting, touching, or self-intersecting contours cannot be represented safely as native Excalidraw fill geometry.",
            severity: "error",
            sourcePath: shape.sourcePath,
          },
        ];
      }
      const unsafeKeyhole = regionsFromRings(rings, shape.fillRule).some(
        (region) => !keyholeBridgeIsSafe(region),
      );
      return unsafeKeyhole
        ? [
            {
              code: "native-unsupported-topology",
              elementId: shape.elementId,
              feature: null,
              message:
                "The fill contains a hole that cannot be bridged without crossing an unfilled region.",
              severity: "error",
              sourcePath: shape.sourcePath,
            },
          ]
        : [];
    },
  );
  const diagnostics = [...document.diagnostics, ...topologyDiagnostics].sort(
    compareDiagnostics,
  );
  const colors = new Set(
    document.shapes.flatMap((shape) =>
      [shape.fill?.color, shape.stroke?.color].filter(
        (color): color is string => color !== undefined,
      ),
    ),
  );
  return {
    diagnostics,
    features: document.features,
    nativeTrace: diagnostics.some((entry) =>
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
