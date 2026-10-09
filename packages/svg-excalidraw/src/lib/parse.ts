import { fnv1a32 } from "@sketchi/diagram-core";
import { XMLParser, XMLValidator } from "fast-xml-parser";

import { flattenPrimitive } from "./flatten";
import { withoutClosingPoint } from "./geometry";
import { parseLength, type SvgViewport } from "./length";
import {
  computeElementStyle,
  DEFAULT_PAINT_CONTEXT,
  descriptor,
  normalizeHexColor,
  parseCssRules,
  resolvePaint,
  type CssRule,
  type PaintContext,
  type SvgAttributes,
  type SvgElementDescriptor,
} from "./style";
import {
  IDENTITY_MATRIX,
  multiplyMatrices,
  parseNumberList,
  parseTransform,
  transformedStrokeScale,
} from "./transform";
import type {
  CanonicalShape,
  CanonicalSvgDocument,
  EffectiveAdaptiveFlatteningOptions,
  EffectiveUseExpansionOptions,
  Matrix,
  Point,
  SvgDiagnostic,
  SvgFeature,
  SvgFeatureCounts,
  SvgParseOptions,
  SvgParseResult,
  SvgPrimitiveName,
} from "./types";

interface SvgNode {
  readonly attributes: SvgAttributes;
  readonly children: readonly SvgNode[];
  readonly name: string;
  readonly text: string;
}

interface ClipApplication {
  readonly id: string;
  readonly sourcePath: string;
  readonly viewport: SvgViewport;
}

interface ClipDefinition {
  readonly node: SvgNode;
  readonly sourcePath: string;
  readonly usesViewportLengths: boolean;
  readonly trivialByViewport: Map<string, boolean>;
}

interface WalkContext {
  readonly activeClips: readonly ClipApplication[];
  readonly ancestry: readonly SvgElementDescriptor[];
  readonly matrix: Matrix;
  readonly paint: PaintContext;
  readonly viewport: SvgViewport;
}

interface ParserState {
  arcSegments: number;
  cubicSegments: number;
  readonly clipDefinitions: ReadonlyMap<string, ClipDefinition>;
  readonly cssRules: readonly CssRule[];
  readonly diagnostics: SvgDiagnostic[];
  readonly diagnosticKeys: Set<string>;
  readonly flattening: EffectiveAdaptiveFlatteningOptions;
  flattenedSegments: number;
  readonly gradients: ReadonlyMap<string, string>;
  readonly ids: ReadonlyMap<string, SvgNode>;
  readonly shapes: CanonicalShape[];
  resourceLimitExceeded: boolean;
  shapeIndex: number;
  readonly useExpansion: EffectiveUseExpansionOptions;
  useExpansions: number;
  usesResolved: number;
}

const CONTAINERS = new Set(["a", "g", "svg", "switch", "symbol"]);
const NON_RENDERING = new Set([
  "clipPath",
  "defs",
  "desc",
  "filter",
  "linearGradient",
  "mask",
  "metadata",
  "pattern",
  "radialGradient",
  "style",
  "title",
]);

const FEATURE_ELEMENTS: Readonly<Record<string, SvgFeature>> = {
  clipPath: "clipPath",
  filter: "filter",
  image: "image",
  linearGradient: "gradient",
  mask: "mask",
  pattern: "pattern",
  radialGradient: "gradient",
  style: "style",
  text: "text",
  use: "use",
};

const BLOCKING_FEATURES = new Set<SvgFeature>([
  "filter",
  "image",
  "mask",
  "pattern",
  "text",
]);

function isPrimitiveName(name: string): name is SvgPrimitiveName {
  return (
    name === "circle" ||
    name === "ellipse" ||
    name === "line" ||
    name === "path" ||
    name === "polygon" ||
    name === "polyline" ||
    name === "rect"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringAttributes(value: unknown): SvgAttributes {
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) =>
      typeof entry === "string" || typeof entry === "number"
        ? [[key, String(entry)]]
        : [],
    ),
  );
}

function nodesFromPreserveOrder(
  values: readonly unknown[],
): readonly SvgNode[] {
  return values.flatMap((value) => {
    if (!isRecord(value)) {
      return [];
    }
    const name = Object.keys(value).find(
      (key) => key !== ":@" && key !== "#text" && key !== "?xml",
    );
    if (!name) {
      return [];
    }
    const childrenValue = value[name];
    const rawChildren = Array.isArray(childrenValue) ? childrenValue : [];
    const text = rawChildren
      .flatMap((child) =>
        isRecord(child) && typeof child["#text"] === "string"
          ? [child["#text"]]
          : [],
      )
      .join("");
    return [
      {
        attributes: stringAttributes(value[":@"]),
        children: nodesFromPreserveOrder(rawChildren),
        name,
        text,
      },
    ];
  });
}

function diagnostic(input: {
  readonly code: SvgDiagnostic["code"];
  readonly elementId?: string | null;
  readonly feature?: SvgFeature | null;
  readonly message: string;
  readonly severity: SvgDiagnostic["severity"];
  readonly sourcePath?: string | null;
}): SvgDiagnostic {
  return {
    code: input.code,
    elementId: input.elementId ?? null,
    feature: input.feature ?? null,
    message: input.message,
    severity: input.severity,
    sourcePath: input.sourcePath ?? null,
  };
}

function pushDiagnostic(
  state: ParserState,
  value: SvgDiagnostic,
  key?: string,
): void {
  const diagnosticKey = key ?? JSON.stringify(value);
  if (!state.diagnosticKeys.has(diagnosticKey)) {
    state.diagnosticKeys.add(diagnosticKey);
    state.diagnostics.push(value);
  }
}

function exceedExpansionLimit(
  state: ParserState,
  message: string,
  sourcePath: string,
): void {
  state.resourceLimitExceeded = true;
  pushDiagnostic(
    state,
    diagnostic({
      code: "use-expansion-limit-exceeded",
      feature: "use",
      message,
      severity: "warning",
      sourcePath,
    }),
    "use-expansion-limit-exceeded",
  );
}

function effectiveFlattening(
  options: SvgParseOptions["flattening"],
): EffectiveAdaptiveFlatteningOptions {
  const tolerance = options?.tolerance ?? 0.5;
  const maxDepth = options?.maxDepth ?? 18;
  return {
    tolerance: Number.isFinite(tolerance) && tolerance > 0 ? tolerance : 0.5,
    maxDepth:
      Number.isInteger(maxDepth) && maxDepth >= 1 && maxDepth <= 20
        ? maxDepth
        : 18,
  };
}

function effectiveUseExpansion(
  options: SvgParseOptions["useExpansion"],
): EffectiveUseExpansionOptions {
  const boundedInteger = (value: number | undefined, fallback: number) =>
    Number.isInteger(value) && (value ?? 0) > 0
      ? (value ?? fallback)
      : fallback;
  return {
    maxDepth: Math.min(256, boundedInteger(options?.maxDepth, 64)),
    maxExpansions: Math.min(
      100_000,
      boundedInteger(options?.maxExpansions, 10_000),
    ),
    maxShapes: Math.min(100_000, boundedInteger(options?.maxShapes, 20_000)),
  };
}

function collectStyles(
  node: SvgNode,
  sourcePath: string,
): readonly { readonly css: string; readonly sourcePath: string }[] {
  const own = node.name === "style" ? [{ css: node.text, sourcePath }] : [];
  return [
    ...own,
    ...node.children.flatMap((child, index) =>
      collectStyles(child, `${sourcePath}/${child.name}[${index}]`),
    ),
  ];
}

function collectIds(
  node: SvgNode,
  sourcePath: string,
  ids: Map<string, SvgNode>,
  diagnostics: SvgDiagnostic[],
): void {
  const id = node.attributes.id;
  if (id) {
    if (ids.has(id)) {
      diagnostics.push(
        diagnostic({
          code: "duplicate-id",
          elementId: id,
          message: `Duplicate SVG id: ${id}`,
          severity: "warning",
          sourcePath,
        }),
      );
    } else {
      ids.set(id, node);
    }
  }
  node.children.forEach((child, index) =>
    collectIds(
      child,
      `${sourcePath}/${child.name}[${index}]`,
      ids,
      diagnostics,
    ),
  );
}

function emptyFeatureCounts(): SvgFeatureCounts {
  return {
    clipPath: 0,
    filter: 0,
    gradient: 0,
    image: 0,
    mask: 0,
    pattern: 0,
    style: 0,
    text: 0,
    use: 0,
  };
}

function scanFeatures(
  node: SvgNode,
  sourcePath: string,
  counts: Record<SvgFeature, number>,
  diagnostics: SvgDiagnostic[],
): void {
  const feature = FEATURE_ELEMENTS[node.name];
  if (feature) {
    counts[feature] += 1;
    if (BLOCKING_FEATURES.has(feature)) {
      diagnostics.push(
        diagnostic({
          code: "native-unsupported-feature",
          elementId: node.attributes.id ?? null,
          feature,
          message: `Native tracing does not support SVG ${feature}.`,
          severity: "warning",
          sourcePath,
        }),
      );
    }
  }
  for (const appliedFeature of ["filter", "mask"] as const) {
    const value = styleProperty(node.attributes, appliedFeature);
    if (
      node.name !== appliedFeature &&
      value !== null &&
      value.trim().toLowerCase() !== "none"
    ) {
      counts[appliedFeature] += 1;
      diagnostics.push(
        diagnostic({
          code: "native-unsupported-feature",
          elementId: node.attributes.id ?? null,
          feature: appliedFeature,
          message: `Applied SVG ${appliedFeature} is not native-traceable: ${value}`,
          severity: "warning",
          sourcePath,
        }),
      );
    }
  }
  node.children.forEach((child, index) =>
    scanFeatures(
      child,
      `${sourcePath}/${child.name}[${index}]`,
      counts,
      diagnostics,
    ),
  );
}

function styleProperty(
  attributes: SvgAttributes,
  property: string,
): string | null {
  const direct = attributes[property];
  if (direct !== undefined) {
    return direct;
  }
  for (const declaration of (attributes.style ?? "").split(";")) {
    const separator = declaration.indexOf(":");
    if (
      separator >= 0 &&
      declaration.slice(0, separator).trim().toLowerCase() === property
    ) {
      return declaration.slice(separator + 1).trim();
    }
  }
  return null;
}

function gradientStops(node: SvgNode): readonly string[] {
  const own =
    node.name === "stop"
      ? [styleProperty(node.attributes, "stop-color") ?? "#000000"]
      : [];
  return [...own, ...node.children.flatMap((child) => gradientStops(child))];
}

function collectGradients(root: SvgNode): ReadonlyMap<string, string> {
  const gradients = new Map<string, string>();
  const visit = (node: SvgNode) => {
    if (
      (node.name === "linearGradient" || node.name === "radialGradient") &&
      node.attributes.id
    ) {
      const colors = gradientStops(node).map(
        (color) => normalizeHexColor(color) ?? color.toLowerCase(),
      );
      const representative = colors[Math.floor(colors.length / 2)];
      if (representative) {
        gradients.set(node.attributes.id, representative);
      }
    }
    node.children.forEach(visit);
  };
  visit(root);
  return gradients;
}

function parseViewBox(
  root: SvgNode,
  diagnostics: SvgDiagnostic[],
): readonly [number, number, number, number] {
  const value = root.attributes.viewBox;
  const numbers = value === undefined ? null : strictNumberList(value, 4);
  const validViewBox =
    numbers && (numbers[2] ?? 0) > 0 && (numbers[3] ?? 0) > 0 ? numbers : null;
  if (value !== undefined && !validViewBox) {
    diagnostics.push(
      diagnostic({
        code: "invalid-geometry",
        message: `Invalid SVG viewBox: ${value}`,
        severity: "warning",
        sourcePath: root.name,
      }),
    );
  }
  if (validViewBox) {
    return [
      validViewBox[0] ?? 0,
      validViewBox[1] ?? 0,
      validViewBox[2] ?? 512,
      validViewBox[3] ?? 512,
    ];
  }
  const dimension = (name: "width" | "height") => {
    const value = root.attributes[name];
    if (value === undefined) return 512;
    const parsed = parseLength(value, null);
    if (parsed === null || parsed <= 0) {
      diagnostics.push(
        diagnostic({
          code: "invalid-geometry",
          message: `Invalid SVG length for ${name}: ${value}`,
          severity: "warning",
          sourcePath: root.name,
        }),
      );
      return 512;
    }
    return parsed;
  };
  return [0, 0, dimension("width"), dimension("height")];
}

function isAxisAlignedRectangle(points: readonly Point[]): boolean {
  const open = withoutClosingPoint(points);
  if (open.length !== 4) {
    return false;
  }
  const xValues = new Set(open.map((point) => point.x));
  const yValues = new Set(open.map((point) => point.y));
  if (xValues.size !== 2 || yValues.size !== 2) {
    return false;
  }
  const edgeOrientations = open.map((point, index) => {
    const next = open[(index + 1) % open.length];
    if (!next) {
      return null;
    }
    const horizontal =
      Math.abs(point.y - next.y) <= 1e-7 && Math.abs(point.x - next.x) > 1e-7;
    const vertical =
      Math.abs(point.x - next.x) <= 1e-7 && Math.abs(point.y - next.y) > 1e-7;
    return horizontal ? "horizontal" : vertical ? "vertical" : null;
  });
  return edgeOrientations.every(
    (orientation, index) =>
      orientation !== null &&
      orientation !== edgeOrientations[(index + 1) % edgeOrientations.length],
  );
}

function clipRectangle(
  node: SvgNode,
  matrix: Matrix,
  paint: PaintContext,
  ancestry: readonly SvgElementDescriptor[],
  cssRules: readonly CssRule[],
  flattening: EffectiveAdaptiveFlatteningOptions,
  sourcePath: string,
  viewport: SvgViewport,
): readonly Point[] | null {
  // An unmapped nested viewport cannot prove that a clip is non-constraining.
  if (node.name === "svg") return null;
  const transform = parseTransform(node.attributes.transform, sourcePath);
  if (transform.diagnostics.length > 0) {
    return null;
  }
  const nextMatrix = multiplyMatrices(matrix, transform.matrix);
  const nextAncestry = [...ancestry, descriptor(node.name, node.attributes)];
  const computed = computeElementStyle(
    paint,
    node.attributes,
    nextAncestry,
    cssRules,
    viewport,
  );
  if (!computed.paint.displayed) {
    return null;
  }
  if (isPrimitiveName(node.name)) {
    if (computed.paint.visibility !== "visible") {
      return null;
    }
    const flattened = flattenPrimitive(
      node.name,
      node.attributes,
      nextMatrix,
      flattening,
      sourcePath,
      viewport,
    );
    const points =
      flattened.subpaths.length === 1
        ? (flattened.subpaths[0]?.points ?? null)
        : null;
    return flattened.diagnostics.length === 0 &&
      points &&
      isAxisAlignedRectangle(points)
      ? points
      : null;
  }
  const candidates = node.children.flatMap((child, index) => {
    const rectangle = clipRectangle(
      child,
      nextMatrix,
      computed.paint,
      nextAncestry,
      cssRules,
      flattening,
      `${sourcePath}/${child.name}[${index}]`,
      viewport,
    );
    return rectangle ? [rectangle] : [];
  });
  return candidates.length === 1 ? (candidates[0] ?? null) : null;
}

function clipUsesViewportLengths(node: SvgNode): boolean {
  return (
    Object.entries(node.attributes).some(
      ([name, value]) =>
        /^(?:x|y|width|height|rx|ry|cx|cy|r|x1|y1|x2|y2)$/.test(name) &&
        value.includes("%"),
    ) || node.children.some(clipUsesViewportLengths)
  );
}

function collectClipDefinitions(
  root: SvgNode,
): ReadonlyMap<string, ClipDefinition> {
  const clips = new Map<string, ClipDefinition>();
  const visit = (node: SvgNode, sourcePath: string) => {
    if (node.name === "clipPath" && node.attributes.id) {
      clips.set(node.attributes.id, {
        node,
        sourcePath,
        usesViewportLengths: clipUsesViewportLengths(node),
        trivialByViewport: new Map(),
      });
    }
    node.children.forEach((child, index) =>
      visit(child, `${sourcePath}/${child.name}[${index}]`),
    );
  };
  visit(root, root.name);
  return clips;
}

function extractUrlId(value: string | null): string | null {
  return value
    ? (/^url\(\s*#([^)\s]+)\s*\)$/.exec(value.trim())?.[1] ?? null)
    : null;
}

function strictNumberList(
  value: string,
  expectedCount: number,
): readonly number[] | null {
  const numbers = parseNumberList(value);
  return numbers?.length === expectedCount ? numbers : null;
}

type SymbolViewportResult =
  | { readonly kind: "hidden" }
  | {
      readonly kind: "mapped";
      readonly matrix: Matrix;
      readonly viewport: SvgViewport;
    }
  | { readonly kind: "unsupported"; readonly message: string };

function symbolViewport(
  symbol: SvgNode,
  useAttributes: SvgAttributes,
  parentViewport: SvgViewport,
): SymbolViewportResult {
  if (
    symbol.attributes.x !== undefined ||
    symbol.attributes.y !== undefined ||
    symbol.attributes.refX !== undefined ||
    symbol.attributes.refY !== undefined ||
    symbol.attributes.transform !== undefined
  ) {
    return {
      kind: "unsupported",
      message: `Symbol #${symbol.attributes.id ?? "(anonymous)"} uses unsupported symbol-level positioning, transform, or reference-point attributes.`,
    };
  }
  if (
    styleProperty(symbol.attributes, "overflow")?.trim().toLowerCase() !==
    "visible"
  ) {
    return {
      kind: "unsupported",
      message: `Symbol #${symbol.attributes.id ?? "(anonymous)"} requires overflow="visible" because implicit symbol viewport clipping is not represented in Slice 1.`,
    };
  }
  const viewBox = strictNumberList(symbol.attributes.viewBox ?? "", 4);
  if (!viewBox || (viewBox[2] ?? 0) <= 0 || (viewBox[3] ?? 0) <= 0) {
    return {
      kind: "unsupported",
      message: `Symbol #${symbol.attributes.id ?? "(anonymous)"} requires a finite positive viewBox.`,
    };
  }
  const width = parseLength(
    styleProperty(useAttributes, "width") ??
      styleProperty(symbol.attributes, "width") ??
      undefined,
    parentViewport.width,
  );
  const height = parseLength(
    styleProperty(useAttributes, "height") ??
      styleProperty(symbol.attributes, "height") ??
      undefined,
    parentViewport.height,
  );
  if (width === null || height === null) {
    return {
      kind: "unsupported",
      message: `Symbol #${symbol.attributes.id ?? "(anonymous)"} requires numeric use width and height.`,
    };
  }
  if (width < 0 || height < 0) {
    return {
      kind: "unsupported",
      message: `Symbol #${symbol.attributes.id ?? "(anonymous)"} has a negative viewport dimension.`,
    };
  }
  if (width === 0 || height === 0) {
    return { kind: "hidden" };
  }
  const preserveAspectRatio =
    symbol.attributes.preserveAspectRatio ?? "xMidYMid meet";
  const minX = viewBox[0] ?? 0;
  const minY = viewBox[1] ?? 0;
  const viewWidth = viewBox[2] ?? 1;
  const viewHeight = viewBox[3] ?? 1;
  if (preserveAspectRatio.trim() === "none") {
    const scaleX = width / viewWidth;
    const scaleY = height / viewHeight;
    return {
      kind: "mapped",
      viewport: { minX, minY, width: viewWidth, height: viewHeight },
      matrix: [scaleX, 0, 0, scaleY, -minX * scaleX, -minY * scaleY],
    };
  }
  const match = /^(xMin|xMid|xMax)(YMin|YMid|YMax)(?:\s+(meet|slice))?$/.exec(
    preserveAspectRatio.trim(),
  );
  if (!match) {
    return {
      kind: "unsupported",
      message: `Unsupported preserveAspectRatio on symbol #${symbol.attributes.id ?? "(anonymous)"}: ${preserveAspectRatio}`,
    };
  }
  const mode = match[3] ?? "meet";
  const scale =
    mode === "slice"
      ? Math.max(width / viewWidth, height / viewHeight)
      : Math.min(width / viewWidth, height / viewHeight);
  const remainingX = width - viewWidth * scale;
  const remainingY = height - viewHeight * scale;
  const offsetX =
    match[1] === "xMin" ? 0 : match[1] === "xMid" ? remainingX / 2 : remainingX;
  const offsetY =
    match[2] === "YMin" ? 0 : match[2] === "YMid" ? remainingY / 2 : remainingY;
  return {
    kind: "mapped",
    viewport: { minX, minY, width: viewWidth, height: viewHeight },
    matrix: [
      scale,
      0,
      0,
      scale,
      offsetX - minX * scale,
      offsetY - minY * scale,
    ],
  };
}

function clipIsTrivial(
  definition: ClipDefinition | undefined,
  viewport: SvgViewport,
  state: ParserState,
): boolean {
  if (
    !definition ||
    definition.node.attributes.clipPathUnits === "objectBoundingBox"
  )
    return false;
  const viewportKey = [
    viewport.minX,
    viewport.minY,
    viewport.width,
    viewport.height,
  ].join(":");
  const cached = definition.trivialByViewport.get(viewportKey);
  if (cached !== undefined) return cached;
  const rectangle = clipRectangle(
    definition.node,
    IDENTITY_MATRIX,
    DEFAULT_PAINT_CONTEXT,
    [],
    state.cssRules,
    state.flattening,
    definition.sourcePath,
    viewport,
  );
  const open = rectangle ? withoutClosingPoint(rectangle) : [];
  const minX = Math.min(...open.map((point) => point.x));
  const maxX = Math.max(...open.map((point) => point.x));
  const minY = Math.min(...open.map((point) => point.y));
  const maxY = Math.max(...open.map((point) => point.y));
  const approximately = (left: number, right: number) =>
    Math.abs(left - right) <= 0.01;
  // Only absolute geometry can use the corpus normalizer's known 100x100
  // exception. Percentage clips must match their application viewport itself.
  // Sampled geometry alone cannot prove that a clip is non-constraining.
  const matchesCanvas =
    rectangle !== null &&
    ((!definition.usesViewportLengths &&
      approximately(minX, 0) &&
      approximately(minY, 0) &&
      approximately(maxX, 100) &&
      approximately(maxY, 100)) ||
      (approximately(minX, viewport.minX) &&
        approximately(minY, viewport.minY) &&
        approximately(maxX, viewport.minX + viewport.width) &&
        approximately(maxY, viewport.minY + viewport.height)));
  definition.trivialByViewport.set(viewportKey, matchesCanvas);
  return matchesCanvas;
}

function nodePath(parent: string, child: SvgNode, index: number): string {
  const id = child.attributes.id ? `#${child.attributes.id}` : "";
  return `${parent}/${child.name}${id}[${index}]`;
}

function walkNode(
  node: SvgNode,
  sourcePath: string,
  context: WalkContext,
  state: ParserState,
  useStack: readonly string[],
  referencedSymbolRoot = false,
): void {
  if (state.resourceLimitExceeded) {
    return;
  }
  const elementDescriptor = descriptor(node.name, node.attributes);
  const ancestry = [...context.ancestry, elementDescriptor];
  const transform = parseTransform(node.attributes.transform, sourcePath);
  transform.diagnostics.forEach((entry) => pushDiagnostic(state, entry));
  const matrix = multiplyMatrices(context.matrix, transform.matrix);
  const computed = computeElementStyle(
    context.paint,
    node.attributes,
    ancestry,
    state.cssRules,
    context.viewport,
  );
  if (
    !(referencedSymbolRoot ? context.paint.displayed : computed.paint.displayed)
  ) {
    return;
  }
  if (computed.invalidStrokeWidth) {
    pushDiagnostic(
      state,
      diagnostic({
        code: "unsupported-presentation-property",
        elementId: node.attributes.id ?? null,
        message: "Unsupported presentation property: stroke-width",
        severity: "warning",
        sourcePath,
      }),
    );
  }
  for (const property of computed.unsupportedProperties) {
    pushDiagnostic(
      state,
      diagnostic({
        code: "unsupported-presentation-property",
        elementId: node.attributes.id ?? null,
        message: `Unsupported presentation property: ${property}`,
        severity: "warning",
        sourcePath,
      }),
      `unsupported-presentation-property:${property}:${sourcePath}`,
    );
  }
  const localClipId = extractUrlId(computed.clipPath);
  const activeClips = localClipId
    ? [
        ...context.activeClips,
        { id: localClipId, sourcePath, viewport: context.viewport },
      ]
    : context.activeClips;
  const nextContext: WalkContext = {
    activeClips,
    ancestry,
    matrix,
    viewport: context.viewport,
    paint: referencedSymbolRoot
      ? { ...computed.paint, displayed: context.paint.displayed }
      : computed.paint,
  };

  if (node.name === "use") {
    const reference =
      node.attributes.href ?? node.attributes["xlink:href"] ?? "";
    const referenceId = reference.startsWith("#") ? reference.slice(1) : "";
    if (!referenceId || !state.ids.has(referenceId)) {
      pushDiagnostic(
        state,
        diagnostic({
          code: "use-reference-missing",
          elementId: node.attributes.id ?? null,
          feature: "use",
          message: `Unable to resolve SVG use reference: ${reference || "(empty)"}`,
          severity: "warning",
          sourcePath,
        }),
      );
      return;
    }
    if (useStack.includes(referenceId)) {
      pushDiagnostic(
        state,
        diagnostic({
          code: "use-cycle",
          elementId: node.attributes.id ?? null,
          feature: "use",
          message: `Cyclic SVG use reference: ${[...useStack, referenceId].join(" -> ")}`,
          severity: "warning",
          sourcePath,
        }),
      );
      return;
    }
    const referenceNode = state.ids.get(referenceId);
    if (!referenceNode) {
      return;
    }
    if (useStack.length >= state.useExpansion.maxDepth) {
      exceedExpansionLimit(
        state,
        `SVG use expansion exceeded maxDepth=${state.useExpansion.maxDepth}.`,
        sourcePath,
      );
      return;
    }
    if (state.useExpansions >= state.useExpansion.maxExpansions) {
      exceedExpansionLimit(
        state,
        `SVG use expansion exceeded maxExpansions=${state.useExpansion.maxExpansions}.`,
        sourcePath,
      );
      return;
    }
    state.useExpansions += 1;
    state.usesResolved += 1;
    const x = parseLength(node.attributes.x ?? "0", context.viewport.width);
    const y = parseLength(node.attributes.y ?? "0", context.viewport.height);
    if (x === null || y === null) {
      pushDiagnostic(
        state,
        diagnostic({
          code: "invalid-geometry",
          elementId: node.attributes.id ?? null,
          feature: "use",
          message: "Invalid SVG use x/y length.",
          severity: "warning",
          sourcePath,
        }),
      );
      return;
    }
    const translatedMatrix = multiplyMatrices(matrix, [1, 0, 0, 1, x, y]);
    let referenceMatrix = translatedMatrix;
    let referenceViewport = context.viewport;
    if (referenceNode.name === "symbol") {
      const viewport = symbolViewport(
        referenceNode,
        node.attributes,
        context.viewport,
      );
      if (viewport.kind === "unsupported") {
        pushDiagnostic(
          state,
          diagnostic({
            code: "symbol-viewport-unsupported",
            elementId: node.attributes.id ?? null,
            feature: "use",
            message: viewport.message,
            severity: "warning",
            sourcePath,
          }),
        );
        return;
      }
      if (viewport.kind === "hidden") {
        return;
      }
      referenceMatrix = multiplyMatrices(translatedMatrix, viewport.matrix);
      referenceViewport = viewport.viewport;
    }
    walkNode(
      referenceNode,
      `${sourcePath}->#${referenceId}`,
      { ...nextContext, matrix: referenceMatrix, viewport: referenceViewport },
      state,
      [...useStack, referenceId],
      referenceNode.name === "symbol",
    );
    return;
  }

  if (NON_RENDERING.has(node.name)) {
    return;
  }
  if (node.name === "symbol" && !referencedSymbolRoot) {
    return;
  }
  if (node.name === "svg" && context.ancestry.length > 0) {
    pushDiagnostic(
      state,
      diagnostic({
        code: "unsupported-element",
        elementId: node.attributes.id ?? null,
        message:
          "Nested SVG viewports and their clipping are not represented in native conversion.",
        severity: "warning",
        sourcePath,
      }),
    );
    return;
  }
  if (CONTAINERS.has(node.name)) {
    node.children.forEach((child, index) =>
      walkNode(
        child,
        nodePath(sourcePath, child, index),
        nextContext,
        state,
        useStack,
      ),
    );
    return;
  }
  if (!isPrimitiveName(node.name)) {
    if (!NON_RENDERING.has(node.name)) {
      pushDiagnostic(
        state,
        diagnostic({
          code: "unsupported-element",
          elementId: node.attributes.id ?? null,
          message: `Unsupported rendered SVG element: ${node.name}`,
          severity: "warning",
          sourcePath,
        }),
      );
    }
    return;
  }
  if (computed.paint.visibility !== "visible") {
    return;
  }
  if (state.shapes.length >= state.useExpansion.maxShapes) {
    exceedExpansionLimit(
      state,
      `SVG shape expansion exceeded maxShapes=${state.useExpansion.maxShapes}.`,
      sourcePath,
    );
    return;
  }

  const flattened = flattenPrimitive(
    node.name,
    node.attributes,
    matrix,
    state.flattening,
    sourcePath,
    context.viewport,
  );
  flattened.diagnostics.forEach((entry) => pushDiagnostic(state, entry));
  if (flattened.subpaths.length === 0) {
    return;
  }
  state.cubicSegments += flattened.metrics.cubicSegments;
  state.arcSegments += flattened.metrics.arcSegments;
  state.flattenedSegments += flattened.metrics.flattenedSegments;

  const realClipIds: string[] = [];
  for (const application of activeClips) {
    if (
      clipIsTrivial(
        state.clipDefinitions.get(application.id),
        application.viewport,
        state,
      )
    ) {
      pushDiagnostic(
        state,
        diagnostic({
          code: "trivial-clip-removed",
          elementId: application.id,
          feature: "clipPath",
          message: `Removed non-constraining clip path #${application.id}.`,
          severity: "info",
          sourcePath: application.sourcePath,
        }),
        `trivial-clip:${application.id}:${application.sourcePath}`,
      );
    } else {
      realClipIds.push(application.id);
      pushDiagnostic(
        state,
        diagnostic({
          code: "native-unsupported-clip",
          elementId: application.id,
          feature: "clipPath",
          message: `Clip path #${application.id} constrains geometry and is not native-traceable in Slice 1.`,
          severity: "warning",
          sourcePath: application.sourcePath,
        }),
        `real-clip:${application.id}:${application.sourcePath}`,
      );
    }
  }

  const fillResult = resolvePaint(
    computed.paint.fill,
    computed.paint.opacity * computed.paint.fillOpacity,
    computed.paint.color,
    state.gradients,
  );
  const strokeResult = resolvePaint(
    computed.paint.stroke,
    computed.paint.opacity * computed.paint.strokeOpacity,
    computed.paint.color,
    state.gradients,
  );
  for (const paintResult of [fillResult, strokeResult]) {
    if (paintResult.gradientId && state.gradients.has(paintResult.gradientId)) {
      pushDiagnostic(
        state,
        diagnostic({
          code: "gradient-flattened",
          elementId: paintResult.gradientId,
          feature: "gradient",
          message: `Flattened gradient #${paintResult.gradientId} to a representative color.`,
          severity: "warning",
          sourcePath,
        }),
        `gradient:${paintResult.gradientId}`,
      );
    }
  }
  state.shapes.push({
    clipPathIds: [...new Set(realClipIds)].sort(),
    elementId: node.attributes.id ?? null,
    fill: fillResult.paint,
    fillRule: computed.paint.fillRule,
    id: `shape:${state.shapeIndex}`,
    sourceElement: node.name,
    sourcePath,
    stroke: strokeResult.paint,
    strokeWidth: computed.paint.strokeWidth * transformedStrokeScale(matrix),
    subpaths: flattened.subpaths,
  });
  state.shapeIndex += 1;
}

function parseFailure(message: string): SvgParseResult {
  const error = diagnostic({
    code: "invalid-svg",
    message,
    severity: "error",
  });
  return { diagnostics: [error], document: null, ok: false };
}

export function parseSvg(
  source: string,
  options: SvgParseOptions = {},
): SvgParseResult {
  const validation = XMLValidator.validate(source);
  if (validation !== true) {
    const message =
      isRecord(validation) &&
      isRecord(validation.err) &&
      typeof validation.err.msg === "string"
        ? validation.err.msg
        : "Malformed SVG XML.";
    return parseFailure(message);
  }

  try {
    const parser = new XMLParser({
      preserveOrder: true,
      ignoreAttributes: false,
      attributeNamePrefix: "",
      trimValues: false,
      processEntities: false,
    });
    const parsed: unknown = parser.parse(source);
    if (!Array.isArray(parsed)) {
      return parseFailure("Expected an SVG XML document.");
    }
    const roots = nodesFromPreserveOrder(parsed);
    const root = roots.find((node) => node.name === "svg");
    if (!root) {
      return parseFailure("Expected an SVG root element.");
    }

    const initialDiagnostics: SvgDiagnostic[] = [];
    const viewBox = parseViewBox(root, initialDiagnostics);
    const ids = new Map<string, SvgNode>();
    collectIds(root, root.name, ids, initialDiagnostics);
    const css = parseCssRules(collectStyles(root, root.name));
    initialDiagnostics.push(...css.diagnostics);
    const mutableFeatureCounts = emptyFeatureCounts();
    scanFeatures(root, root.name, mutableFeatureCounts, initialDiagnostics);
    const flattening = effectiveFlattening(options.flattening);
    const useExpansion = effectiveUseExpansion(options.useExpansion);
    const state: ParserState = {
      arcSegments: 0,
      clipDefinitions: collectClipDefinitions(root),
      cssRules: css.rules,
      cubicSegments: 0,
      diagnostics: [],
      diagnosticKeys: new Set<string>(),
      flattenedSegments: 0,
      flattening,
      gradients: collectGradients(root),
      ids,
      shapes: [],
      resourceLimitExceeded: false,
      shapeIndex: 0,
      useExpansion,
      useExpansions: 0,
      usesResolved: 0,
    };
    initialDiagnostics.forEach((entry) => pushDiagnostic(state, entry));
    walkNode(
      root,
      root.name,
      {
        activeClips: [],
        ancestry: [],
        matrix: IDENTITY_MATRIX,
        paint: DEFAULT_PAINT_CONTEXT,
        viewport: {
          minX: viewBox[0],
          minY: viewBox[1],
          width: viewBox[2],
          height: viewBox[3],
        },
      },
      state,
      [],
    );

    const compareCodeUnits = (left: string, right: string) =>
      left < right ? -1 : left > right ? 1 : 0;
    const diagnostics = [...state.diagnostics].sort((left, right) =>
      compareCodeUnits(
        `${left.code}:${left.sourcePath ?? ""}:${left.message}`,
        `${right.code}:${right.sourcePath ?? ""}:${right.message}`,
      ),
    );
    const subpaths = state.shapes.flatMap((shape) => shape.subpaths);
    const document: CanonicalSvgDocument = {
      diagnostics,
      features: mutableFeatureCounts,
      flattening,
      metrics: {
        arcSegments: state.arcSegments,
        closedSubpaths: subpaths.filter((subpath) => subpath.closed).length,
        cubicSegments: state.cubicSegments,
        flattenedSegments: state.flattenedSegments,
        openSubpaths: subpaths.filter((subpath) => !subpath.closed).length,
        pathElements: state.shapes.filter(
          (shape) => shape.sourceElement === "path",
        ).length,
        points: subpaths.reduce(
          (total, subpath) => total + subpath.points.length,
          0,
        ),
        shapes: state.shapes.length,
        usesResolved: state.usesResolved,
      },
      shapes: state.shapes,
      sourceHash: fnv1a32(source, "hex"),
      sourceName: options.sourceName ?? "inline.svg",
      useExpansion,
      viewBox,
    };
    return { diagnostics, document, ok: true };
  } catch (error) {
    return parseFailure(
      error instanceof Error ? error.message : "Unknown SVG parser error.",
    );
  }
}

export function deterministicDocumentJson(
  document: CanonicalSvgDocument,
): string {
  return JSON.stringify(document);
}

export function deterministicDocumentChecksum(
  document: CanonicalSvgDocument,
): string {
  return fnv1a32(deterministicDocumentJson(document), "hex");
}
