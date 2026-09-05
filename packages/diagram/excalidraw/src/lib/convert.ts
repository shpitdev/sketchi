import {
  SEQUENCE_LIFELINE_ROLE,
  type ArrowSceneElement,
  type FrameSceneElement,
  type LineSceneElement,
  type NodeSceneElement,
  type RenderedDiagramScene,
  type SceneElement,
  type TextSceneElement,
} from "@sketchi/diagram-renderer";
import { SKETCHI_DIAGRAM_PALETTE } from "@sketchi/diagram-core";
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
const DEFAULT_TEXT_COLOR = SKETCHI_DIAGRAM_PALETTE.ink;
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

function elementBase(
  id: string,
  index: string,
  element?: RenderedDiagramScene["elements"][number],
) {
  const seed = stableSeed(id);
  return {
    id,
    angle: 0,
    fillStyle:
      element && "fillStyle" in element
        ? (element.fillStyle ?? "solid")
        : "solid",
    frameId: element?.frameId ?? null,
    groupIds: [...(element?.groupIds ?? [])],
    index,
    isDeleted: false,
    link: null,
    locked: element?.locked ?? false,
    opacity: element?.opacity ?? 100,
    roughness: element && "roughness" in element ? (element.roughness ?? 1) : 1,
    seed,
    strokeStyle:
      element && "strokeStyle" in element
        ? (element.strokeStyle ?? "solid")
        : "solid",
    strokeWidth:
      element && "strokeWidth" in element ? (element.strokeWidth ?? 2) : 2,
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
  containerId?: string;
  element?: TextSceneElement;
  fontSize: number;
  id: string;
  index: string;
  locked?: boolean;
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
    ...elementBase(input.id, input.index, input.element),
    ...(input.locked === undefined ? {} : { locked: input.locked }),
    type: "text",
    x: input.x - width / 2,
    y: input.y - height / 2,
    width,
    height,
    backgroundColor: "transparent",
    boundElements: null,
    containerId: input.containerId ?? null,
    fontFamily:
      input.element?.fontFamily === "mono"
        ? 3
        : input.element?.fontFamily === "sans"
          ? 2
          : 5,
    fontSize: input.fontSize,
    lineHeight: TEXT_LINE_HEIGHT,
    originalText: input.text,
    roundness: null,
    strokeColor: input.textColor ?? DEFAULT_TEXT_COLOR,
    text: input.text,
    textAlign: input.element?.textAlign ?? "center",
    verticalAlign: input.element?.verticalAlign ?? "middle",
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
    ...(input.text && input.shape.shape !== "polygon"
      ? [{ id: input.text.id, type: "text" }]
      : []),
    ...input.arrowIds.map((id) => ({ id, type: "arrow" })),
  ];

  if (input.shape.shape === "polygon") {
    const points = input.shape.points ?? [
      { x: input.shape.width / 2, y: 0 },
      { x: input.shape.width, y: input.shape.height },
      { x: 0, y: input.shape.height },
    ];
    const [first, ...rest] = points;
    return {
      ...elementBase(input.shape.id, input.index, input.shape),
      type: "line",
      x: input.shape.x,
      y: input.shape.y,
      width: input.shape.width,
      height: input.shape.height,
      backgroundColor: input.shape.fillColor ?? "transparent",
      boundElements: input.arrowIds.map((id) => ({ id, type: "arrow" })),
      customData: { sketchiShape: "polygon" },
      endArrowhead: null,
      endBinding: null,
      lastCommittedPoint: null,
      points: [...points, first].map((point) => [point.x, point.y]),
      roundness: null,
      startArrowhead: null,
      startBinding: null,
      strokeColor: input.shape.strokeColor ?? input.scene.accentColor,
    };
  }

  return {
    ...elementBase(input.shape.id, input.index, input.shape),
    type: shapeType,
    x: input.shape.x,
    y: input.shape.y,
    width: input.shape.width,
    height,
    backgroundColor: input.shape.fillColor ?? "transparent",
    boundElements: boundElements.length > 0 ? boundElements : null,
    roundness: shapeType === "rectangle" ? { type: 3 } : null,
    strokeColor: input.shape.strokeColor ?? input.scene.accentColor,
    ...(input.shape.rendererRole === SEQUENCE_LIFELINE_ROLE
      ? { customData: { sketchiRendererRole: SEQUENCE_LIFELINE_ROLE } }
      : {}),
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
  text?: TextSceneElement;
}): ExcalidrawElement {
  const start = input.arrow.points[0];
  const end = lastArrowPoint(input.arrow);
  const elbowed = input.arrow.points.length > 2;

  return {
    ...elementBase(input.arrow.id, input.index, input.arrow),
    type: "arrow",
    x: start.x,
    y: start.y,
    width: end.x - start.x,
    height: end.y - start.y,
    backgroundColor: "transparent",
    boundElements: input.text
      ? [{ id: input.text.id, type: "text" }]
      : input.arrow.label
        ? [{ id: `${input.arrow.id}:label`, type: "text" }]
        : null,
    elbowed,
    endArrowhead:
      input.arrow.endArrowhead === undefined
        ? "arrow"
        : input.arrow.endArrowhead,
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
    startArrowhead: input.arrow.startArrowhead ?? null,
    startBinding: bindingForShape(input.sourceShape, start),
    strokeColor: input.arrow.strokeColor ?? input.scene.accentColor,
    strokeStyle: input.arrow.strokeStyle ?? "solid",
  };
}

function bindingForLine(
  binding: LineSceneElement["startBinding"],
  elementsById: ReadonlyMap<string, ExcalidrawElement>,
  point: { x: number; y: number },
) {
  if (!binding) return null;
  const shape = elementsById.get(binding.elementId);
  if (!shape) return null;
  return {
    elementId: binding.elementId,
    focus: binding.focus ?? 0,
    gap: binding.gap ?? 0,
    fixedPoint: fixedPointForShape(shape, point),
  };
}

function lineElement(input: {
  element: LineSceneElement;
  elementsById: ReadonlyMap<string, ExcalidrawElement>;
  index: string;
  scene: RenderedDiagramScene;
}): ExcalidrawElement {
  const [start, ...rest] = input.element.points;
  const end = rest[rest.length - 1] ?? start;
  const hasArrow =
    input.element.startArrowhead !== undefined ||
    input.element.endArrowhead !== undefined ||
    input.element.startBinding !== undefined ||
    input.element.endBinding !== undefined;
  const elbowed = hasArrow && input.element.points.length > 2;
  return {
    ...elementBase(input.element.id, input.index, input.element),
    type: hasArrow ? "arrow" : "line",
    x: start.x,
    y: start.y,
    width: end.x - start.x,
    height: end.y - start.y,
    backgroundColor: input.element.fillColor ?? "transparent",
    boundElements: null,
    ...(hasArrow ? { elbowed } : {}),
    endArrowhead: input.element.endArrowhead ?? null,
    endBinding: bindingForLine(
      input.element.endBinding,
      input.elementsById,
      end,
    ),
    ...(elbowed
      ? {
          fixedSegments: [],
          startIsSpecial: null,
          endIsSpecial: null,
        }
      : {}),
    points: input.element.points.map((point) => [
      point.x - start.x,
      point.y - start.y,
    ]),
    roundness:
      input.element.points.length > 2 && !elbowed ? { type: 2 } : null,
    startArrowhead: input.element.startArrowhead ?? null,
    startBinding: bindingForLine(
      input.element.startBinding,
      input.elementsById,
      start,
    ),
    strokeColor: input.element.strokeColor ?? input.scene.accentColor,
  };
}

function frameElement(input: {
  element: FrameSceneElement;
  index: string;
  scene: RenderedDiagramScene;
}): ExcalidrawElement {
  return {
    ...elementBase(input.element.id, input.index, input.element),
    type: "frame",
    x: input.element.x,
    y: input.element.y,
    width: input.element.width,
    height: input.element.height,
    backgroundColor: input.element.fillColor ?? "transparent",
    boundElements: null,
    name: input.element.name ?? null,
    roundness: null,
    strokeColor: input.element.strokeColor ?? input.scene.accentColor,
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
    ...(input.arrow.locked === undefined
      ? {}
      : { locked: input.arrow.locked }),
    maxWidth: ARROW_LABEL_WIDTH,
    ...(input.arrow.textColor ? { textColor: input.arrow.textColor } : {}),
    text: input.arrow.label,
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2 - 10,
  });
}

function collectBoundArrowsByElement(
  nodes: readonly NodeSceneElement[],
  arrows: readonly ArrowSceneElement[],
  lines: readonly LineSceneElement[],
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  const elementIdByNodeId = new Map(
    nodes.map((node) => [node.nodeId, node.id]),
  );

  for (const arrow of arrows) {
    for (const nodeId of [arrow.sourceNodeId, arrow.targetNodeId]) {
      const shapeId = elementIdByNodeId.get(nodeId);
      if (!shapeId) continue;
      result.set(shapeId, [...(result.get(shapeId) ?? []), arrow.id]);
    }
  }
  for (const line of lines) {
    for (const binding of [line.startBinding, line.endBinding]) {
      if (!binding) continue;
      result.set(binding.elementId, [
        ...(result.get(binding.elementId) ?? []),
        line.id,
      ]);
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

function isLine(
  element: RenderedDiagramScene["elements"][number],
): element is LineSceneElement {
  return element.type === "line";
}

function isFrame(
  element: RenderedDiagramScene["elements"][number],
): element is FrameSceneElement {
  return element.type === "frame";
}

function applyLayerSemantics(scene: RenderedDiagramScene): SceneElement[] {
  const layersById = new Map(scene.layers.map((layer) => [layer.id, layer]));
  const layerVisibleElements = scene.elements.filter((element) => {
    const layer = element.layerId ? layersById.get(element.layerId) : undefined;
    return layer?.visible !== false;
  });
  const visibleNodeIds = new Set(
    layerVisibleElements.flatMap((element) =>
      element.type === "node" ? [element.nodeId] : [],
    ),
  );
  const connectionSafeElements = layerVisibleElements.filter(
    (element) =>
      element.type !== "arrow" ||
      (visibleNodeIds.has(element.sourceNodeId) &&
        visibleNodeIds.has(element.targetNodeId)),
  );
  const visibleContainerIds = new Set(
    connectionSafeElements.flatMap((element) =>
      element.type === "text" ? [] : [element.id],
    ),
  );
  const visibleElements = connectionSafeElements.filter(
    (element) =>
      element.type !== "text" ||
      !element.containerId ||
      visibleContainerIds.has(element.containerId),
  );
  const visibleElementIds = new Set(
    visibleElements.map((element) => element.id),
  );

  return visibleElements.map((element) => {
    const layer = element.layerId ? layersById.get(element.layerId) : undefined;
    return {
      ...element,
      ...(element.frameId && !visibleElementIds.has(element.frameId)
        ? { frameId: undefined }
        : {}),
      ...(layer?.locked === true ? { locked: true } : {}),
    };
  });
}

export function convertSceneToExcalidraw(
  scene: RenderedDiagramScene,
): ExcalidrawScene {
  const sourceElements = applyLayerSemantics(scene);
  const nodes = sourceElements.filter(isNode);
  const textElements = sourceElements.filter(isText);
  const usedElementIds = new Set(sourceElements.map((element) => element.id));
  const generatedLabelSourceIds = new Map<string, string>();
  const explicitlyLabeledNodeIds = new Set(
    textElements.flatMap((element) =>
      element.containerId ? [element.containerId] : [],
    ),
  );
  for (const node of nodes) {
    if (
      explicitlyLabeledNodeIds.has(node.id) ||
      node.rendererRole === SEQUENCE_LIFELINE_ROLE
    ) {
      continue;
    }
    const baseId = `__sketchi_node_label__${node.id}`;
    let id = baseId;
    let suffix = 2;
    while (usedElementIds.has(id)) {
      id = `${baseId}:${suffix}`;
      suffix += 1;
    }
    usedElementIds.add(id);
    generatedLabelSourceIds.set(id, node.id);
    textElements.push({
      type: "text",
      id,
      containerId: node.id,
      ...(node.frameId ? { frameId: node.frameId } : {}),
      ...(node.groupIds ? { groupIds: [...node.groupIds] } : {}),
      ...(node.layerId ? { layerId: node.layerId } : {}),
      ...(node.locked !== undefined ? { locked: node.locked } : {}),
      ...(node.opacity !== undefined ? { opacity: node.opacity } : {}),
      ...(node.textColor ? { textColor: node.textColor } : {}),
      x: node.x + node.width / 2,
      y: node.y + node.height / 2,
      text: node.label,
      fontSize: 16,
      maxWidth: Math.max(1, node.width - TEXT_HORIZONTAL_PADDING),
    });
  }
  const textByContainerId = new Map(
    textElements.map((element) => [element.containerId ?? "", element]),
  );
  const arrows = sourceElements.filter(isArrow);
  const lines = sourceElements.filter(isLine);
  const arrowsByElement = collectBoundArrowsByElement(nodes, arrows, lines);
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
      arrowIds: arrowsByElement.get(node.id) ?? [],
      index: nextIndex(),
      ...(text ? { text } : {}),
    });

    shapeElementsByNodeId.set(node.nodeId, shape);
    elements.push(shape);
  }

  for (const frame of sourceElements.filter(isFrame)) {
    const renderedFrame = frameElement({
      element: frame,
      index: nextIndex(),
      scene,
    });
    const arrowIds = arrowsByElement.get(frame.id) ?? [];
    renderedFrame.boundElements = arrowIds.length
      ? arrowIds.map((id) => ({ id, type: "arrow" }))
      : null;
    elements.push(renderedFrame);
  }

  for (const text of textElements) {
    const supportedContainer =
      text.containerId &&
      (nodes.some(
        (node) => node.id === text.containerId && node.shape !== "polygon",
      ) ||
        arrows.some((arrow) => arrow.id === text.containerId));
    elements.push(
      textElement({
        element: text,
        id: text.id,
        index: nextIndex(),
        ...(supportedContainer ? { containerId: text.containerId } : {}),
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
    const text = textByContainerId.get(arrow.id);
    elements.push(
      arrowElement({
        arrow,
        scene,
        index: nextIndex(),
        sourceShape: shapeElementsByNodeId.get(arrow.sourceNodeId),
        targetShape: shapeElementsByNodeId.get(arrow.targetNodeId),
        ...(text ? { text } : {}),
      }),
    );
    const label =
      arrow.label && !text
        ? arrowLabelElement({ arrow, index: nextIndex() })
        : null;
    if (label) {
      elements.push(label);
    }
  }

  const excalidrawElementsById = new Map(
    elements.map((element) => [element.id, element]),
  );
  for (const line of lines) {
    elements.push(
      lineElement({
        element: line,
        elementsById: excalidrawElementsById,
        index: nextIndex(),
        scene,
      }),
    );
    if (line.label) {
      const start = line.points[0];
      const end = line.points[line.points.length - 1] ?? start;
      elements.push(
        textElement({
          id: `${line.id}:label`,
          index: nextIndex(),
          fontSize: 13,
          ...(line.locked === undefined ? {} : { locked: line.locked }),
          maxWidth: ARROW_LABEL_WIDTH,
          ...(line.textColor ? { textColor: line.textColor } : {}),
          text: line.label,
          x: (start.x + end.x) / 2,
          y: (start.y + end.y) / 2 - 10,
        }),
      );
    }
  }

  const zOrder = new Map(scene.zOrder.map((id, index) => [id, index]));
  const sourceIdForElement = (element: ExcalidrawElement): string => {
    if (zOrder.has(element.id)) return element.id;
    const generatedLabelSourceId = generatedLabelSourceIds.get(element.id);
    if (generatedLabelSourceId) return generatedLabelSourceId;
    return element.id.endsWith(":label")
      ? element.id.slice(0, -":label".length)
      : element.id;
  };
  elements.sort((left, right) => {
    const leftOrder =
      zOrder.get(sourceIdForElement(left)) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder =
      zOrder.get(sourceIdForElement(right)) ?? Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder;
  });
  previousIndex = null;
  for (const element of elements) {
    element.index = nextIndex();
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

function isBindableShape(element: ExcalidrawElement): boolean {
  if (SHAPE_TYPES.has(element.type) || element.type === "frame") return true;
  const customData = element.customData;
  return (
    element.type === "line" &&
    customData !== null &&
    typeof customData === "object" &&
    (customData as Record<string, unknown>)["sketchiShape"] === "polygon"
  );
}

function arrowSegmentsThroughShapes(
  elements: readonly ExcalidrawElement[],
): ExcalidrawSceneValidationIssue[] {
  const segments = elements
    .filter((element) => element.type === "arrow")
    .flatMap(arrowSegments);
  const shapes = elements.filter(isBindableShape);
  const issues: ExcalidrawSceneValidationIssue[] = [];
  const seen = new Set<string>();

  for (const segment of segments) {
    for (const shape of shapes) {
      if (
        isSequenceLifelineShape(shape) ||
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

function isSequenceLifelineShape(element: ExcalidrawElement): boolean {
  const customData = element.customData;
  return (
    customData !== null &&
    typeof customData === "object" &&
    (customData as Record<string, unknown>)["sketchiRendererRole"] ===
      SEQUENCE_LIFELINE_ROLE
  );
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
    scene.elements.filter(isBindableShape).map((element) => element.id),
  );

  if (scene.elements.length === 0) {
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
        if (element[bindingKey] === null || element[bindingKey] === undefined) {
          continue;
        }
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
        isBindableShape(container) &&
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
