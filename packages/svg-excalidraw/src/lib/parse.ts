import { XMLParser } from "fast-xml-parser";
import {
  SVGPathData,
  SVGPathDataTransformer,
  type SVGCommand,
} from "svg-pathdata";

import type {
  CanonicalPaint,
  CanonicalShape,
  CanonicalSubpath,
  CanonicalSvgDocument,
  PaintSource,
  Point,
} from "./types";

type Matrix = readonly [number, number, number, number, number, number];
type Attributes = Readonly<Record<string, string>>;

interface PaintContext {
  readonly color: string;
  readonly fill: string;
  readonly fillOpacity: number;
  readonly fillOrigin: PaintSource;
  readonly fillRule: "evenodd" | "nonzero";
  readonly opacity: number;
  readonly stroke: string;
  readonly strokeOpacity: number;
  readonly strokeOrigin: PaintSource;
  readonly strokeWidth: number;
}

interface ParseContext {
  readonly clipPathId: string | null;
  readonly matrix: Matrix;
  readonly paint: PaintContext;
}

interface ParserState {
  readonly classStyles: ReadonlyMap<string, Attributes>;
  readonly gradients: ReadonlyMap<string, string>;
  readonly realClipIds: ReadonlySet<string>;
  readonly shapes: CanonicalShape[];
  readonly warnings: Set<string>;
  shapeIndex: number;
}

const IDENTITY_MATRIX: Matrix = [1, 0, 0, 1, 0, 0];
const DEFAULT_PAINT: PaintContext = {
  color: "#000000",
  fill: "#000000",
  fillOpacity: 1,
  fillOrigin: "default",
  fillRule: "nonzero",
  opacity: 1,
  stroke: "none",
  strokeOpacity: 1,
  strokeOrigin: "default",
  strokeWidth: 1,
};
const PATH_CURVE_SEGMENTS = 8;

function finiteNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampOpacity(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function multiplyMatrices(left: Matrix, right: Matrix): Matrix {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ];
}

function transformPoint(point: Point, matrix: Matrix): Point {
  return {
    x: matrix[0] * point.x + matrix[2] * point.y + matrix[4],
    y: matrix[1] * point.x + matrix[3] * point.y + matrix[5],
  };
}

function transformedStrokeScale(matrix: Matrix): number {
  // A scalar native stroke cannot encode anisotropic SVG strokes. Area scale
  // is exact for uniform scale/rotation and is a deterministic approximation
  // for the throwaway spike IR under non-uniform transforms.
  return Math.sqrt(Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2]));
}

function transformNumbers(value: string): readonly number[] {
  return (
    value.match(/[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g)?.map(Number) ?? []
  );
}

function transformMatrix(value: string | undefined): Matrix {
  if (!value) {
    return IDENTITY_MATRIX;
  }
  let result = IDENTITY_MATRIX;
  for (const match of value.matchAll(/([A-Za-z]+)\s*\(([^)]*)\)/g)) {
    const operation = match[1]?.toLowerCase();
    const values = transformNumbers(match[2] ?? "");
    let next = IDENTITY_MATRIX;
    if (operation === "matrix" && values.length >= 6) {
      next = [
        values[0] ?? 1,
        values[1] ?? 0,
        values[2] ?? 0,
        values[3] ?? 1,
        values[4] ?? 0,
        values[5] ?? 0,
      ];
    } else if (operation === "translate") {
      next = [1, 0, 0, 1, values[0] ?? 0, values[1] ?? 0];
    } else if (operation === "scale") {
      const scaleX = values[0] ?? 1;
      next = [scaleX, 0, 0, values[1] ?? scaleX, 0, 0];
    } else if (operation === "rotate") {
      const radians = ((values[0] ?? 0) * Math.PI) / 180;
      const cosine = Math.cos(radians);
      const sine = Math.sin(radians);
      const rotation: Matrix = [cosine, sine, -sine, cosine, 0, 0];
      const centerX = values[1] ?? 0;
      const centerY = values[2] ?? 0;
      next = multiplyMatrices(
        multiplyMatrices([1, 0, 0, 1, centerX, centerY], rotation),
        [1, 0, 0, 1, -centerX, -centerY],
      );
    }
    result = multiplyMatrices(result, next);
  }
  return result;
}

function declarations(value: string | undefined): Attributes {
  if (!value) {
    return {};
  }
  return Object.fromEntries(
    value
      .split(";")
      .map((entry) => entry.split(":"))
      .flatMap(([property, ...rest]) => {
        const normalizedProperty = property?.trim();
        const normalizedValue = rest.join(":").trim();
        return normalizedProperty && normalizedValue
          ? [[normalizedProperty, normalizedValue]]
          : [];
      }),
  );
}

function parseClassStyles(source: string): ReadonlyMap<string, Attributes> {
  const styles = new Map<string, Attributes>();
  for (const styleBlock of source.matchAll(
    /<style[^>]*>([\s\S]*?)<\/style>/gi,
  )) {
    for (const rule of (styleBlock[1] ?? "").matchAll(
      /\.([\w-]+)\s*\{([^}]+)\}/g,
    )) {
      const className = rule[1];
      if (className) {
        styles.set(className, declarations(rule[2]));
      }
    }
  }
  return styles;
}

function normalizeHexColor(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(normalized)) {
    return normalized;
  }
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(normalized);
  return short
    ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`
    : null;
}

function parseGradients(source: string): ReadonlyMap<string, string> {
  const gradients = new Map<string, string>();
  for (const match of source.matchAll(
    /<(?:linearGradient|radialGradient)\b([^>]*)>([\s\S]*?)<\/(?:linearGradient|radialGradient)>/gi,
  )) {
    const id = /\bid="([^"]+)"/.exec(match[1] ?? "")?.[1];
    const stopColors = [
      ...(match[2] ?? "").matchAll(/\bstop-color="([^"]+)"/gi),
    ]
      .map((stop) => normalizeHexColor(stop[1] ?? ""))
      .filter((color): color is string => color !== null);
    const representative = stopColors[Math.floor(stopColors.length / 2)];
    if (id && representative) {
      gradients.set(id, representative);
    }
  }
  return gradients;
}

function parseRealClipIds(source: string): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const match of source.matchAll(
    /<clipPath\b([^>]*)>([\s\S]*?)<\/clipPath>/gi,
  )) {
    const id = /\bid="([^"]+)"/.exec(match[1] ?? "")?.[1];
    const body = (match[2] ?? "").replace(/\s+/g, " ");
    const trivialHundredSquare = /d="M0(?:[ ,])0h100v100H0z"/i.test(body);
    const trivialHundredSquareOffset = /d="M0(?:[ ,])-?\.001h100v100H0z"/i.test(
      body,
    );
    if (id && !trivialHundredSquare && !trivialHundredSquareOffset) {
      ids.add(id);
    }
  }
  return ids;
}

function extractUrlId(value: string | undefined): string | null {
  return value ? (/^url\(#([^)]+)\)$/.exec(value.trim())?.[1] ?? null) : null;
}

function localDeclarations(
  attributes: Attributes,
  classStyles: ReadonlyMap<string, Attributes>,
): { readonly values: Attributes; readonly styleKeys: ReadonlySet<string> } {
  const classDeclarations = (attributes.class ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .reduce<Attributes>(
      (result, className) => ({ ...result, ...classStyles.get(className) }),
      {},
    );
  const inlineDeclarations = declarations(attributes.style);
  return {
    values: { ...attributes, ...classDeclarations, ...inlineDeclarations },
    styleKeys: new Set([
      ...Object.keys(classDeclarations),
      ...Object.keys(inlineDeclarations),
    ]),
  };
}

function nextPaintContext(
  parent: PaintContext,
  attributes: Attributes,
  classStyles: ReadonlyMap<string, Attributes>,
): PaintContext {
  const local = localDeclarations(attributes, classStyles);
  const values = local.values;
  const originFor = (property: "fill" | "stroke"): PaintSource => {
    if (local.styleKeys.has(property)) {
      return "style";
    }
    return attributes[property] !== undefined
      ? "direct"
      : parent[`${property}Origin`];
  };
  const localOpacity = clampOpacity(finiteNumber(values.opacity, 1));
  return {
    color: values.color ?? parent.color,
    fill: values.fill ?? parent.fill,
    fillOpacity: clampOpacity(
      finiteNumber(values["fill-opacity"], parent.fillOpacity),
    ),
    fillOrigin: originFor("fill"),
    fillRule:
      values["fill-rule"] === "evenodd"
        ? "evenodd"
        : values["fill-rule"] === "nonzero"
          ? "nonzero"
          : parent.fillRule,
    opacity: parent.opacity * localOpacity,
    stroke: values.stroke ?? parent.stroke,
    strokeOpacity: clampOpacity(
      finiteNumber(values["stroke-opacity"], parent.strokeOpacity),
    ),
    strokeOrigin: originFor("stroke"),
    strokeWidth: finiteNumber(values["stroke-width"], parent.strokeWidth),
  };
}

function resolvePaint(
  value: string,
  origin: PaintSource,
  opacity: number,
  color: string,
  gradients: ReadonlyMap<string, string>,
  warnings: Set<string>,
): CanonicalPaint | null {
  if (value.trim().toLowerCase() === "none") {
    return null;
  }
  const gradientId = extractUrlId(value);
  if (gradientId) {
    warnings.add("gradient-flattened-to-representative-color");
    return {
      color: gradients.get(gradientId) ?? "#808080",
      opacity: clampOpacity(opacity),
      source: "gradient",
    };
  }
  const resolved = value.trim() === "currentColor" ? color : value.trim();
  return {
    color: normalizeHexColor(resolved) ?? resolved.toLowerCase(),
    opacity: clampOpacity(opacity),
    source: origin,
  };
}

function cubicPoint(
  start: Point,
  control1: Point,
  control2: Point,
  end: Point,
  t: number,
): Point {
  const inverse = 1 - t;
  return {
    x:
      inverse ** 3 * start.x +
      3 * inverse ** 2 * t * control1.x +
      3 * inverse * t ** 2 * control2.x +
      t ** 3 * end.x,
    y:
      inverse ** 3 * start.y +
      3 * inverse ** 2 * t * control1.y +
      3 * inverse * t ** 2 * control2.y +
      t ** 3 * end.y,
  };
}

function normalizedCommands(pathData: string): readonly SVGCommand[] {
  return new SVGPathData(pathData)
    .transform(SVGPathDataTransformer.TO_ABS())
    .transform(SVGPathDataTransformer.NORMALIZE_ST())
    .transform(SVGPathDataTransformer.QT_TO_C())
    .transform(SVGPathDataTransformer.A_TO_C())
    .transform(SVGPathDataTransformer.NORMALIZE_HVZ(false, true, true, true))
    .commands;
}

function flattenPath(
  pathData: string,
  matrix: Matrix,
): readonly CanonicalSubpath[] {
  const subpaths: CanonicalSubpath[] = [];
  let points: Point[] = [];
  let current: Point = { x: 0, y: 0 };
  let start: Point = current;
  let closed = false;

  const finish = () => {
    if (points.length > 0) {
      subpaths.push({
        closed,
        points: points.map((point) => transformPoint(point, matrix)),
      });
    }
    points = [];
    closed = false;
  };

  for (const command of normalizedCommands(pathData)) {
    if (command.type === SVGPathData.MOVE_TO) {
      finish();
      current = { x: command.x, y: command.y };
      start = current;
      points.push(current);
    } else if (command.type === SVGPathData.LINE_TO) {
      current = { x: command.x, y: command.y };
      points.push(current);
    } else if (command.type === SVGPathData.CURVE_TO) {
      const end = { x: command.x, y: command.y };
      const control1 = { x: command.x1, y: command.y1 };
      const control2 = { x: command.x2, y: command.y2 };
      for (let step = 1; step <= PATH_CURVE_SEGMENTS; step += 1) {
        points.push(
          cubicPoint(
            current,
            control1,
            control2,
            end,
            step / PATH_CURVE_SEGMENTS,
          ),
        );
      }
      current = end;
    } else if (command.type === SVGPathData.CLOSE_PATH) {
      const lastPoint = points.at(-1);
      if (
        lastPoint &&
        (Math.abs(lastPoint.x - start.x) > 1e-7 ||
          Math.abs(lastPoint.y - start.y) > 1e-7)
      ) {
        points.push(start);
      }
      current = start;
      closed = true;
    }
  }
  finish();
  return subpaths;
}

function pointsAttribute(
  value: string | undefined,
  matrix: Matrix,
): readonly Point[] {
  const values = transformNumbers(value ?? "");
  const points: Point[] = [];
  for (let index = 0; index + 1 < values.length; index += 2) {
    points.push(
      transformPoint(
        { x: values[index] ?? 0, y: values[index + 1] ?? 0 },
        matrix,
      ),
    );
  }
  return points;
}

function primitiveSubpaths(
  elementName: string,
  attributes: Attributes,
  matrix: Matrix,
): readonly CanonicalSubpath[] {
  if (elementName === "path") {
    return attributes.d ? flattenPath(attributes.d, matrix) : [];
  }
  if (elementName === "polyline" || elementName === "polygon") {
    const points = [...pointsAttribute(attributes.points, matrix)];
    const closed = elementName === "polygon";
    if (closed && points[0]) {
      points.push(points[0]);
    }
    return points.length > 0 ? [{ closed, points }] : [];
  }
  if (elementName === "line") {
    return [
      {
        closed: false,
        points: [
          transformPoint(
            {
              x: finiteNumber(attributes.x1, 0),
              y: finiteNumber(attributes.y1, 0),
            },
            matrix,
          ),
          transformPoint(
            {
              x: finiteNumber(attributes.x2, 0),
              y: finiteNumber(attributes.y2, 0),
            },
            matrix,
          ),
        ],
      },
    ];
  }
  if (elementName === "rect") {
    const x = finiteNumber(attributes.x, 0);
    const y = finiteNumber(attributes.y, 0);
    const width = finiteNumber(attributes.width, 0);
    const height = finiteNumber(attributes.height, 0);
    const points = [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height },
      { x, y },
    ].map((point) => transformPoint(point, matrix));
    return [{ closed: true, points }];
  }
  if (elementName === "circle" || elementName === "ellipse") {
    const centerX = finiteNumber(attributes.cx, 0);
    const centerY = finiteNumber(attributes.cy, 0);
    const radiusX = finiteNumber(attributes.rx ?? attributes.r, 0);
    const radiusY = finiteNumber(attributes.ry ?? attributes.r, 0);
    const points = Array.from({ length: 65 }, (_, index) => {
      const angle = (index / 64) * Math.PI * 2;
      return transformPoint(
        {
          x: centerX + Math.cos(angle) * radiusX,
          y: centerY + Math.sin(angle) * radiusY,
        },
        matrix,
      );
    });
    return [{ closed: true, points }];
  }
  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringAttributes(value: unknown): Attributes {
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) =>
      typeof entry === "string" ? [[key, entry]] : [],
    ),
  );
}

function walk(
  nodes: readonly unknown[],
  context: ParseContext,
  state: ParserState,
): void {
  for (const node of nodes) {
    if (!isRecord(node)) {
      continue;
    }
    const attributes = stringAttributes(node[":@"]);
    const elementName = Object.keys(node).find(
      (key) => key !== ":@" && key !== "#text" && key !== "?xml",
    );
    if (!elementName) {
      continue;
    }
    const childrenValue = node[elementName];
    const children = Array.isArray(childrenValue) ? childrenValue : [];
    if (
      elementName === "defs" ||
      elementName === "clipPath" ||
      elementName === "linearGradient" ||
      elementName === "radialGradient" ||
      elementName === "style" ||
      elementName === "title"
    ) {
      continue;
    }
    const nextContext: ParseContext = {
      clipPathId: (() => {
        const localClipPathId = extractUrlId(attributes["clip-path"]);
        return localClipPathId && state.realClipIds.has(localClipPathId)
          ? localClipPathId
          : context.clipPathId;
      })(),
      matrix: multiplyMatrices(
        context.matrix,
        transformMatrix(attributes.transform),
      ),
      paint: nextPaintContext(context.paint, attributes, state.classStyles),
    };
    if (elementName === "svg" || elementName === "g") {
      walk(children, nextContext, state);
      continue;
    }
    const supportedPrimitive = [
      "path",
      "polyline",
      "polygon",
      "line",
      "rect",
      "circle",
      "ellipse",
    ].includes(elementName);
    if (!supportedPrimitive) {
      state.warnings.add(`unsupported-element:${elementName}`);
      continue;
    }
    try {
      const subpaths = primitiveSubpaths(
        elementName,
        attributes,
        nextContext.matrix,
      );
      if (subpaths.length === 0) {
        continue;
      }
      const realClipPathId = nextContext.clipPathId;
      if (realClipPathId) {
        state.warnings.add("real-clip-native-unsupported");
      }
      const paint = nextContext.paint;
      const fill = resolvePaint(
        paint.fill,
        paint.fillOrigin,
        paint.opacity * paint.fillOpacity,
        paint.color,
        state.gradients,
        state.warnings,
      );
      const stroke = resolvePaint(
        paint.stroke,
        paint.strokeOrigin,
        paint.opacity * paint.strokeOpacity,
        paint.color,
        state.gradients,
        state.warnings,
      );
      state.shapes.push({
        id: `shape:${state.shapeIndex}`,
        sourceElement: elementName,
        clipPathId: realClipPathId,
        fill,
        fillRule: paint.fillRule,
        stroke,
        strokeWidth:
          paint.strokeWidth * transformedStrokeScale(nextContext.matrix),
        subpaths,
      });
      state.shapeIndex += 1;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "unknown parser error";
      state.warnings.add(`parse-error:${message}`);
    }
  }
}

function sourceHash(source: string): string {
  let hash = 2166136261;
  for (const character of source) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function parseViewBox(
  source: string,
): readonly [number, number, number, number] {
  const value = /<svg\b[^>]*\bviewBox="([^"]+)"/i.exec(source)?.[1];
  const numbers = transformNumbers(value ?? "");
  return [
    numbers[0] ?? 0,
    numbers[1] ?? 0,
    numbers[2] ?? 512,
    numbers[3] ?? 512,
  ];
}

export function parseSvgForFillSpike(
  source: string,
  options: { readonly sourceName?: string } = {},
): CanonicalSvgDocument {
  const warnings = new Set<string>();
  const state: ParserState = {
    classStyles: parseClassStyles(source),
    gradients: parseGradients(source),
    realClipIds: parseRealClipIds(source),
    shapes: [],
    warnings,
    shapeIndex: 0,
  };
  const parser = new XMLParser({
    preserveOrder: true,
    ignoreAttributes: false,
    attributeNamePrefix: "",
    trimValues: false,
    processEntities: false,
  });
  const parsed: unknown = parser.parse(source);
  if (!Array.isArray(parsed)) {
    throw new Error("Expected an SVG XML document.");
  }
  walk(
    parsed,
    { clipPathId: null, matrix: IDENTITY_MATRIX, paint: DEFAULT_PAINT },
    state,
  );

  const subpaths = state.shapes.flatMap((shape) => shape.subpaths);
  const colors = new Set(
    state.shapes.flatMap((shape) =>
      [shape.fill?.color, shape.stroke?.color].filter(
        (color): color is string => color !== undefined,
      ),
    ),
  );
  return {
    sourceName: options.sourceName ?? "inline.svg",
    sourceHash: sourceHash(source),
    viewBox: parseViewBox(source),
    shapes: state.shapes,
    warnings: [...warnings].sort(),
    capabilities: {
      disjointMultipath: state.shapes.some(
        (shape) => shape.subpaths.length > 1,
      ),
      evenOdd: state.shapes.some((shape) => shape.fillRule === "evenodd"),
      gradient: state.shapes.some((shape) => shape.fill?.source === "gradient"),
      multicolor: colors.size > 1,
      realClip: state.shapes.some((shape) => shape.clipPathId !== null),
      strokeOnly: state.shapes.some(
        (shape) => shape.fill === null && shape.stroke !== null,
      ),
      stylePaint: state.shapes.some(
        (shape) =>
          shape.fill?.source === "style" || shape.stroke?.source === "style",
      ),
    },
    metrics: {
      shapes: state.shapes.length,
      pathElements: state.shapes.filter(
        (shape) => shape.sourceElement === "path",
      ).length,
      closedSubpaths: subpaths.filter((subpath) => subpath.closed).length,
      openSubpaths: subpaths.filter((subpath) => !subpath.closed).length,
      points: subpaths.reduce(
        (total, subpath) => total + subpath.points.length,
        0,
      ),
    },
  };
}
