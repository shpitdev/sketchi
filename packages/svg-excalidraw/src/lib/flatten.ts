import {
  SVGPathData,
  SVGPathDataTransformer,
  type SVGCommand,
} from "svg-pathdata";

import { signedArea } from "./geometry";
import type { SvgAttributes } from "./style";
import { numericTokens, transformPoint } from "./transform";
import type {
  CanonicalSubpath,
  EffectiveAdaptiveFlatteningOptions,
  Matrix,
  Point,
  SvgDiagnostic,
  SvgPrimitiveName,
} from "./types";

interface MutableFlatteningMetrics {
  arcSegments: number;
  cubicSegments: number;
  flattenedSegments: number;
}

export interface FlattenedPrimitive {
  readonly diagnostics: readonly SvgDiagnostic[];
  readonly metrics: {
    readonly arcSegments: number;
    readonly cubicSegments: number;
    readonly flattenedSegments: number;
  };
  readonly subpaths: readonly CanonicalSubpath[];
}

const POINT_EPSILON = 1e-10;

function diagnostic(
  code:
    | "adaptive-flattening-depth-exceeded"
    | "invalid-geometry"
    | "parse-error",
  message: string,
  sourcePath: string,
): SvgDiagnostic {
  return {
    code,
    elementId: null,
    feature: null,
    message,
    severity: "warning",
    sourcePath,
  };
}

function finiteLength(value: string | undefined, fallback: number): number {
  const match = /^\s*([-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?)/.exec(
    value ?? "",
  );
  const parsed = Number(match?.[1]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function midpoint(left: Point, right: Point): Point {
  return { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
}

function squaredDistance(left: Point, right: Point): number {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  return dx * dx + dy * dy;
}

function pointSegmentDistance(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const denominator = dx * dx + dy * dy;
  if (denominator <= POINT_EPSILON) {
    return Math.sqrt(squaredDistance(point, start));
  }
  const projection = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * dx + (point.y - start.y) * dy) / denominator,
    ),
  );
  return Math.sqrt(
    squaredDistance(point, {
      x: start.x + projection * dx,
      y: start.y + projection * dy,
    }),
  );
}

function cubicFlatness(
  start: Point,
  control1: Point,
  control2: Point,
  end: Point,
): number {
  return Math.max(
    pointSegmentDistance(control1, start, end),
    pointSegmentDistance(control2, start, end),
  );
}

function appendPoint(points: Point[], point: Point): void {
  const previous = points.at(-1);
  if (!previous || squaredDistance(previous, point) > POINT_EPSILON) {
    points.push(point);
  }
}

function flattenCubic(
  start: Point,
  control1: Point,
  control2: Point,
  end: Point,
  options: EffectiveAdaptiveFlatteningOptions,
  depth: number,
  points: Point[],
): boolean {
  const flatness = cubicFlatness(start, control1, control2, end);
  if (flatness <= options.tolerance) {
    appendPoint(points, end);
    return false;
  }
  if (depth >= options.maxDepth) {
    appendPoint(points, end);
    return true;
  }

  const startControl = midpoint(start, control1);
  const controls = midpoint(control1, control2);
  const controlEnd = midpoint(control2, end);
  const leftControl = midpoint(startControl, controls);
  const rightControl = midpoint(controls, controlEnd);
  const split = midpoint(leftControl, rightControl);
  const leftExceeded = flattenCubic(
    start,
    startControl,
    leftControl,
    split,
    options,
    depth + 1,
    points,
  );
  const rightExceeded = flattenCubic(
    split,
    rightControl,
    controlEnd,
    end,
    options,
    depth + 1,
    points,
  );
  return leftExceeded || rightExceeded;
}

function normalizedCommands(pathData: string): readonly SVGCommand[] {
  return new SVGPathData(pathData)
    .transform(SVGPathDataTransformer.TO_ABS())
    .transform(SVGPathDataTransformer.NORMALIZE_ST())
    .transform(SVGPathDataTransformer.QT_TO_C())
    .transform(SVGPathDataTransformer.NORMALIZE_HVZ(false, true, true, true))
    .transform(SVGPathDataTransformer.ANNOTATE_ARCS()).commands;
}

function flattenExactEllipseSection(
  center: Point,
  basisU: Point,
  basisV: Point,
  startAngle: number,
  endAngle: number,
  exactEnd: Point,
  matrix: Matrix,
  options: EffectiveAdaptiveFlatteningOptions,
  points: Point[],
): boolean {
  const transformedU = {
    x: matrix[0] * basisU.x + matrix[2] * basisU.y,
    y: matrix[1] * basisU.x + matrix[3] * basisU.y,
  };
  const transformedV = {
    x: matrix[0] * basisV.x + matrix[2] * basisV.y,
    y: matrix[1] * basisV.x + matrix[3] * basisV.y,
  };
  // For p(theta)=c+u*cos(theta)+v*sin(theta), |p''| is bounded by
  // |u|+|v|. Linear interpolation error over an interval h is therefore
  // at most (|u|+|v|)*h^2/8.
  const secondDerivativeBound =
    Math.hypot(transformedU.x, transformedU.y) +
    Math.hypot(transformedV.x, transformedV.y);
  const angleSpan = endAngle - startAngle;
  const requiredSegments = Math.max(
    1,
    Math.ceil(
      Math.abs(angleSpan) *
        Math.sqrt(secondDerivativeBound / (8 * options.tolerance)),
    ),
  );
  const segmentLimit = 2 ** options.maxDepth;
  const segmentCount = Number.isFinite(requiredSegments)
    ? Math.min(requiredSegments, segmentLimit)
    : segmentLimit;
  for (let index = 1; index <= segmentCount; index += 1) {
    if (index === segmentCount) {
      appendPoint(points, transformPoint(exactEnd, matrix));
      continue;
    }
    const angle = startAngle + (angleSpan * index) / segmentCount;
    appendPoint(
      points,
      transformPoint(
        {
          x: center.x + basisU.x * Math.cos(angle) + basisV.x * Math.sin(angle),
          y: center.y + basisU.y * Math.cos(angle) + basisV.y * Math.sin(angle),
        },
        matrix,
      ),
    );
  }
  return requiredSegments > segmentLimit || !Number.isFinite(requiredSegments);
}

function flattenArc(
  command: Extract<SVGCommand, { readonly type: typeof SVGPathData.ARC }>,
  current: Point,
  matrix: Matrix,
  options: EffectiveAdaptiveFlatteningOptions,
  points: Point[],
): boolean {
  const end = { x: command.x, y: command.y };
  if (
    Math.abs(command.rX) <= POINT_EPSILON ||
    Math.abs(command.rY) <= POINT_EPSILON ||
    (current.x === end.x && current.y === end.y)
  ) {
    appendPoint(points, transformPoint(end, matrix));
    return false;
  }
  if (
    command.cX === undefined ||
    command.cY === undefined ||
    command.phi1 === undefined ||
    command.phi2 === undefined
  ) {
    appendPoint(points, transformPoint(end, matrix));
    return true;
  }

  const rotation = (command.xRot * Math.PI) / 180;
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  return flattenExactEllipseSection(
    { x: command.cX, y: command.cY },
    { x: command.rX * cosine, y: command.rX * sine },
    { x: -command.rY * sine, y: command.rY * cosine },
    (command.phi1 * Math.PI) / 180,
    (command.phi2 * Math.PI) / 180,
    end,
    matrix,
    options,
    points,
  );
}

function canonicalSubpath(
  closed: boolean,
  points: readonly Point[],
): CanonicalSubpath | null {
  if (points.length === 0) {
    return null;
  }
  return { closed, points, signedArea: signedArea(points) };
}

function pathSubpaths(
  pathData: string,
  matrix: Matrix,
  options: EffectiveAdaptiveFlatteningOptions,
  sourcePath: string,
  metrics: MutableFlatteningMetrics,
  diagnostics: SvgDiagnostic[],
): readonly CanonicalSubpath[] {
  const subpaths: CanonicalSubpath[] = [];
  let points: Point[] = [];
  let current: Point = { x: 0, y: 0 };
  let start: Point = current;
  let closed = false;
  let depthExceeded = false;

  const finish = () => {
    const subpath = canonicalSubpath(closed, points);
    if (subpath) {
      subpaths.push(subpath);
      metrics.flattenedSegments += Math.max(0, subpath.points.length - 1);
    }
    points = [];
    closed = false;
  };

  for (const command of normalizedCommands(pathData)) {
    if (command.type === SVGPathData.MOVE_TO) {
      finish();
      current = { x: command.x, y: command.y };
      start = current;
      appendPoint(points, transformPoint(current, matrix));
    } else if (command.type === SVGPathData.LINE_TO) {
      current = { x: command.x, y: command.y };
      appendPoint(points, transformPoint(current, matrix));
    } else if (command.type === SVGPathData.CURVE_TO) {
      const end = { x: command.x, y: command.y };
      metrics.cubicSegments += 1;
      depthExceeded =
        flattenCubic(
          transformPoint(current, matrix),
          transformPoint({ x: command.x1, y: command.y1 }, matrix),
          transformPoint({ x: command.x2, y: command.y2 }, matrix),
          transformPoint(end, matrix),
          options,
          0,
          points,
        ) || depthExceeded;
      current = end;
    } else if (command.type === SVGPathData.ARC) {
      metrics.arcSegments += 1;
      depthExceeded =
        flattenArc(command, current, matrix, options, points) || depthExceeded;
      current = { x: command.x, y: command.y };
    } else if (command.type === SVGPathData.CLOSE_PATH) {
      appendPoint(points, transformPoint(start, matrix));
      current = start;
      closed = true;
    }
  }
  finish();
  if (depthExceeded) {
    diagnostics.push(
      diagnostic(
        "adaptive-flattening-depth-exceeded",
        `Adaptive flattening reached maxDepth=${options.maxDepth} before tolerance=${options.tolerance}.`,
        sourcePath,
      ),
    );
  }
  return subpaths;
}

function pointsSubpath(
  value: string | undefined,
  matrix: Matrix,
  closed: boolean,
  metrics: MutableFlatteningMetrics,
): readonly CanonicalSubpath[] {
  const values = numericTokens(value ?? "");
  const points: Point[] = [];
  for (let index = 0; index + 1 < values.length; index += 2) {
    appendPoint(
      points,
      transformPoint(
        { x: values[index] ?? 0, y: values[index + 1] ?? 0 },
        matrix,
      ),
    );
  }
  if (closed && points[0]) {
    appendPoint(points, points[0]);
  }
  const subpath = canonicalSubpath(closed, points);
  if (subpath) {
    metrics.flattenedSegments += Math.max(0, subpath.points.length - 1);
  }
  return subpath ? [subpath] : [];
}

function ellipseSubpath(
  centerX: number,
  centerY: number,
  radiusX: number,
  radiusY: number,
  matrix: Matrix,
  options: EffectiveAdaptiveFlatteningOptions,
  sourcePath: string,
  metrics: MutableFlatteningMetrics,
  diagnostics: SvgDiagnostic[],
): readonly CanonicalSubpath[] {
  if (radiusX <= 0 || radiusY <= 0) {
    diagnostics.push(
      diagnostic(
        "invalid-geometry",
        "Ellipse radii must be positive.",
        sourcePath,
      ),
    );
    return [];
  }
  const first = { x: centerX + radiusX, y: centerY };
  const points: Point[] = [transformPoint(first, matrix)];
  metrics.arcSegments += 1;
  const depthExceeded = flattenExactEllipseSection(
    { x: centerX, y: centerY },
    { x: radiusX, y: 0 },
    { x: 0, y: radiusY },
    0,
    2 * Math.PI,
    first,
    matrix,
    options,
    points,
  );
  if (depthExceeded) {
    diagnostics.push(
      diagnostic(
        "adaptive-flattening-depth-exceeded",
        `Adaptive flattening reached maxDepth=${options.maxDepth} before tolerance=${options.tolerance}.`,
        sourcePath,
      ),
    );
  }
  const subpath = canonicalSubpath(true, points);
  if (subpath) {
    metrics.flattenedSegments += Math.max(0, subpath.points.length - 1);
  }
  return subpath ? [subpath] : [];
}

function rectPath(attributes: SvgAttributes): string | null {
  const x = finiteLength(attributes.x, 0);
  const y = finiteLength(attributes.y, 0);
  const width = finiteLength(attributes.width, 0);
  const height = finiteLength(attributes.height, 0);
  if (width <= 0 || height <= 0) {
    return null;
  }
  const specifiedRadiusX =
    attributes.rx === undefined ? null : finiteLength(attributes.rx, 0);
  const specifiedRadiusY =
    attributes.ry === undefined ? null : finiteLength(attributes.ry, 0);
  const radiusX = Math.min(
    width / 2,
    Math.max(0, specifiedRadiusX ?? specifiedRadiusY ?? 0),
  );
  const radiusY = Math.min(
    height / 2,
    Math.max(0, specifiedRadiusY ?? specifiedRadiusX ?? 0),
  );
  if (radiusX === 0 || radiusY === 0) {
    return `M${x} ${y}H${x + width}V${y + height}H${x}Z`;
  }
  return [
    `M${x + radiusX} ${y}`,
    `H${x + width - radiusX}`,
    `A${radiusX} ${radiusY} 0 0 1 ${x + width} ${y + radiusY}`,
    `V${y + height - radiusY}`,
    `A${radiusX} ${radiusY} 0 0 1 ${x + width - radiusX} ${y + height}`,
    `H${x + radiusX}`,
    `A${radiusX} ${radiusY} 0 0 1 ${x} ${y + height - radiusY}`,
    `V${y + radiusY}`,
    `A${radiusX} ${radiusY} 0 0 1 ${x + radiusX} ${y}`,
    "Z",
  ].join(" ");
}

export function flattenPrimitive(
  name: SvgPrimitiveName,
  attributes: SvgAttributes,
  matrix: Matrix,
  options: EffectiveAdaptiveFlatteningOptions,
  sourcePath: string,
): FlattenedPrimitive {
  const diagnostics: SvgDiagnostic[] = [];
  const metrics: MutableFlatteningMetrics = {
    arcSegments: 0,
    cubicSegments: 0,
    flattenedSegments: 0,
  };
  try {
    let subpaths: readonly CanonicalSubpath[] = [];
    if (name === "path") {
      subpaths = attributes.d
        ? pathSubpaths(
            attributes.d,
            matrix,
            options,
            sourcePath,
            metrics,
            diagnostics,
          )
        : [];
    } else if (name === "polyline" || name === "polygon") {
      subpaths = pointsSubpath(
        attributes.points,
        matrix,
        name === "polygon",
        metrics,
      );
    } else if (name === "line") {
      subpaths = pointsSubpath(
        `${finiteLength(attributes.x1, 0)},${finiteLength(attributes.y1, 0)} ${finiteLength(attributes.x2, 0)},${finiteLength(attributes.y2, 0)}`,
        matrix,
        false,
        metrics,
      );
    } else if (name === "rect") {
      const path = rectPath(attributes);
      if (!path) {
        diagnostics.push(
          diagnostic(
            "invalid-geometry",
            "Rectangle dimensions must be positive.",
            sourcePath,
          ),
        );
      } else {
        subpaths = pathSubpaths(
          path,
          matrix,
          options,
          sourcePath,
          metrics,
          diagnostics,
        );
      }
    } else {
      const radius = finiteLength(attributes.r, 0);
      subpaths = ellipseSubpath(
        finiteLength(attributes.cx, 0),
        finiteLength(attributes.cy, 0),
        name === "circle" ? radius : finiteLength(attributes.rx, 0),
        name === "circle" ? radius : finiteLength(attributes.ry, 0),
        matrix,
        options,
        sourcePath,
        metrics,
        diagnostics,
      );
    }
    return { diagnostics, metrics, subpaths };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown geometry parser error";
    diagnostics.push(
      diagnostic(
        "parse-error",
        `Unable to parse ${name}: ${message}`,
        sourcePath,
      ),
    );
    return { diagnostics, metrics, subpaths: [] };
  }
}
