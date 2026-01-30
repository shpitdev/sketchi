import type { LayoutedDiagram } from "./diagram-layout";

export interface ExcalidrawStyleOverrides {
  shapeFill?: string;
  shapeStroke?: string;
  arrowStroke?: string;
  textColor?: string;
  fontSize?: number;
  fontFamily?: number;
}

function generateSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

interface IndexRef {
  value: number;
}

interface StyleConfig {
  shapeStroke: string;
  shapeFillDefault: string;
  textColor: string;
  fontSize: number;
  fontFamily: number;
  arrowStroke: string;
}

function nextIndex(idx: IndexRef): string {
  const value = idx.value;
  idx.value += 1;
  return `a${value}`;
}

function getStyleConfig(style?: ExcalidrawStyleOverrides): StyleConfig {
  const shapeStroke = style?.shapeStroke ?? "#1971c2";
  return {
    shapeStroke,
    shapeFillDefault: style?.shapeFill ?? "#a5d8ff",
    textColor: style?.textColor ?? "#1e1e1e",
    fontSize: style?.fontSize ?? 16,
    fontFamily: style?.fontFamily ?? 5,
    arrowStroke: style?.arrowStroke ?? shapeStroke,
  };
}

function buildShapeElements(
  shape: LayoutedDiagram["shapes"][number],
  style: StyleConfig,
  idx: IndexRef
): Record<string, unknown>[] {
  const base = {
    id: shape.id,
    type: shape.type,
    x: shape.x,
    y: shape.y,
    width: shape.width,
    height: shape.height,
    angle: 0,
    strokeColor: style.shapeStroke,
    backgroundColor: shape.backgroundColor ?? style.shapeFillDefault,
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    index: nextIndex(idx),
    roundness: { type: 3 },
    seed: generateSeed(),
    version: 1,
    versionNonce: generateSeed(),
    isDeleted: false,
    boundElements: null as { id: string; type: string }[] | null,
    updated: Date.now(),
    link: null,
    locked: false,
  };

  if (!shape.label?.text) {
    return [base];
  }

  base.boundElements = [{ id: `${shape.id}_text`, type: "text" }];

  return [
    base,
    {
      id: `${shape.id}_text`,
      type: "text",
      x: shape.x + 10,
      y: shape.y + shape.height / 2 - 10,
      width: shape.width - 20,
      height: 20,
      angle: 0,
      strokeColor: style.textColor,
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeWidth: 2,
      strokeStyle: "solid",
      roughness: 1,
      opacity: 100,
      groupIds: [],
      frameId: null,
      index: nextIndex(idx),
      roundness: null,
      seed: generateSeed(),
      version: 1,
      versionNonce: generateSeed(),
      isDeleted: false,
      boundElements: null,
      updated: Date.now(),
      link: null,
      locked: false,
      text: shape.label.text,
      fontSize: style.fontSize,
      fontFamily: style.fontFamily,
      textAlign: "center",
      verticalAlign: "middle",
      containerId: shape.id,
      originalText: shape.label.text,
      autoResize: true,
      lineHeight: 1.25,
    },
  ];
}

function buildArrowElements(
  arrow: LayoutedDiagram["arrows"][number],
  style: StyleConfig,
  idx: IndexRef
): Record<string, unknown>[] {
  const textId = `${arrow.id}_label`;
  const hasLabel = arrow.label?.text;

  const arrowElement: Record<string, unknown> = {
    id: arrow.id,
    type: "arrow",
    x: arrow.x,
    y: arrow.y,
    width: arrow.width,
    height: arrow.height,
    angle: 0,
    strokeColor: style.arrowStroke,
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    index: nextIndex(idx),
    roundness: arrow.elbowed ? null : { type: 2 },
    seed: generateSeed(),
    version: 1,
    versionNonce: generateSeed(),
    isDeleted: false,
    boundElements: hasLabel ? [{ type: "text", id: textId }] : null,
    updated: Date.now(),
    link: null,
    locked: false,
    points: arrow.points,
    elbowed: arrow.elbowed,
    startBinding: {
      elementId: arrow.fromId,
      focus: 0,
      gap: 5,
      fixedPoint: null,
    },
    endBinding: {
      elementId: arrow.toId,
      focus: 0,
      gap: 5,
      fixedPoint: null,
    },
    startArrowhead: null,
    endArrowhead: "arrow",
  };

  if (arrow.elbowed) {
    arrowElement.fixedSegments = [];
    arrowElement.startIsSpecial = false;
    arrowElement.endIsSpecial = false;
  }

  if (!hasLabel) {
    return [arrowElement];
  }

  const midX = arrow.x + arrow.width / 2;
  const midY = arrow.y + arrow.height / 2;

  return [
    arrowElement,
    {
      id: textId,
      type: "text",
      x: midX - 30,
      y: midY - 10,
      width: 60,
      height: 20,
      angle: 0,
      strokeColor: style.textColor,
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeWidth: 2,
      strokeStyle: "solid",
      roughness: 1,
      opacity: 100,
      groupIds: [],
      frameId: null,
      index: nextIndex(idx),
      roundness: null,
      seed: generateSeed(),
      version: 1,
      versionNonce: generateSeed(),
      isDeleted: false,
      boundElements: null,
      updated: Date.now(),
      link: null,
      locked: false,
      text: arrow.label?.text ?? "",
      fontSize: style.fontSize,
      fontFamily: style.fontFamily,
      textAlign: "center",
      verticalAlign: "middle",
      containerId: arrow.id,
      originalText: arrow.label?.text ?? "",
      autoResize: true,
      lineHeight: 1.25,
    },
  ];
}

/**
 * Normalizes bidirectional arrow-shape bindings.
 *
 * Excalidraw requires shapes to list arrows in boundElements for drag behavior.
 * This function scans all arrows and adds their IDs to connected shapes.
 */
function normalizeArrowBindings(
  elements: Record<string, unknown>[]
): Record<string, unknown>[] {
  const arrowsByShape = new Map<string, Set<string>>();

  for (const element of elements) {
    if (element.type !== "arrow") continue;

    const startBinding = element.startBinding as { elementId: string } | null;
    const endBinding = element.endBinding as { elementId: string } | null;

    if (startBinding?.elementId) {
      if (!arrowsByShape.has(startBinding.elementId)) {
        arrowsByShape.set(startBinding.elementId, new Set());
      }
      arrowsByShape.get(startBinding.elementId)!.add(element.id as string);
    }

    if (endBinding?.elementId) {
      if (!arrowsByShape.has(endBinding.elementId)) {
        arrowsByShape.set(endBinding.elementId, new Set());
      }
      arrowsByShape.get(endBinding.elementId)!.add(element.id as string);
    }
  }

  for (const element of elements) {
    const isShape = ["rectangle", "ellipse", "diamond"].includes(
      element.type as string
    );
    if (!isShape) continue;

    const arrowIds = arrowsByShape.get(element.id as string);
    if (!arrowIds || arrowIds.size === 0) continue;

    const existingBounds =
      (element.boundElements as Array<{ id: string; type: string }>) ?? [];
    const arrowBindings = Array.from(arrowIds).map((id) => ({
      id,
      type: "arrow",
    }));

    element.boundElements = [...existingBounds, ...arrowBindings];
  }

  return elements;
}

export function convertLayoutedToExcalidraw(
  layouted: LayoutedDiagram,
  style?: ExcalidrawStyleOverrides
): Record<string, unknown>[] {
  const elements: Record<string, unknown>[] = [];
  const idx: IndexRef = { value: 0 };
  const resolvedStyle = getStyleConfig(style);

  for (const shape of layouted.shapes) {
    elements.push(...buildShapeElements(shape, resolvedStyle, idx));
  }

  for (const arrow of layouted.arrows) {
    elements.push(...buildArrowElements(arrow, resolvedStyle, idx));
  }

  return normalizeArrowBindings(elements);
}
