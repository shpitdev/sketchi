import { inspectSvgCapabilities } from "./capabilities";
import { constructNativeTrace, PROVISIONAL_POINT_BUDGET } from "./native";
import type {
  CanonicalSvgDocument,
  EffectiveSvgToExcalidrawOptions,
  NativeConversionDiagnostic,
  NativeTraceMetrics,
  SvgToExcalidrawOptions,
  SvgToExcalidrawResult,
} from "./types";

const EMPTY_METRICS: NativeTraceMetrics = {
  elements: 0,
  maxPointsPerElement: 0,
  points: 0,
};

function effectiveOptions(
  options: SvgToExcalidrawOptions,
): EffectiveSvgToExcalidrawOptions {
  return {
    colorProfile: options.colorProfile ?? { kind: "preserve" },
    fillStyle: options.fillStyle ?? "solid",
    provisionalPointBudget:
      options.provisionalPointBudget ?? PROVISIONAL_POINT_BUDGET,
    roughness: options.roughness ?? 1,
  };
}

function budgetDiagnostics(
  metrics: NativeTraceMetrics,
  options: EffectiveSvgToExcalidrawOptions,
): readonly NativeConversionDiagnostic[] {
  const diagnostics: NativeConversionDiagnostic[] = [];
  if (metrics.maxPointsPerElement > options.provisionalPointBudget.perElement) {
    diagnostics.push({
      code: "provisional-point-budget-per-element",
      limit: options.provisionalPointBudget.perElement,
      message: `Native output uses ${metrics.maxPointsPerElement} points in one element; the provisional diagnostic threshold is ${options.provisionalPointBudget.perElement}.`,
      severity: "warning",
      value: metrics.maxPointsPerElement,
    });
  }
  if (metrics.points > options.provisionalPointBudget.perIcon) {
    diagnostics.push({
      code: "provisional-point-budget-per-icon",
      limit: options.provisionalPointBudget.perIcon,
      message: `Native output uses ${metrics.points} points; the provisional diagnostic threshold is ${options.provisionalPointBudget.perIcon}.`,
      severity: "warning",
      value: metrics.points,
    });
  }
  return diagnostics;
}

/**
 * Converts one canonical SVG document into editable native Excalidraw elements.
 * Unsupported documents fail closed and never return partial geometry.
 */
export function convertSvgToExcalidraw(
  document: CanonicalSvgDocument,
  options: SvgToExcalidrawOptions = {},
): SvgToExcalidrawResult {
  const capability = inspectSvgCapabilities(document);
  const resolvedOptions = effectiveOptions(options);

  if (capability.nativeTrace === "unsupported") {
    return {
      capability,
      diagnostics: [
        ...capability.diagnostics,
        {
          code: "native-capability-blocked",
          message:
            "Native conversion was blocked because the SVG uses semantics that cannot be preserved safely.",
          severity: "error",
        },
      ],
      elements: [],
      metrics: EMPTY_METRICS,
      ok: false,
      options: resolvedOptions,
      reason: "native-unsupported",
      sourceHash: document.sourceHash,
      sourceName: document.sourceName,
    };
  }

  const trace = constructNativeTrace(document, {
    colorProfile: resolvedOptions.colorProfile,
    compoundEvenOdd: true,
    fillCarrierStrokeWidth: 0.5,
    fillStyle: resolvedOptions.fillStyle,
    provisionalPointBudget: resolvedOptions.provisionalPointBudget,
    roughness: resolvedOptions.roughness,
    roundness: "sharp",
    strategy: "keyhole",
  });

  if (
    trace.diagnostics.some((diagnostic) =>
      diagnostic.startsWith("native-unsupported-"),
    )
  ) {
    return {
      capability: { ...capability, nativeTrace: "unsupported" },
      diagnostics: [
        ...capability.diagnostics,
        {
          code: "native-capability-blocked",
          message:
            "Native conversion was blocked because the geometry cannot be represented safely.",
          severity: "error",
        },
      ],
      elements: [],
      metrics: EMPTY_METRICS,
      ok: false,
      options: resolvedOptions,
      reason: "native-unsupported",
      sourceHash: document.sourceHash,
      sourceName: document.sourceName,
    };
  }

  return {
    capability,
    diagnostics: [
      ...capability.diagnostics,
      ...budgetDiagnostics(trace.metrics, resolvedOptions),
    ],
    elements: trace.elements,
    metrics: trace.metrics,
    ok: true,
    options: resolvedOptions,
    sourceHash: document.sourceHash,
    sourceName: document.sourceName,
  };
}
