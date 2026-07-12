import type { ExcalidrawLinearElement } from "@excalidraw/excalidraw/element/types";
import { generateKeyBetween } from "fractional-indexing";

import {
  closePoints,
  contoursAreNestedOrDisjoint,
  keyholeBridge,
  regionsFromRings,
  triangulateRegion,
} from "./geometry";
import type {
  CanonicalShape,
  CanonicalSvgDocument,
  FilledRegion,
  NativeTraceOptions,
  NativeTraceResult,
  Point,
  ProvisionalPointBudget,
  SpikeFillStyle,
  SpikeRoughness,
} from "./types";

export const PROVISIONAL_POINT_BUDGET: ProvisionalPointBudget = {
  perElement: 256,
  perIcon: 4096,
};

type UnbrandedLineElement = Omit<
  ExcalidrawLinearElement,
  "angle" | "index" | "points"
> & {
  readonly angle: number;
  readonly index: string;
  readonly points: readonly (readonly [number, number])[];
};

function stableSeed(input: string): number {
  let hash = 2166136261;
  for (const character of input) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) || 1;
}

function bounds(points: readonly Point[]): {
  readonly height: number;
  readonly minX: number;
  readonly minY: number;
  readonly width: number;
} {
  const xValues = points.map((point) => point.x);
  const yValues = points.map((point) => point.y);
  const minX = Math.min(...xValues);
  const maxX = Math.max(...xValues);
  const minY = Math.min(...yValues);
  const maxY = Math.max(...yValues);
  return {
    minX,
    minY,
    width: Math.max(0.01, maxX - minX),
    height: Math.max(0.01, maxY - minY),
  };
}

function lineElement(input: {
  readonly backgroundColor: string;
  readonly fillStyle: SpikeFillStyle;
  readonly groupId: string;
  readonly id: string;
  readonly index: string;
  readonly opacity: number;
  readonly points: readonly Point[];
  readonly roughness: SpikeRoughness;
  readonly roundness: "curved" | "sharp";
  readonly strokeColor: string;
  readonly strokeWidth: number;
}): ExcalidrawLinearElement {
  const elementBounds = bounds(input.points);
  const seed = stableSeed(input.id);
  const element = {
    id: input.id,
    type: "line",
    x: elementBounds.minX,
    y: elementBounds.minY,
    width: elementBounds.width,
    height: elementBounds.height,
    angle: 0,
    strokeColor: input.strokeColor,
    backgroundColor: input.backgroundColor,
    fillStyle: input.fillStyle,
    strokeWidth: input.strokeWidth,
    strokeStyle: "solid",
    roundness: input.roundness === "curved" ? { type: 2 } : null,
    roughness: input.roughness,
    opacity: Math.round(input.opacity * 100),
    points: input.points.map(
      (point) =>
        [point.x - elementBounds.minX, point.y - elementBounds.minY] as const,
    ),
    lastCommittedPoint: null,
    startBinding: null,
    endBinding: null,
    startArrowhead: null,
    endArrowhead: null,
    seed,
    version: 1,
    versionNonce: seed + 1,
    index: input.index,
    isDeleted: false,
    groupIds: [input.groupId],
    frameId: null,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
  } satisfies UnbrandedLineElement;

  // Excalidraw brands local points, radians, and fractional indices at the type
  // level. The values above are constructed in their canonical runtime forms.
  return element as unknown as ExcalidrawLinearElement;
}

export function filledRegionsForShape(
  shape: CanonicalShape,
): readonly FilledRegion[] {
  return regionsFromRings(
    shape.subpaths.map((subpath) => subpath.points),
    shape.fillRule,
  );
}

function filledPolygons(
  region: FilledRegion,
  strategy: NativeTraceOptions["strategy"],
): readonly (readonly Point[])[] {
  return strategy === "keyhole"
    ? [keyholeBridge(region)]
    : triangulateRegion(region);
}

export function constructNativeTrace(
  document: CanonicalSvgDocument,
  options: NativeTraceOptions,
): NativeTraceResult {
  const pointBudget =
    options.provisionalPointBudget ?? PROVISIONAL_POINT_BUDGET;
  const diagnostics = new Set<string>();
  const elements: ExcalidrawLinearElement[] = [];
  const groupId = `svg:${document.sourceHash}`;
  let previousIndex: string | null = null;

  const appendElement = (input: {
    readonly backgroundColor: string;
    readonly idSuffix: string;
    readonly opacity: number;
    readonly points: readonly Point[];
    readonly strokeColor: string;
    readonly strokeWidth: number;
  }) => {
    if (input.points.length < 2) {
      return;
    }
    const index = generateKeyBetween(previousIndex, null);
    previousIndex = index;
    elements.push(
      lineElement({
        ...input,
        id: `${groupId}:${input.idSuffix}`,
        groupId,
        index,
        fillStyle: options.fillStyle,
        roughness: options.roughness,
        roundness: options.roundness ?? "sharp",
      }),
    );
  };

  for (const shape of document.shapes) {
    if (shape.clipPathId !== null) {
      diagnostics.add(`native-unsupported-real-clip:${shape.clipPathId}`);
      continue;
    }
    const openSubpaths = shape.subpaths.filter((subpath) => !subpath.closed);
    const separatesOpenSourceStroke =
      shape.stroke !== null && openSubpaths.length > 0;

    // SVG fills implicitly close every subpath even when its path data omits Z.
    const supportsFillContours =
      shape.fill === null ||
      shape.fillRule === "evenodd" ||
      contoursAreNestedOrDisjoint(
        shape.subpaths.map((subpath) => subpath.points),
      );
    if (!supportsFillContours) {
      diagnostics.add(
        `native-unsupported-nonzero-intersecting-contours:${shape.id}`,
      );
    }
    if (shape.fill !== null && supportsFillContours) {
      const regions = filledRegionsForShape(shape);
      regions.forEach((region, regionIndex) => {
        const polygons = filledPolygons(region, options.strategy);
        polygons.forEach((points, polygonIndex) => {
          appendElement({
            idSuffix: `${shape.id}:fill:${regionIndex}:${polygonIndex}`,
            points: closePoints(points),
            backgroundColor: shape.fill?.color ?? "transparent",
            strokeColor: separatesOpenSourceStroke
              ? (shape.fill?.color ?? "transparent")
              : (shape.stroke?.color ?? shape.fill?.color ?? "#000000"),
            strokeWidth: separatesOpenSourceStroke
              ? 0.5
              : Math.max(0.5, shape.strokeWidth),
            opacity: shape.fill?.opacity ?? 1,
          });
        });
      });
    }

    if (shape.stroke !== null) {
      const strokeSubpaths =
        shape.fill === null || separatesOpenSourceStroke
          ? shape.subpaths
          : openSubpaths;
      strokeSubpaths.forEach((subpath, subpathIndex) => {
        appendElement({
          idSuffix: `${shape.id}:stroke:${subpathIndex}`,
          points: subpath.closed ? closePoints(subpath.points) : subpath.points,
          backgroundColor: "transparent",
          strokeColor: shape.stroke?.color ?? "#000000",
          strokeWidth: shape.strokeWidth,
          opacity: shape.stroke?.opacity ?? 1,
        });
      });
    }
  }

  const pointCounts = elements.map((element) => element.points.length);
  const totalPoints = pointCounts.reduce((total, count) => total + count, 0);
  const maxPointsPerElement = Math.max(0, ...pointCounts);
  if (maxPointsPerElement > pointBudget.perElement) {
    diagnostics.add(
      `provisional-point-budget-per-element:${maxPointsPerElement}>${pointBudget.perElement}`,
    );
  }
  if (totalPoints > pointBudget.perIcon) {
    diagnostics.add(
      `provisional-point-budget-per-icon:${totalPoints}>${pointBudget.perIcon}`,
    );
  }
  return {
    elements,
    diagnostics: [...diagnostics].sort(),
    exceedsProvisionalBudget:
      maxPointsPerElement > pointBudget.perElement ||
      totalPoints > pointBudget.perIcon,
    metrics: {
      elements: elements.length,
      maxPointsPerElement,
      points: totalPoints,
    },
  };
}

export function deterministicTraceJson(result: NativeTraceResult): string {
  return JSON.stringify(result.elements);
}

export function deterministicTraceChecksum(result: NativeTraceResult): string {
  const json = deterministicTraceJson(result);
  let hash = 2166136261;
  for (const character of json) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
