/**
 * Canonical, renderer-independent scene IR used by every Sketchi diagram.
 *
 * The public contract deliberately describes drawing intent rather than raw
 * Excalidraw elements. Adapters may compile this representation to Excalidraw,
 * PNG, or another render target without changing the authored scene.
 */

export const CANVAS_SPEC_VERSION: 1 = 1;

export const CANVAS_LIMITS = Object.freeze({
  maxDimension: 16_384,
  maxElements: 600,
  maxGroupsPerElement: 16,
  maxLayouts: 128,
  maxLayers: 64,
  maxPointsPerElement: 256,
  maxSerializedBytes: 1_500_000,
  maxTextLength: 4_096,
  maxZOrderEntries: 600,
});

export type CanvasStrokeStyle = "dashed" | "dotted" | "solid";
export type CanvasFillStyle = "cross-hatch" | "hachure" | "solid";
export type CanvasArrowhead =
  | "arrow"
  | "bar"
  | "circle"
  | "diamond"
  | "triangle"
  | null;
export type CanvasShapeKind =
  | "rectangle"
  | "ellipse"
  | "diamond"
  | "circle"
  | "polygon";

export interface CanvasPoint {
  readonly x: number;
  readonly y: number;
}

export interface CanvasElementComposition {
  readonly frameId?: string | undefined;
  readonly groupIds?: string[] | undefined;
  readonly layerId?: string | undefined;
  readonly locked?: boolean | undefined;
  readonly opacity?: number | undefined;
  readonly zIndex?: number | undefined;
}

export interface CanvasStrokeStyleFields {
  readonly fillColor?: string | undefined;
  readonly fillStyle?: CanvasFillStyle | undefined;
  readonly roughness?: 0 | 1 | 2 | undefined;
  readonly strokeColor?: string | undefined;
  readonly strokeStyle?: CanvasStrokeStyle | undefined;
  readonly strokeWidth?: 1 | 2 | 4 | undefined;
}

export interface CanvasShapeElement
  extends CanvasElementComposition,
    CanvasStrokeStyleFields {
  readonly type: "node";
  readonly id: string;
  readonly nodeId: string;
  readonly kind?: string | undefined;
  readonly rendererRole?: "sequence-lifeline" | undefined;
  readonly shape: CanvasShapeKind;
  readonly points?:
    | [CanvasPoint, CanvasPoint, CanvasPoint, ...CanvasPoint[]]
    | undefined;
  readonly textColor?: string | undefined;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly label: string;
}

export interface CanvasTextElement extends CanvasElementComposition {
  readonly type: "text";
  readonly id: string;
  readonly containerId?: string | undefined;
  readonly textColor?: string | undefined;
  readonly x: number;
  readonly y: number;
  readonly text: string;
  readonly fontSize: number;
  readonly fontFamily?: "hand" | "mono" | "sans" | undefined;
  readonly maxWidth?: number | undefined;
  readonly textAlign?: "center" | "left" | "right" | undefined;
  readonly verticalAlign?: "bottom" | "middle" | "top" | undefined;
}

export interface CanvasConnectorElement
  extends CanvasElementComposition,
    CanvasStrokeStyleFields {
  readonly type: "arrow";
  readonly id: string;
  readonly edgeId: string;
  readonly sourceNodeId: string;
  readonly targetNodeId: string;
  readonly startArrowhead?: CanvasArrowhead | undefined;
  readonly endArrowhead?: CanvasArrowhead | undefined;
  readonly textColor?: string | undefined;
  readonly points: [CanvasPoint, ...CanvasPoint[]];
  readonly label?: string | undefined;
}

export interface CanvasLineBinding {
  readonly elementId: string;
  readonly focus?: number | undefined;
  readonly gap?: number | undefined;
}

export interface CanvasLineElement
  extends CanvasElementComposition,
    CanvasStrokeStyleFields {
  readonly type: "line";
  readonly id: string;
  readonly points: [CanvasPoint, CanvasPoint, ...CanvasPoint[]];
  readonly startBinding?: CanvasLineBinding | undefined;
  readonly endBinding?: CanvasLineBinding | undefined;
  readonly startArrowhead?: CanvasArrowhead | undefined;
  readonly endArrowhead?: CanvasArrowhead | undefined;
  readonly label?: string | undefined;
  readonly textColor?: string | undefined;
}

export interface CanvasFrameElement
  extends CanvasElementComposition,
    CanvasStrokeStyleFields {
  readonly type: "frame";
  readonly id: string;
  readonly name?: string | undefined;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type CanvasElement =
  | CanvasShapeElement
  | CanvasTextElement
  | CanvasConnectorElement
  | CanvasLineElement
  | CanvasFrameElement;

export interface CanvasLayer {
  readonly id: string;
  readonly name?: string | undefined;
  readonly locked?: boolean | undefined;
  readonly visible?: boolean | undefined;
}

interface CanvasLayoutBase {
  readonly ids: string[];
}

export interface CanvasFlowLayout extends CanvasLayoutBase {
  readonly type: "row" | "column" | "stack";
  readonly x?: number | undefined;
  readonly y?: number | undefined;
  readonly gap?: number | undefined;
}

export interface CanvasGridLayout extends CanvasLayoutBase {
  readonly type: "grid";
  readonly columns: number;
  readonly x?: number | undefined;
  readonly y?: number | undefined;
  readonly columnGap?: number | undefined;
  readonly rowGap?: number | undefined;
}

export interface CanvasAlignLayout extends CanvasLayoutBase {
  readonly type: "align";
  readonly axis: "x" | "y";
  readonly alignment: "center" | "end" | "start";
}

export interface CanvasDistributeLayout extends CanvasLayoutBase {
  readonly type: "distribute";
  readonly axis: "x" | "y";
  readonly gap?: number | undefined;
}

export type CanvasLayout =
  | CanvasFlowLayout
  | CanvasGridLayout
  | CanvasAlignLayout
  | CanvasDistributeLayout;

export interface CanvasSpec {
  readonly kind: "canvas";
  readonly version: typeof CANVAS_SPEC_VERSION;
  readonly diagramId: string;
  readonly title: string;
  readonly width: number;
  readonly height: number;
  readonly accentColor: string;
  readonly backgroundColor: string;
  readonly elements: CanvasElement[];
  readonly layers: CanvasLayer[];
  readonly layouts: CanvasLayout[];
  readonly zOrder: string[];
}

export interface CanvasValidationIssue {
  readonly code:
    | "duplicate_element_id"
    | "duplicate_layer_id"
    | "empty_canvas"
    | "invalid_binding"
    | "invalid_composition"
    | "invalid_geometry"
    | "invalid_polygon"
    | "limit_exceeded"
    | "missing_z_order_element"
    | "unknown_layout_target"
    | "unknown_z_order_element";
  readonly elementId?: string | undefined;
  readonly message: string;
  readonly path: string;
}

type PositionedCanvasElement = Extract<
  CanvasElement,
  { readonly x: number; readonly y: number }
>;

interface CanvasElementBounds {
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
}

function findDuplicate(values: readonly string[]): string | undefined {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) return value;
    seen.add(value);
  }
  return undefined;
}

function isPositioned(
  element: CanvasElement,
): element is PositionedCanvasElement {
  return "x" in element && "y" in element;
}

function hasPositiveBounds(element: CanvasElement): boolean {
  return !(
    "width" in element &&
    "height" in element &&
    (!(element.width > 0) || !(element.height > 0))
  );
}

function validateElementLimits(
  element: CanvasElement,
  index: number,
): CanvasValidationIssue[] {
  const issues: CanvasValidationIssue[] = [];
  const path = `elements[${index}]`;
  if (!hasPositiveBounds(element)) {
    issues.push({
      code: "invalid_geometry",
      elementId: element.id,
      message: `Element "${element.id}" must have positive width and height.`,
      path,
    });
  }
  if (
    "points" in element &&
    element.points !== undefined &&
    element.points.length > CANVAS_LIMITS.maxPointsPerElement
  ) {
    issues.push({
      code: "limit_exceeded",
      elementId: element.id,
      message: `Element "${element.id}" exceeds ${CANVAS_LIMITS.maxPointsPerElement} points.`,
      path: `${path}.points`,
    });
  }
  if ("text" in element && element.text.length > CANVAS_LIMITS.maxTextLength) {
    issues.push({
      code: "limit_exceeded",
      elementId: element.id,
      message: `Text element "${element.id}" exceeds ${CANVAS_LIMITS.maxTextLength} characters.`,
      path: `${path}.text`,
    });
  }
  if (
    element.type === "node" &&
    element.shape === "polygon" &&
    (!element.points || element.points.length < 3)
  ) {
    issues.push({
      code: "invalid_polygon",
      elementId: element.id,
      message: `Polygon "${element.id}" requires at least three points.`,
      path: `${path}.points`,
    });
  }
  if (
    element.groupIds &&
    element.groupIds.length > CANVAS_LIMITS.maxGroupsPerElement
  ) {
    issues.push({
      code: "limit_exceeded",
      elementId: element.id,
      message: `Element "${element.id}" exceeds ${CANVAS_LIMITS.maxGroupsPerElement} groups.`,
      path: `${path}.groupIds`,
    });
  }
  return issues;
}

/** Validate only hard safety and structural invariants; overlap is intentional. */
export function getCanvasValidationIssues(
  canvas: CanvasSpec,
): CanvasValidationIssue[] {
  const issues: CanvasValidationIssue[] = [];
  if (canvas.elements.length === 0) {
    issues.push({
      code: "empty_canvas",
      message: "CanvasSpec must contain at least one element.",
      path: "elements",
    });
  }
  if (canvas.elements.length > CANVAS_LIMITS.maxElements) {
    issues.push({
      code: "limit_exceeded",
      message: `Canvas exceeds ${CANVAS_LIMITS.maxElements} elements.`,
      path: "elements",
    });
  }
  if (canvas.layers.length > CANVAS_LIMITS.maxLayers) {
    issues.push({
      code: "limit_exceeded",
      message: `Canvas exceeds ${CANVAS_LIMITS.maxLayers} layers.`,
      path: "layers",
    });
  }
  if (canvas.layouts.length > CANVAS_LIMITS.maxLayouts) {
    issues.push({
      code: "limit_exceeded",
      message: `Canvas exceeds ${CANVAS_LIMITS.maxLayouts} layout primitives.`,
      path: "layouts",
    });
  }
  if (
    canvas.width > CANVAS_LIMITS.maxDimension ||
    canvas.height > CANVAS_LIMITS.maxDimension
  ) {
    issues.push({
      code: "limit_exceeded",
      message: `Canvas dimensions may not exceed ${CANVAS_LIMITS.maxDimension}.`,
      path: "width",
    });
  }

  const duplicateElementId = findDuplicate(
    canvas.elements.map((element) => element.id),
  );
  if (duplicateElementId) {
    issues.push({
      code: "duplicate_element_id",
      elementId: duplicateElementId,
      message: `Duplicate element id "${duplicateElementId}" is not allowed.`,
      path: "elements",
    });
  }
  const duplicateLayerId = findDuplicate(
    canvas.layers.map((layer) => layer.id),
  );
  if (duplicateLayerId) {
    issues.push({
      code: "duplicate_layer_id",
      message: `Duplicate layer id "${duplicateLayerId}" is not allowed.`,
      path: "layers",
    });
  }
  const duplicateZOrderId = findDuplicate(canvas.zOrder);
  if (duplicateZOrderId) {
    issues.push({
      code: "unknown_z_order_element",
      elementId: duplicateZOrderId,
      message: `zOrder contains duplicate element "${duplicateZOrderId}".`,
      path: "zOrder",
    });
  }
  if (canvas.zOrder.length > CANVAS_LIMITS.maxZOrderEntries) {
    issues.push({
      code: "limit_exceeded",
      message: `zOrder exceeds ${CANVAS_LIMITS.maxZOrderEntries} entries.`,
      path: "zOrder",
    });
  }

  const elementsById = new Map(
    canvas.elements.map((element) => [element.id, element]),
  );
  const shapes = canvas.elements.filter(
    (element): element is CanvasShapeElement => element.type === "node",
  );
  const shapesByNodeId = new Map(
    shapes.map((element) => [element.nodeId, element]),
  );
  const duplicateNodeId = findDuplicate(
    shapes.map((element) => element.nodeId),
  );
  if (duplicateNodeId) {
    issues.push({
      code: "invalid_binding",
      message: `Duplicate nodeId "${duplicateNodeId}" makes connector bindings ambiguous.`,
      path: "elements",
    });
  }
  const duplicateEdgeId = findDuplicate(
    canvas.elements.flatMap((element) =>
      element.type === "arrow" ? [element.edgeId] : [],
    ),
  );
  if (duplicateEdgeId) {
    issues.push({
      code: "invalid_binding",
      message: `Duplicate edgeId "${duplicateEdgeId}" makes connector selection ambiguous.`,
      path: "elements",
    });
  }
  const duplicateTextContainer = findDuplicate(
    canvas.elements.flatMap((element) =>
      element.type === "text" && element.containerId
        ? [element.containerId]
        : [],
    ),
  );
  if (duplicateTextContainer) {
    issues.push({
      code: "invalid_binding",
      elementId: duplicateTextContainer,
      message: `Container "${duplicateTextContainer}" has more than one bound text element.`,
      path: "elements",
    });
  }
  const layerIds = new Set(canvas.layers.map((layer) => layer.id));
  canvas.elements.forEach((element, index) => {
    issues.push(...validateElementLimits(element, index));
    if (element.frameId) {
      const frame = elementsById.get(element.frameId);
      if (!frame || frame.type !== "frame") {
        issues.push({
          code: "invalid_composition",
          elementId: element.id,
          message: `Element "${element.id}" references missing frame "${element.frameId}".`,
          path: `elements[${index}].frameId`,
        });
      }
    }
    if (element.layerId && !layerIds.has(element.layerId)) {
      issues.push({
        code: "invalid_composition",
        elementId: element.id,
        message: `Element "${element.id}" references missing layer "${element.layerId}".`,
        path: `elements[${index}].layerId`,
      });
    }
    if (element.groupIds && findDuplicate(element.groupIds)) {
      issues.push({
        code: "invalid_composition",
        elementId: element.id,
        message: `Element "${element.id}" contains duplicate group ids.`,
        path: `elements[${index}].groupIds`,
      });
    }
    if (element.type === "text" && element.containerId) {
      const container = elementsById.get(element.containerId);
      if (
        !container ||
        (container.type !== "node" && container.type !== "arrow")
      ) {
        issues.push({
          code: "invalid_binding",
          elementId: element.id,
          message: `Text "${element.id}" references unsupported container "${element.containerId}".`,
          path: `elements[${index}].containerId`,
        });
      }
    }
    if (element.type === "arrow") {
      if (!shapesByNodeId.has(element.sourceNodeId)) {
        issues.push({
          code: "invalid_binding",
          elementId: element.id,
          message: `Connector "${element.id}" references missing source "${element.sourceNodeId}".`,
          path: `elements[${index}].sourceNodeId`,
        });
      }
      if (!shapesByNodeId.has(element.targetNodeId)) {
        issues.push({
          code: "invalid_binding",
          elementId: element.id,
          message: `Connector "${element.id}" references missing target "${element.targetNodeId}".`,
          path: `elements[${index}].targetNodeId`,
        });
      }
    }
    if (element.type === "line") {
      const bindings: Array<
        readonly ["startBinding" | "endBinding", CanvasLineBinding | undefined]
      > = [
        ["startBinding", element.startBinding],
        ["endBinding", element.endBinding],
      ];
      for (const [bindingName, binding] of bindings) {
        const target = binding
          ? elementsById.get(binding.elementId)
          : undefined;
        if (
          binding &&
          (!target || (target.type !== "node" && target.type !== "frame"))
        ) {
          issues.push({
            code: "invalid_binding",
            elementId: element.id,
            message: `Line "${element.id}" references missing binding "${binding.elementId}".`,
            path: `elements[${index}].${bindingName}`,
          });
        }
      }
    }
  });

  const zOrderIds = new Set(canvas.zOrder);
  for (const element of canvas.elements) {
    if (!zOrderIds.has(element.id)) {
      issues.push({
        code: "missing_z_order_element",
        elementId: element.id,
        message: `Element "${element.id}" is missing from zOrder.`,
        path: "zOrder",
      });
    }
  }
  for (const id of canvas.zOrder) {
    if (!elementsById.has(id)) {
      issues.push({
        code: "unknown_z_order_element",
        elementId: id,
        message: `zOrder references missing element "${id}".`,
        path: "zOrder",
      });
    }
  }
  for (const [index, layout] of canvas.layouts.entries()) {
    for (const id of layout.ids) {
      const element = elementsById.get(id);
      if (!element || !isPositioned(element)) {
        issues.push({
          code: "unknown_layout_target",
          elementId: id,
          message: `Layout references missing or non-positioned element "${id}".`,
          path: `layouts[${index}].ids`,
        });
      }
    }
  }
  for (const frame of canvas.elements.filter(
    (element): element is CanvasFrameElement => element.type === "frame",
  )) {
    const visited = new Set([frame.id]);
    let parentId = frame.frameId;
    while (parentId) {
      if (visited.has(parentId)) {
        issues.push({
          code: "invalid_composition",
          elementId: frame.id,
          message: `Frame "${frame.id}" participates in a frame nesting cycle.`,
          path: "elements",
        });
        break;
      }
      visited.add(parentId);
      const parent = elementsById.get(parentId);
      parentId = parent?.type === "frame" ? parent.frameId : undefined;
    }
  }
  return issues;
}

function elementBounds(element: PositionedCanvasElement): CanvasElementBounds {
  if (element.type === "text") {
    const lines = element.text.split("\n");
    return {
      x: element.x,
      y: element.y,
      width:
        element.maxWidth ??
        Math.max(...lines.map((line) => line.length)) * element.fontSize * 0.62,
      height: lines.length * element.fontSize * 1.35,
    };
  }
  return {
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height,
  };
}

function repositionElement(
  element: CanvasElement,
  x: number,
  y: number,
): CanvasElement {
  if (!isPositioned(element)) return element;
  return { ...element, x, y };
}

function layoutTargets(
  elements: readonly CanvasElement[],
  ids: readonly string[],
): PositionedCanvasElement[] {
  const byId = new Map(elements.map((element) => [element.id, element]));
  return ids.flatMap((id) => {
    const element = byId.get(id);
    return element && isPositioned(element) ? [element] : [];
  });
}

function replacePositions(
  elements: readonly CanvasElement[],
  positions: ReadonlyMap<string, CanvasPoint>,
): CanvasElement[] {
  return elements.map((element) => {
    const position = positions.get(element.id);
    return position
      ? repositionElement(element, position.x, position.y)
      : element;
  });
}

function compileFlowLayout(
  elements: readonly CanvasElement[],
  layout: CanvasFlowLayout,
): CanvasElement[] {
  const targets = layoutTargets(elements, layout.ids);
  const firstTarget = targets[0];
  if (!firstTarget) return [...elements];
  const firstBounds = elementBounds(firstTarget);
  const originX = layout.x ?? firstBounds.x;
  const originY = layout.y ?? firstBounds.y;
  const gap = layout.type === "stack" ? (layout.gap ?? 0) : (layout.gap ?? 32);
  const positions = new Map<string, CanvasPoint>();
  let cursor = layout.type === "column" ? originY : originX;
  for (const target of targets) {
    const bounds = elementBounds(target);
    positions.set(target.id, {
      x: layout.type === "column" || layout.type === "stack" ? originX : cursor,
      y: layout.type === "column" ? cursor : originY,
    });
    if (layout.type !== "stack") {
      cursor += (layout.type === "column" ? bounds.height : bounds.width) + gap;
    }
  }
  return replacePositions(elements, positions);
}

function compileGridLayout(
  elements: readonly CanvasElement[],
  layout: CanvasGridLayout,
): CanvasElement[] {
  const targets = layoutTargets(elements, layout.ids);
  if (targets.length === 0) return [...elements];
  const columns = Math.max(1, Math.floor(layout.columns));
  const bounds = targets.map(elementBounds);
  const columnWidths = Array.from({ length: columns }, (_, column) =>
    Math.max(
      0,
      ...bounds
        .filter((_, index) => index % columns === column)
        .map((entry) => entry.width),
    ),
  );
  const rows = Math.ceil(targets.length / columns);
  const rowHeights = Array.from({ length: rows }, (_, row) =>
    Math.max(
      0,
      ...bounds
        .filter((_, index) => Math.floor(index / columns) === row)
        .map((entry) => entry.height),
    ),
  );
  const firstBounds = bounds[0];
  if (!firstBounds) return [...elements];
  const originX = layout.x ?? firstBounds.x;
  const originY = layout.y ?? firstBounds.y;
  const columnGap = layout.columnGap ?? 32;
  const rowGap = layout.rowGap ?? 32;
  const positions = new Map<string, CanvasPoint>();
  targets.forEach((target, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    positions.set(target.id, {
      x:
        originX +
        columnWidths.slice(0, column).reduce((sum, width) => sum + width, 0) +
        columnGap * column,
      y:
        originY +
        rowHeights.slice(0, row).reduce((sum, height) => sum + height, 0) +
        rowGap * row,
    });
  });
  return replacePositions(elements, positions);
}

function axisStart(bounds: CanvasElementBounds, axis: "x" | "y"): number {
  return axis === "x" ? bounds.x : bounds.y;
}

function axisSize(bounds: CanvasElementBounds, axis: "x" | "y"): number {
  return axis === "x" ? bounds.width : bounds.height;
}

function compileAlignLayout(
  elements: readonly CanvasElement[],
  layout: CanvasAlignLayout,
): CanvasElement[] {
  const targets = layoutTargets(elements, layout.ids);
  if (targets.length === 0) return [...elements];
  const bounds = targets.map(elementBounds);
  const starts = bounds.map((entry) => axisStart(entry, layout.axis));
  const ends = bounds.map(
    (entry) => axisStart(entry, layout.axis) + axisSize(entry, layout.axis),
  );
  const centers = bounds.map(
    (entry) => axisStart(entry, layout.axis) + axisSize(entry, layout.axis) / 2,
  );
  const anchor =
    layout.alignment === "start"
      ? Math.min(...starts)
      : layout.alignment === "end"
        ? Math.max(...ends)
        : centers.reduce((sum, center) => sum + center, 0) / centers.length;
  const positions = new Map<string, CanvasPoint>();
  targets.forEach((target, index) => {
    const boundsEntry = bounds[index];
    if (!boundsEntry) return;
    const start =
      layout.alignment === "start"
        ? anchor
        : layout.alignment === "end"
          ? anchor - axisSize(boundsEntry, layout.axis)
          : anchor - axisSize(boundsEntry, layout.axis) / 2;
    positions.set(target.id, {
      x: layout.axis === "x" ? start : boundsEntry.x,
      y: layout.axis === "y" ? start : boundsEntry.y,
    });
  });
  return replacePositions(elements, positions);
}

function compileDistributeLayout(
  elements: readonly CanvasElement[],
  layout: CanvasDistributeLayout,
): CanvasElement[] {
  const targets = layoutTargets(elements, layout.ids).sort(
    (left, right) =>
      axisStart(elementBounds(left), layout.axis) -
      axisStart(elementBounds(right), layout.axis),
  );
  if (targets.length < 2) return [...elements];
  const bounds = targets.map(elementBounds);
  const first = bounds[0];
  const last = bounds[bounds.length - 1];
  if (!first || !last) return [...elements];
  const firstStart = axisStart(first, layout.axis);
  const lastEnd = axisStart(last, layout.axis) + axisSize(last, layout.axis);
  const totalSize = bounds.reduce(
    (sum, entry) => sum + axisSize(entry, layout.axis),
    0,
  );
  const gap =
    layout.gap ??
    Math.max(0, (lastEnd - firstStart - totalSize) / (targets.length - 1));
  const positions = new Map<string, CanvasPoint>();
  let cursor = firstStart;
  targets.forEach((target, index) => {
    const boundsEntry = bounds[index];
    if (!boundsEntry) return;
    positions.set(target.id, {
      x: layout.axis === "x" ? cursor : boundsEntry.x,
      y: layout.axis === "y" ? cursor : boundsEntry.y,
    });
    cursor += axisSize(boundsEntry, layout.axis) + gap;
  });
  return replacePositions(elements, positions);
}

function compileLayout(
  elements: readonly CanvasElement[],
  layout: CanvasLayout,
): CanvasElement[] {
  switch (layout.type) {
    case "row":
    case "column":
    case "stack":
      return compileFlowLayout(elements, layout);
    case "grid":
      return compileGridLayout(elements, layout);
    case "align":
      return compileAlignLayout(elements, layout);
    case "distribute":
      return compileDistributeLayout(elements, layout);
  }
}

type BoundableCanvasElement = CanvasShapeElement | CanvasFrameElement;

function elementCenter(element: BoundableCanvasElement): CanvasPoint {
  return {
    x: element.x + element.width / 2,
    y: element.y + element.height / 2,
  };
}

function boundEndpointToward(
  source: BoundableCanvasElement,
  targetCenter: CanvasPoint,
): CanvasPoint {
  const sourceCenter = elementCenter(source);
  const dx = targetCenter.x - sourceCenter.x;
  const dy = targetCenter.y - sourceCenter.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return {
      x: dx >= 0 ? source.x + source.width : source.x,
      y: sourceCenter.y,
    };
  }
  return {
    x: sourceCenter.x,
    y: dy >= 0 ? source.y + source.height : source.y,
  };
}

function synchronizeBindings(
  elements: readonly CanvasElement[],
): CanvasElement[] {
  const shapesByNodeId = new Map(
    elements
      .filter(
        (element): element is CanvasShapeElement => element.type === "node",
      )
      .map((element) => [element.nodeId, element]),
  );
  const boundableElementsById = new Map<string, BoundableCanvasElement>();
  for (const element of elements) {
    if (element.type === "node" || element.type === "frame") {
      boundableElementsById.set(element.id, element);
    }
  }
  const synchronizedConnectors = elements.map((element): CanvasElement => {
    if (element.type === "arrow") {
      const source = shapesByNodeId.get(element.sourceNodeId);
      const target = shapesByNodeId.get(element.targetNodeId);
      if (!source || !target) return element;
      return {
        ...element,
        points: [
          boundEndpointToward(source, elementCenter(target)),
          ...element.points.slice(1, -1),
          boundEndpointToward(target, elementCenter(source)),
        ] as [CanvasPoint, ...CanvasPoint[]],
      };
    }
    if (element.type === "line") {
      const startTarget = element.startBinding
        ? boundableElementsById.get(element.startBinding.elementId)
        : undefined;
      const endTarget = element.endBinding
        ? boundableElementsById.get(element.endBinding.elementId)
        : undefined;
      if (!startTarget && !endTarget) return element;
      const points: [CanvasPoint, CanvasPoint, ...CanvasPoint[]] = [
        element.points[0],
        element.points[1],
        ...element.points.slice(2),
      ];
      if (startTarget) {
        points[0] = boundEndpointToward(
          startTarget,
          endTarget
            ? elementCenter(endTarget)
            : (points[points.length - 1] ?? points[0]),
        );
      }
      if (endTarget) {
        points[points.length - 1] = boundEndpointToward(
          endTarget,
          startTarget ? elementCenter(startTarget) : points[0],
        );
      }
      return { ...element, points };
    }
    return element;
  });
  const elementsById = new Map(
    synchronizedConnectors.map((element) => [element.id, element]),
  );
  return synchronizedConnectors.map((element) => {
    if (element.type !== "text" || !element.containerId) return element;
    const container = elementsById.get(element.containerId);
    if (container?.type === "node") {
      const center = elementCenter(container);
      return { ...element, x: center.x, y: center.y };
    }
    if (container?.type === "arrow") {
      const start = container.points[0];
      const end = container.points[container.points.length - 1] ?? start;
      return {
        ...element,
        x: (start.x + end.x) / 2,
        y: (start.y + end.y) / 2,
      };
    }
    return element;
  });
}

function computedCanvasBounds(elements: readonly CanvasElement[]): {
  readonly height: number;
  readonly width: number;
} {
  const positioned = elements.filter(isPositioned).map(elementBounds);
  const pointElements = elements.filter(
    (element): element is CanvasConnectorElement | CanvasLineElement =>
      element.type === "arrow" || element.type === "line",
  );
  const maxX = Math.max(
    1,
    ...positioned.map((bounds) => bounds.x + bounds.width),
    ...pointElements.flatMap((element) =>
      element.points.map((point) => point.x),
    ),
  );
  const maxY = Math.max(
    1,
    ...positioned.map((bounds) => bounds.y + bounds.height),
    ...pointElements.flatMap((element) =>
      element.points.map((point) => point.y),
    ),
  );
  return { width: maxX + 48, height: maxY + 48 };
}

/** Resolve layout primitives and bindings into a deterministic canonical scene. */
export function compileCanvasSpec(canvas: CanvasSpec): CanvasSpec {
  let elements = [...canvas.elements];
  for (const layout of canvas.layouts) {
    elements = compileLayout(elements, layout);
  }
  elements = synchronizeBindings(elements);
  const bounds = computedCanvasBounds(elements);
  const orderedIds = canvas.zOrder.length
    ? [...canvas.zOrder]
    : elements
        .map((element, index) => ({ element, index }))
        .sort(
          (left, right) =>
            (left.element.zIndex ?? left.index) -
            (right.element.zIndex ?? right.index),
        )
        .map(({ element }) => element.id);
  return {
    ...canvas,
    width: Math.max(canvas.width, bounds.width),
    height: Math.max(canvas.height, bounds.height),
    elements,
    zOrder: orderedIds,
  };
}
