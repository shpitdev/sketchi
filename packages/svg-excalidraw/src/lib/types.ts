import type {
  ExcalidrawElement,
  ExcalidrawLinearElement,
} from "@excalidraw/excalidraw/element/types";

export interface Point {
  readonly x: number;
  readonly y: number;
}

export type Matrix = readonly [number, number, number, number, number, number];

export interface CanonicalSubpath {
  /** True only when the source geometry explicitly closes the subpath. */
  readonly closed: boolean;
  /** Absolute points after the complete SVG transform stack is applied. */
  readonly points: readonly Point[];
  readonly signedArea: number;
}

export type PaintSource =
  | "default"
  | "gradient"
  | "inline"
  | "presentation"
  | "stylesheet";

export interface CanonicalPaint {
  readonly color: string;
  /** True when the winning paint declaration came from an ancestor. */
  readonly inherited: boolean;
  readonly opacity: number;
  readonly source: PaintSource;
}

export interface CanonicalShape {
  /** Non-trivial clip paths that prevent a native trace. */
  readonly clipPathIds: readonly string[];
  readonly elementId: string | null;
  readonly fill: CanonicalPaint | null;
  readonly fillRule: "evenodd" | "nonzero";
  /** Stable traversal identity, including resolved use instances. */
  readonly id: string;
  readonly sourceElement: SvgPrimitiveName;
  readonly sourcePath: string;
  readonly stroke: CanonicalPaint | null;
  readonly strokeWidth: number;
  readonly subpaths: readonly CanonicalSubpath[];
}

export type SvgPrimitiveName =
  | "circle"
  | "ellipse"
  | "line"
  | "path"
  | "polygon"
  | "polyline"
  | "rect";

export type SvgFeature =
  | "clipPath"
  | "filter"
  | "gradient"
  | "image"
  | "mask"
  | "pattern"
  | "style"
  | "text"
  | "use";

export type SvgDiagnosticSeverity = "error" | "info" | "warning";

export type SvgDiagnosticCode =
  | "adaptive-flattening-depth-exceeded"
  | "css-selector-unsupported"
  | "css-at-rule-unsupported"
  | "css-nesting-unsupported"
  | "duplicate-id"
  | "gradient-flattened"
  | "invalid-geometry"
  | "invalid-svg"
  | "invalid-transform"
  | "native-unsupported-clip"
  | "native-unsupported-feature"
  | "native-unsupported-topology"
  | "parse-error"
  | "symbol-viewport-unsupported"
  | "trivial-clip-removed"
  | "unsupported-element"
  | "unsupported-presentation-property"
  | "use-cycle"
  | "use-expansion-limit-exceeded"
  | "use-reference-missing";

export interface SvgDiagnostic {
  readonly code: SvgDiagnosticCode;
  readonly elementId: string | null;
  readonly feature: SvgFeature | null;
  readonly message: string;
  readonly severity: SvgDiagnosticSeverity;
  readonly sourcePath: string | null;
}

export interface SvgFeatureCounts {
  readonly clipPath: number;
  readonly filter: number;
  readonly gradient: number;
  readonly image: number;
  readonly mask: number;
  readonly pattern: number;
  readonly style: number;
  readonly text: number;
  readonly use: number;
}

export interface SvgCapabilityReport {
  readonly diagnostics: readonly SvgDiagnostic[];
  readonly features: SvgFeatureCounts;
  readonly nativeTrace: "supported" | "unsupported";
  readonly summary: {
    readonly disjointMultipath: boolean;
    readonly evenOdd: boolean;
    readonly gradient: boolean;
    readonly multicolor: boolean;
    readonly realClip: boolean;
    readonly strokeOnly: boolean;
    readonly stylePaint: boolean;
    readonly trivialClipsRemoved: number;
    readonly usesResolved: number;
  };
}

export interface CanonicalMetrics {
  readonly arcSegments: number;
  readonly closedSubpaths: number;
  readonly cubicSegments: number;
  readonly flattenedSegments: number;
  readonly openSubpaths: number;
  readonly pathElements: number;
  readonly points: number;
  readonly shapes: number;
  readonly usesResolved: number;
}

export interface AdaptiveFlatteningOptions {
  /** Maximum output-space deviation, in canonical SVG units. */
  readonly tolerance?: number;
  readonly maxDepth?: number;
}

export interface EffectiveAdaptiveFlatteningOptions {
  readonly tolerance: number;
  readonly maxDepth: number;
}

export interface CanonicalSvgDocument {
  readonly diagnostics: readonly SvgDiagnostic[];
  readonly features: SvgFeatureCounts;
  readonly flattening: EffectiveAdaptiveFlatteningOptions;
  readonly metrics: CanonicalMetrics;
  readonly shapes: readonly CanonicalShape[];
  readonly sourceHash: string;
  readonly sourceName: string;
  readonly useExpansion: EffectiveUseExpansionOptions;
  readonly viewBox: readonly [number, number, number, number];
}

export interface SvgParseOptions {
  readonly flattening?: AdaptiveFlatteningOptions;
  readonly sourceName?: string;
  readonly useExpansion?: UseExpansionOptions;
}

export interface UseExpansionOptions {
  readonly maxDepth?: number;
  readonly maxExpansions?: number;
  readonly maxShapes?: number;
}

export interface EffectiveUseExpansionOptions {
  readonly maxDepth: number;
  readonly maxExpansions: number;
  readonly maxShapes: number;
}

export type SvgParseResult =
  | {
      readonly diagnostics: readonly SvgDiagnostic[];
      readonly document: CanonicalSvgDocument;
      readonly ok: true;
    }
  | {
      readonly diagnostics: readonly SvgDiagnostic[];
      readonly document: null;
      readonly ok: false;
    };

export type FillStrategy = "keyhole" | "triangulation";
export type NativeFillStyle = "hachure" | "solid";
export type NativeRoughness = 0 | 1 | 2;
export type NativeColorProfile =
  | { readonly kind: "preserve" }
  | { readonly color: string; readonly kind: "monochrome" };

/** Internal construction options retained for renderer-oracle comparisons. */
export interface NativeTraceOptions {
  readonly colorProfile?: NativeColorProfile;
  readonly compoundEvenOdd?: boolean;
  readonly fillCarrierStrokeWidth?: number;
  readonly fillStyle: NativeFillStyle;
  readonly provisionalPointBudget?: ProvisionalPointBudget;
  readonly roughness: NativeRoughness;
  readonly roundness?: "curved" | "sharp";
  readonly strategy: FillStrategy;
}

export interface SvgToExcalidrawOptions {
  readonly colorProfile?: NativeColorProfile;
  readonly fillStyle?: NativeFillStyle;
  readonly provisionalPointBudget?: ProvisionalPointBudget;
  readonly roughness?: NativeRoughness;
}

export interface EffectiveSvgToExcalidrawOptions {
  readonly colorProfile: NativeColorProfile;
  readonly fillStyle: NativeFillStyle;
  readonly provisionalPointBudget: ProvisionalPointBudget;
  readonly roughness: NativeRoughness;
}

export type NativeConversionDiagnosticCode =
  | "native-capability-blocked"
  | "provisional-point-budget-per-element"
  | "provisional-point-budget-per-icon";

export interface NativeConversionDiagnostic {
  readonly code: NativeConversionDiagnosticCode;
  readonly message: string;
  readonly severity: "error" | "warning";
  readonly value?: number;
  readonly limit?: number;
}

export interface ProvisionalPointBudget {
  readonly perElement: number;
  readonly perIcon: number;
}

export interface NativeTraceMetrics {
  readonly elements: number;
  readonly maxPointsPerElement: number;
  readonly points: number;
}

export interface NativeTraceResult {
  readonly diagnostics: readonly string[];
  readonly elements: readonly ExcalidrawLinearElement[];
  readonly metrics: NativeTraceMetrics;
  readonly exceedsProvisionalBudget: boolean;
}

export type SvgToExcalidrawResult =
  | {
      readonly capability: SvgCapabilityReport;
      readonly diagnostics: readonly (
        | SvgDiagnostic
        | NativeConversionDiagnostic
      )[];
      readonly elements: readonly ExcalidrawLinearElement[];
      readonly metrics: NativeTraceMetrics;
      readonly ok: true;
      readonly options: EffectiveSvgToExcalidrawOptions;
      readonly sourceHash: string;
      readonly sourceName: string;
    }
  | {
      readonly capability: SvgCapabilityReport;
      readonly diagnostics: readonly (
        | SvgDiagnostic
        | NativeConversionDiagnostic
      )[];
      readonly elements: readonly [];
      readonly metrics: NativeTraceMetrics;
      readonly ok: false;
      readonly options: EffectiveSvgToExcalidrawOptions;
      readonly reason: "native-unsupported";
      readonly sourceHash: string;
      readonly sourceName: string;
    };

export interface ExcalidrawLibraryItemInput {
  readonly elements: readonly ExcalidrawElement[];
  readonly id: string;
  readonly name?: string;
}

export interface SerializeExcalidrawLibraryOptions {
  /** Stable epoch milliseconds. Defaults to 1 for byte determinism. */
  readonly created?: number;
  readonly source?: string;
  readonly status?: "published" | "unpublished";
}

export interface FilledRegion {
  readonly holes: readonly (readonly Point[])[];
  readonly outer: readonly Point[];
}
