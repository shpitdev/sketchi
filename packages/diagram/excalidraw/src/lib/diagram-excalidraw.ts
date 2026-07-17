import type {
  ArrowSceneElement,
  NodeSceneElement,
  RenderedDiagramScene,
  TextSceneElement,
} from "@sketchi/diagram-renderer";
import { generateKeyBetween } from "fractional-indexing";

export type ExcalidrawElement = Record<string, unknown> & {
  id: string;
  type: string;
};

export interface ExcalidrawScene {
  appState: Record<string, unknown>;
  elements: ExcalidrawElement[];
}

export interface ExcalidrawFile {
  appState: Record<string, unknown>;
  elements: ExcalidrawElement[];
  files: Record<string, unknown>;
  source: string;
  type: "excalidraw";
  version: 2;
}

export interface ExcalidrawSceneValidationIssue {
  code:
    | "arrow-endpoint-off-shape"
    | "empty-scene"
    | "invalid-elbow-binding"
    | "arrow-segment-through-node"
    | "missing-arrow-binding"
    | "missing-bound-arrow"
    | "missing-container"
    | "overlapping-arrow-segment"
    | "text-overflow";
  elementId?: string;
  message: string;
}

export interface ExcalidrawSceneValidationResult {
  issues: ExcalidrawSceneValidationIssue[];
  ok: boolean;
}

const SHAPE_TYPES = new Set(["rectangle", "ellipse", "diamond"]);
const TEXT_LINE_HEIGHT = 1.35;
const TEXT_WIDTH_FACTOR = 0.62;
const TEXT_HORIZONTAL_PADDING = 24;
const TEXT_VERTICAL_PADDING = 18;
const ARROW_LABEL_WIDTH = 160;
const FIT_TARGET_WIDTH = 860;
const FIT_TARGET_HEIGHT = 340;
const MIN_INITIAL_ZOOM = 0.42;
const SEGMENT_EPSILON = 0.001;
const BOUNDS_EPSILON = 0.01;
const DEFAULT_TEXT_COLOR = "#1e1e1e";
const DEFAULT_EXCALIDRAW_EXPORT_SOURCE = "https://sketchi.app";

type BindingKey = "startBinding" | "endBinding";

interface ElementBounds {
  height: number;
  width: number;
  x: number;
  y: number;
}

function numericValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function finitePointTuple(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) {
    return null;
  }

  const x = numericValue(value[0]);
  const y = numericValue(value[1]);

  return x === null || y === null ? null : [x, y];
}

function elementBounds(element: ExcalidrawElement): ElementBounds | null {
  const x = numericValue(element.x);
  const y = numericValue(element.y);
  const width = numericValue(element.width);
  const height = numericValue(element.height);

  return x === null || y === null || width === null || height === null
    ? null
    : { x, y, width, height };
}

function normalizedFixedPoint(value: number): number {
  return Math.abs(value - 0.5) < 0.0001 ? 0.5001 : value;
}

function fixedPointForShape(
  shape: ExcalidrawElement,
  point: { x: number; y: number },
): [number, number] | null {
  const bounds = elementBounds(shape);

  if (!bounds || bounds.width === 0 || bounds.height === 0) {
    return null;
  }

  return [
    normalizedFixedPoint((point.x - bounds.x) / bounds.width),
    normalizedFixedPoint((point.y - bounds.y) / bounds.height),
  ];
}

function bindingForShape(
  shape: ExcalidrawElement | undefined,
  point: { x: number; y: number },
) {
  return {
    elementId: shape?.id ?? "",
    focus: 0,
    gap: 0,
    fixedPoint: shape ? fixedPointForShape(shape, point) : null,
  };
}

function initialZoomForScene(scene: RenderedDiagramScene): number {
  const zoom = Math.min(
    1,
    FIT_TARGET_WIDTH / Math.max(scene.width, 1),
    FIT_TARGET_HEIGHT / Math.max(scene.height, 1),
  );

  return Math.max(MIN_INITIAL_ZOOM, Math.round(zoom * 100) / 100);
}

function stableSeed(input: string): number {
  let hash = 2166136261;
  for (const char of input) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) || 1;
}

function elementBase(id: string, index: string) {
  const seed = stableSeed(id);
  return {
    id,
    angle: 0,
    fillStyle: "solid",
    frameId: null,
    groupIds: [],
    index,
    isDeleted: false,
    link: null,
    locked: false,
    opacity: 100,
    roughness: 1,
    seed,
    strokeStyle: "solid",
    strokeWidth: 2,
    updated: 1,
    version: 1,
    versionNonce: seed + 1,
  };
}

function estimateTextWidth(text: string, fontSize: number): number {
  return Math.ceil(
    Math.max(...text.split("\n").map((line) => line.length)) *
      fontSize *
      TEXT_WIDTH_FACTOR,
  );
}

function textHeight(text: string, fontSize: number): number {
  return Math.ceil(text.split("\n").length * fontSize * TEXT_LINE_HEIGHT);
}

function textElement(input: {
  containerId: string;
  fontSize: number;
  id: string;
  index: string;
  maxWidth: number;
  textColor?: string;
  text: string;
  x: number;
  y: number;
}): ExcalidrawElement {
  const width = Math.max(
    1,
    Math.min(input.maxWidth, estimateTextWidth(input.text, input.fontSize)),
  );
  const height = textHeight(input.text, input.fontSize);

  return {
    ...elementBase(input.id, input.index),
    type: "text",
    x: input.x - width / 2,
    y: input.y - height / 2,
    width,
    height,
    backgroundColor: "transparent",
    boundElements: null,
    containerId: input.containerId,
    fontFamily: 5,
    fontSize: input.fontSize,
    lineHeight: TEXT_LINE_HEIGHT,
    originalText: input.text,
    roundness: null,
    strokeColor: input.textColor ?? DEFAULT_TEXT_COLOR,
    text: input.text,
    textAlign: "center",
    verticalAlign: "middle",
    autoResize: true,
  };
}

function shapeElement(input: {
  arrowIds: readonly string[];
  index: string;
  scene: RenderedDiagramScene;
  shape: NodeSceneElement;
  text?: TextSceneElement;
}): ExcalidrawElement {
  const labelHeight = input.text
    ? textHeight(input.text.text, input.text.fontSize) + TEXT_VERTICAL_PADDING
    : 0;
  const height = Math.max(input.shape.height, labelHeight);
  const shapeType =
    input.shape.shape === "circle" ? "ellipse" : input.shape.shape;
  const boundElements = [
    ...(input.text ? [{ id: input.text.id, type: "text" }] : []),
    ...input.arrowIds.map((id) => ({ id, type: "arrow" })),
  ];

  return {
    ...elementBase(input.shape.id, input.index),
    type: shapeType,
    x: input.shape.x,
    y: input.shape.y,
    width: input.shape.width,
    height,
    backgroundColor: input.shape.fillColor ?? "transparent",
    boundElements: boundElements.length > 0 ? boundElements : null,
    roundness: shapeType === "rectangle" ? { type: 3 } : null,
    strokeColor: input.shape.strokeColor ?? input.scene.accentColor,
  };
}

function lastArrowPoint(arrow: ArrowSceneElement) {
  return arrow.points[arrow.points.length - 1] ?? arrow.points[0];
}

function arrowElement(input: {
  arrow: ArrowSceneElement;
  index: string;
  scene: RenderedDiagramScene;
  sourceShape: ExcalidrawElement | undefined;
  targetShape: ExcalidrawElement | undefined;
}): ExcalidrawElement {
  const start = input.arrow.points[0];
  const end = lastArrowPoint(input.arrow);
  const elbowed = input.arrow.points.length > 2;

  return {
    ...elementBase(input.arrow.id, input.index),
    type: "arrow",
    x: start.x,
    y: start.y,
    width: end.x - start.x,
    height: end.y - start.y,
    backgroundColor: "transparent",
    boundElements: input.arrow.label
      ? [{ id: `${input.arrow.id}:label`, type: "text" }]
      : null,
    elbowed,
    endArrowhead: "arrow",
    endBinding: bindingForShape(input.targetShape, end),
    ...(elbowed
      ? {
          fixedSegments: [],
          startIsSpecial: null,
          endIsSpecial: null,
        }
      : {}),
    points: input.arrow.points.map((point) => [
      point.x - start.x,
      point.y - start.y,
    ]),
    roundness: elbowed ? null : { type: 2 },
    startArrowhead: null,
    startBinding: bindingForShape(input.sourceShape, start),
    strokeColor: input.arrow.strokeColor ?? input.scene.accentColor,
  };
}

function arrowLabelElement(input: {
  arrow: ArrowSceneElement;
  index: string;
}): ExcalidrawElement | null {
  if (!input.arrow.label) {
    return null;
  }

  const start = input.arrow.points[0];
  const end = lastArrowPoint(input.arrow);
  return textElement({
    id: `${input.arrow.id}:label`,
    index: input.index,
    containerId: input.arrow.id,
    fontSize: 13,
    maxWidth: ARROW_LABEL_WIDTH,
    ...(input.arrow.textColor ? { textColor: input.arrow.textColor } : {}),
    text: input.arrow.label,
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2 - 10,
  });
}

function collectArrowsByNode(
  arrows: readonly ArrowSceneElement[],
): Map<string, string[]> {
  const result = new Map<string, string[]>();

  for (const arrow of arrows) {
    for (const nodeId of [arrow.sourceNodeId, arrow.targetNodeId]) {
      const shapeId = `node:${nodeId}`;
      result.set(shapeId, [...(result.get(shapeId) ?? []), arrow.id]);
    }
  }

  return result;
}

function isNode(
  element: RenderedDiagramScene["elements"][number],
): element is NodeSceneElement {
  return element.type === "node";
}

function isText(
  element: RenderedDiagramScene["elements"][number],
): element is TextSceneElement {
  return element.type === "text";
}

function isArrow(
  element: RenderedDiagramScene["elements"][number],
): element is ArrowSceneElement {
  return element.type === "arrow";
}

export function convertSceneToExcalidraw(
  scene: RenderedDiagramScene,
): ExcalidrawScene {
  const nodes = scene.elements.filter(isNode);
  const textByContainerId = new Map(
    scene.elements
      .filter(isText)
      .map((element) => [element.containerId ?? "", element]),
  );
  const arrows = scene.elements.filter(isArrow);
  const arrowsByNode = collectArrowsByNode(arrows);
  const shapeElementsByNodeId = new Map<string, ExcalidrawElement>();
  const elements: ExcalidrawElement[] = [];
  let previousIndex: string | null = null;
  const nextIndex = () => {
    const index = generateKeyBetween(previousIndex, null);
    previousIndex = index;
    return index;
  };

  for (const node of nodes) {
    const text = textByContainerId.get(node.id);
    const shape = shapeElement({
      scene,
      shape: node,
      arrowIds: arrowsByNode.get(node.id) ?? [],
      index: nextIndex(),
      ...(text ? { text } : {}),
    });

    shapeElementsByNodeId.set(node.nodeId, shape);
    elements.push(shape);
  }

  for (const text of scene.elements.filter(isText)) {
    if (!text.containerId) {
      continue;
    }
    elements.push(
      textElement({
        id: text.id,
        index: nextIndex(),
        containerId: text.containerId,
        fontSize: text.fontSize,
        maxWidth: text.maxWidth ?? 160,
        ...(text.textColor ? { textColor: text.textColor } : {}),
        text: text.text,
        x: text.x,
        y: text.y,
      }),
    );
  }

  for (const arrow of arrows) {
    elements.push(
      arrowElement({
        arrow,
        scene,
        index: nextIndex(),
        sourceShape: shapeElementsByNodeId.get(arrow.sourceNodeId),
        targetShape: shapeElementsByNodeId.get(arrow.targetNodeId),
      }),
    );
    const label = arrow.label
      ? arrowLabelElement({ arrow, index: nextIndex() })
      : null;
    if (label) {
      elements.push(label);
    }
  }

  return {
    appState: {
      viewBackgroundColor: scene.backgroundColor,
      zoom: {
        value: initialZoomForScene(scene),
      },
    },
    elements,
  };
}

export function createExcalidrawFile(
  scene: ExcalidrawScene,
  options: { source?: string } = {},
): ExcalidrawFile {
  return {
    type: "excalidraw",
    version: 2,
    source: options.source ?? DEFAULT_EXCALIDRAW_EXPORT_SOURCE,
    elements: scene.elements,
    appState: scene.appState,
    files: {},
  };
}

function hasBoundElement(
  element: ExcalidrawElement,
  id: string,
  type: string,
): boolean {
  const boundElements = element.boundElements;
  if (!Array.isArray(boundElements)) {
    return false;
  }

  return boundElements.some((bound) => {
    if (!(bound && typeof bound === "object")) {
      return false;
    }
    return (
      (bound as { id?: unknown }).id === id &&
      (bound as { type?: unknown }).type === type
    );
  });
}

function bindingElementId(
  element: ExcalidrawElement,
  key: string,
): string | null {
  const binding = element[key];
  if (!(binding && typeof binding === "object")) {
    return null;
  }

  const elementId = (binding as { elementId?: unknown }).elementId;
  return typeof elementId === "string" ? elementId : null;
}

function bindingFixedPoint(
  element: ExcalidrawElement,
  key: BindingKey,
): [number, number] | null {
  const binding = element[key];
  if (!(binding && typeof binding === "object")) {
    return null;
  }

  return finitePointTuple((binding as { fixedPoint?: unknown }).fixedPoint);
}

interface ArrowSegment {
  arrowId: string;
  endBindingElementId: string | null;
  isLastSegment: boolean;
  max: number;
  min: number;
  orientation: "horizontal" | "vertical";
  segmentIndex: number;
  startBindingElementId: string | null;
  staticCoordinate: number;
}

function pointTuple(value: unknown): [number, number] | null {
  return finitePointTuple(value);
}

function arrowSegments(element: ExcalidrawElement): ArrowSegment[] {
  const originX = numericValue(element.x) ?? 0;
  const originY = numericValue(element.y) ?? 0;
  const startBindingElementId = bindingElementId(element, "startBinding");
  const endBindingElementId = bindingElementId(element, "endBinding");
  const points = Array.isArray(element.points)
    ? element.points
        .map(pointTuple)
        .filter((point): point is [number, number] => Boolean(point))
    : [];
  const segments: ArrowSegment[] = [];

  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[index];
    const current = points[index + 1];

    if (!previous || !current) {
      continue;
    }

    const [previousX, previousY] = previous;
    const [currentX, currentY] = current;
    const x1 = originX + previousX;
    const y1 = originY + previousY;
    const x2 = originX + currentX;
    const y2 = originY + currentY;

    if (Math.abs(y1 - y2) <= SEGMENT_EPSILON) {
      segments.push({
        arrowId: element.id,
        endBindingElementId,
        isLastSegment: index === points.length - 2,
        max: Math.max(x1, x2),
        min: Math.min(x1, x2),
        orientation: "horizontal",
        segmentIndex: index,
        startBindingElementId,
        staticCoordinate: y1,
      });
      continue;
    }

    if (Math.abs(x1 - x2) <= SEGMENT_EPSILON) {
      segments.push({
        arrowId: element.id,
        endBindingElementId,
        isLastSegment: index === points.length - 2,
        max: Math.max(y1, y2),
        min: Math.min(y1, y2),
        orientation: "vertical",
        segmentIndex: index,
        startBindingElementId,
        staticCoordinate: x1,
      });
    }
  }

  return segments.filter(
    (segment) => segment.max - segment.min > SEGMENT_EPSILON,
  );
}

function overlapLength(left: ArrowSegment, right: ArrowSegment): number {
  return Math.min(left.max, right.max) - Math.max(left.min, right.min);
}

function isSharedBoundStemOverlap(
  left: ArrowSegment,
  right: ArrowSegment,
): boolean {
  return (
    (left.segmentIndex === 0 &&
      right.segmentIndex === 0 &&
      left.startBindingElementId !== null &&
      left.startBindingElementId === right.startBindingElementId) ||
    (left.isLastSegment &&
      right.isLastSegment &&
      left.endBindingElementId !== null &&
      left.endBindingElementId === right.endBindingElementId)
  );
}

function overlappingArrowSegments(
  elements: readonly ExcalidrawElement[],
): ExcalidrawSceneValidationIssue[] {
  const segments = elements
    .filter((element) => element.type === "arrow")
    .flatMap(arrowSegments);
  const issues: ExcalidrawSceneValidationIssue[] = [];
  const seen = new Set<string>();

  for (let leftIndex = 0; leftIndex < segments.length; leftIndex += 1) {
    const left = segments[leftIndex];
    if (!left) {
      continue;
    }

    for (
      let rightIndex = leftIndex + 1;
      rightIndex < segments.length;
      rightIndex += 1
    ) {
      const right = segments[rightIndex];
      if (!right) {
        continue;
      }

      if (
        left.arrowId === right.arrowId ||
        left.orientation !== right.orientation ||
        Math.abs(left.staticCoordinate - right.staticCoordinate) >
          SEGMENT_EPSILON ||
        isSharedBoundStemOverlap(left, right) ||
        overlapLength(left, right) <= SEGMENT_EPSILON
      ) {
        continue;
      }

      const key = [
        left.arrowId,
        left.segmentIndex,
        right.arrowId,
        right.segmentIndex,
      ]
        .sort()
        .join(":");
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      issues.push({
        code: "overlapping-arrow-segment",
        elementId: left.arrowId,
        message: `Arrow "${left.arrowId}" overlaps arrow "${right.arrowId}".`,
      });
    }
  }

  return issues;
}

function betweenInterior(value: number, min: number, max: number): boolean {
  return value > min + BOUNDS_EPSILON && value < max - BOUNDS_EPSILON;
}

function interiorOverlap(
  leftMin: number,
  leftMax: number,
  rightMin: number,
  rightMax: number,
): boolean {
  return (
    Math.min(leftMax, rightMax) - Math.max(leftMin, rightMin) > BOUNDS_EPSILON
  );
}

function segmentCrossesShapeInterior(
  segment: ArrowSegment,
  shapeBounds: ElementBounds,
): boolean {
  if (segment.orientation === "horizontal") {
    return (
      betweenInterior(
        segment.staticCoordinate,
        shapeBounds.y,
        shapeBounds.y + shapeBounds.height,
      ) &&
      interiorOverlap(
        segment.min,
        segment.max,
        shapeBounds.x,
        shapeBounds.x + shapeBounds.width,
      )
    );
  }

  return (
    betweenInterior(
      segment.staticCoordinate,
      shapeBounds.x,
      shapeBounds.x + shapeBounds.width,
    ) &&
    interiorOverlap(
      segment.min,
      segment.max,
      shapeBounds.y,
      shapeBounds.y + shapeBounds.height,
    )
  );
}

function arrowSegmentsThroughShapes(
  elements: readonly ExcalidrawElement[],
): ExcalidrawSceneValidationIssue[] {
  const segments = elements
    .filter((element) => element.type === "arrow")
    .flatMap(arrowSegments);
  const shapes = elements.filter((element) => SHAPE_TYPES.has(element.type));
  const issues: ExcalidrawSceneValidationIssue[] = [];
  const seen = new Set<string>();

  for (const segment of segments) {
    for (const shape of shapes) {
      if (
        shape.id === segment.startBindingElementId ||
        shape.id === segment.endBindingElementId
      ) {
        continue;
      }

      const bounds = elementBounds(shape);
      if (!bounds || !segmentCrossesShapeInterior(segment, bounds)) {
        continue;
      }

      const key = `${segment.arrowId}:${segment.segmentIndex}:${shape.id}`;
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      issues.push({
        code: "arrow-segment-through-node",
        elementId: segment.arrowId,
        message: `Arrow "${segment.arrowId}" passes through shape "${shape.id}".`,
      });
    }
  }

  return issues;
}

function arrowEndpoint(element: ExcalidrawElement, key: BindingKey) {
  const x = numericValue(element.x) ?? 0;
  const y = numericValue(element.y) ?? 0;
  const points = Array.isArray(element.points)
    ? element.points
        .map(pointTuple)
        .filter((point): point is [number, number] => Boolean(point))
    : [];
  const point = key === "startBinding" ? points[0] : points[points.length - 1];

  return point ? { x: x + point[0], y: y + point[1] } : null;
}

function between(value: number, min: number, max: number): boolean {
  return value >= min - BOUNDS_EPSILON && value <= max + BOUNDS_EPSILON;
}

function near(value: number, target: number): boolean {
  return Math.abs(value - target) <= BOUNDS_EPSILON;
}

function pointOnShapeBoundary(
  point: { x: number; y: number },
  shape: ExcalidrawElement,
): boolean {
  const bounds = elementBounds(shape);

  if (!bounds) {
    return false;
  }

  if (shape.type === "diamond") {
    const halfWidth = bounds.width / 2;
    const halfHeight = bounds.height / 2;

    if (halfWidth === 0 || halfHeight === 0) {
      return false;
    }

    const centerX = bounds.x + halfWidth;
    const centerY = bounds.y + halfHeight;
    const boundaryValue =
      Math.abs(point.x - centerX) / halfWidth +
      Math.abs(point.y - centerY) / halfHeight;

    return near(boundaryValue, 1);
  }

  if (shape.type === "ellipse") {
    const halfWidth = bounds.width / 2;
    const halfHeight = bounds.height / 2;

    if (halfWidth === 0 || halfHeight === 0) {
      return false;
    }

    const centerX = bounds.x + halfWidth;
    const centerY = bounds.y + halfHeight;
    const boundaryValue =
      ((point.x - centerX) / halfWidth) ** 2 +
      ((point.y - centerY) / halfHeight) ** 2;

    return near(boundaryValue, 1);
  }

  const onVerticalSide =
    (near(point.x, bounds.x) || near(point.x, bounds.x + bounds.width)) &&
    between(point.y, bounds.y, bounds.y + bounds.height);
  const onHorizontalSide =
    (near(point.y, bounds.y) || near(point.y, bounds.y + bounds.height)) &&
    between(point.x, bounds.x, bounds.x + bounds.width);

  return onVerticalSide || onHorizontalSide;
}

function fixedPointResolvesToEndpoint(
  fixedPoint: [number, number],
  point: { x: number; y: number },
  shape: ExcalidrawElement,
): boolean {
  const bounds = elementBounds(shape);

  if (!bounds) {
    return false;
  }

  const fixedX =
    Math.abs(fixedPoint[0] - 0.5001) < 0.0001 ? 0.5 : fixedPoint[0];
  const fixedY =
    Math.abs(fixedPoint[1] - 0.5001) < 0.0001 ? 0.5 : fixedPoint[1];

  return (
    near(bounds.x + fixedX * bounds.width, point.x) &&
    near(bounds.y + fixedY * bounds.height, point.y)
  );
}

export function validateExcalidrawScene(
  scene: ExcalidrawScene,
): ExcalidrawSceneValidationResult {
  const issues: ExcalidrawSceneValidationIssue[] = [];
  const elementsById = new Map(
    scene.elements.map((element) => [element.id, element]),
  );
  const shapeIds = new Set(
    scene.elements
      .filter((element) => SHAPE_TYPES.has(element.type))
      .map((element) => element.id),
  );

  if (shapeIds.size === 0) {
    issues.push({
      code: "empty-scene",
      message: "Excalidraw scene must contain at least one shape.",
    });
  }

  for (const element of scene.elements) {
    if (element.type === "arrow") {
      const isElbowed = element.elbowed === true;
      const points = Array.isArray(element.points) ? element.points : [];

      if (points.length > 2 && !isElbowed) {
        issues.push({
          code: "invalid-elbow-binding",
          elementId: element.id,
          message: `Arrow "${element.id}" has an orthogonal route but is not marked elbowed.`,
        });
      }

      if (
        isElbowed &&
        element.fixedSegments !== null &&
        !Array.isArray(element.fixedSegments)
      ) {
        issues.push({
          code: "invalid-elbow-binding",
          elementId: element.id,
          message: `Elbow arrow "${element.id}" is missing fixedSegments metadata.`,
        });
      }

      for (const bindingKey of ["startBinding", "endBinding"] as const) {
        const shapeId = bindingElementId(element, bindingKey);
        if (!(shapeId && shapeIds.has(shapeId))) {
          issues.push({
            code: "missing-arrow-binding",
            elementId: element.id,
            message: `Arrow "${element.id}" has invalid ${bindingKey}.`,
          });
          continue;
        }

        const shape = elementsById.get(shapeId);
        if (shape && !hasBoundElement(shape, element.id, "arrow")) {
          issues.push({
            code: "missing-bound-arrow",
            elementId: shape.id,
            message: `Shape "${shape.id}" does not include bound arrow "${element.id}".`,
          });
        }

        const endpoint = arrowEndpoint(element, bindingKey);
        if (shape && endpoint && !pointOnShapeBoundary(endpoint, shape)) {
          issues.push({
            code: "arrow-endpoint-off-shape",
            elementId: element.id,
            message: `Arrow "${element.id}" ${bindingKey} endpoint does not land on "${shape.id}".`,
          });
        }

        if (shape && endpoint && isElbowed) {
          const fixedPoint = bindingFixedPoint(element, bindingKey);
          if (
            !fixedPoint ||
            !fixedPointResolvesToEndpoint(fixedPoint, endpoint, shape)
          ) {
            issues.push({
              code: "invalid-elbow-binding",
              elementId: element.id,
              message: `Elbow arrow "${element.id}" has invalid ${bindingKey} fixedPoint metadata.`,
            });
          }
        }
      }
    }

    if (element.type === "text") {
      const containerId = element.containerId;
      if (typeof containerId !== "string") {
        continue;
      }

      const container = elementsById.get(containerId);
      if (!container) {
        issues.push({
          code: "missing-container",
          elementId: element.id,
          message: `Text "${element.id}" references missing container "${containerId}".`,
        });
        continue;
      }

      const textWidth = typeof element.width === "number" ? element.width : 0;
      const textHeightValue =
        typeof element.height === "number" ? element.height : 0;
      const containerWidth =
        typeof container.width === "number" ? container.width : 0;
      const containerHeight =
        typeof container.height === "number" ? container.height : 0;

      if (
        SHAPE_TYPES.has(container.type) &&
        (textWidth + TEXT_HORIZONTAL_PADDING > containerWidth ||
          textHeightValue + TEXT_VERTICAL_PADDING > containerHeight)
      ) {
        issues.push({
          code: "text-overflow",
          elementId: element.id,
          message: `Text "${element.id}" does not fit inside "${containerId}".`,
        });
      }
    }
  }

  issues.push(...arrowSegmentsThroughShapes(scene.elements));
  issues.push(...overlappingArrowSegments(scene.elements));

  return {
    ok: issues.length === 0,
    issues,
  };
}
