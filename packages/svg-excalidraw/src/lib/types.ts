import type { ExcalidrawLinearElement } from "@excalidraw/excalidraw/element/types";

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface CanonicalSubpath {
  readonly closed: boolean;
  readonly points: readonly Point[];
}

export type PaintSource =
  | "default"
  | "direct"
  | "gradient"
  | "inherited"
  | "style";

export interface CanonicalPaint {
  readonly color: string;
  readonly opacity: number;
  readonly source: PaintSource;
}

export interface CanonicalShape {
  readonly clipPathId: string | null;
  readonly fill: CanonicalPaint | null;
  readonly fillRule: "evenodd" | "nonzero";
  readonly id: string;
  readonly sourceElement: string;
  readonly stroke: CanonicalPaint | null;
  readonly strokeWidth: number;
  readonly subpaths: readonly CanonicalSubpath[];
}

export interface SvgCapabilityReport {
  readonly disjointMultipath: boolean;
  readonly evenOdd: boolean;
  readonly gradient: boolean;
  readonly multicolor: boolean;
  readonly realClip: boolean;
  readonly strokeOnly: boolean;
  readonly stylePaint: boolean;
}

export interface CanonicalMetrics {
  readonly closedSubpaths: number;
  readonly openSubpaths: number;
  readonly pathElements: number;
  readonly points: number;
  readonly shapes: number;
}

export interface CanonicalSvgDocument {
  readonly capabilities: SvgCapabilityReport;
  readonly metrics: CanonicalMetrics;
  readonly shapes: readonly CanonicalShape[];
  readonly sourceHash: string;
  readonly sourceName: string;
  readonly viewBox: readonly [number, number, number, number];
  readonly warnings: readonly string[];
}

export type FillStrategy = "keyhole" | "triangulation";
export type SpikeFillStyle = "hachure" | "solid";
export type SpikeRoughness = 0 | 1 | 2;

export interface NativeTraceOptions {
  readonly fillStyle: SpikeFillStyle;
  readonly provisionalPointBudget?: ProvisionalPointBudget;
  readonly roughness: SpikeRoughness;
  readonly roundness?: "curved" | "sharp";
  readonly strategy: FillStrategy;
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

export interface FilledRegion {
  readonly holes: readonly (readonly Point[])[];
  readonly outer: readonly Point[];
}
