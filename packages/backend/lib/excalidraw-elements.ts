import type { LayoutedDiagram } from "./diagram-layout";

export interface ExcalidrawStyleOverrides {
  arrowhead?: "arrow" | null;
  arrowStroke?: string;
  fontFamily?: number;
  fontSize?: number;
  shapeFill?: string;
  shapeStroke?: string;
  textColor?: string;
}

function generateSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

interface IndexRef {
  value: number;
}

interface StyleConfig {
  arrowhead: "arrow" | null;
  arrowStroke: string;
  fontFamily: number;
  fontSize: number;
  shapeFillDefault: string;
  shapeStroke: string;
  textColor: string;
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
    arrowhead: style?.arrowhead ?? "arrow",
  };
}

const TEXT_WIDTH_FACTOR = 0.7;
const TEXT_WIDTH_FUDGE = 1.08;
const TEXT_LINE_HEIGHT = 1.25;
const BOUND_TEXT_PADDING = 5;
const ARROW_LABEL_WIDTH_FRACTION = 0.7;
const ARROW_LABEL_FONT_SIZE_TO_MIN_WIDTH_RATIO = 11;

function estimateTextWidth(text: string, fontSize: number): number {
  const lines = text.split("\n");
  let max = 0;
  for (const line of lines) {
    const width = line.length * fontSize * TEXT_WIDTH_FACTOR;
    if (width > max) {
      max = width;
    }
  }
  return Math.ceil(max * TEXT_WIDTH_FUDGE);
}

function splitLongWord(word: string, maxChars: number): string[] {
  if (word.length <= maxChars) {
    return [word];
  }
  const chunks: string[] = [];
  for (let i = 0; i < word.length; i += maxChars) {
    chunks.push(word.slice(i, i + maxChars));
  }
  return chunks;
}

function wrapLine(line: string, maxChars: number): string[] {
  if (line.length === 0) {
    return [""];
  }
  if (line.length <= maxChars) {
    return [line];
  }
  const words = line.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (word.length > maxChars) {
      if (current.length > 0) {
        lines.push(current);
        current = "";
      }
      lines.push(...splitLongWord(word, maxChars));
      continue;
    }
    if (current.length === 0) {
      current = word;
      continue;
    }
    if (current.length + 1 + word.length <= maxChars) {
      current = `${current} ${word}`;
      continue;
    }
    lines.push(current);
    current = word;
  }
  if (current.length > 0) {
    lines.push(current);
  }
  return lines;
}

function wrapTextToWidth(
  text: string,
  fontSize: number,
  maxWidth: number
): { text: string; lineCount: number } {
  const maxChars = Math.max(
    1,
    Math.floor(maxWidth / (fontSize * TEXT_WIDTH_FACTOR))
  );
  const lines = text.split("\n");
  const wrappedLines: string[] = [];
  for (const line of lines) {
    wrappedLines.push(...wrapLine(line, maxChars));
  }
  return { text: wrappedLines.join("\n"), lineCount: wrappedLines.length };
}

function getShapeBoundTextMaxWidth(
  shapeType: string,
  shapeWidth: number
): number {
  if (shapeType === "ellipse") {
    return Math.round((shapeWidth / 2) * Math.sqrt(2)) - BOUND_TEXT_PADDING * 2;
  }
  if (shapeType === "diamond") {
    return Math.round(shapeWidth / 2) - BOUND_TEXT_PADDING * 2;
  }
  return shapeWidth - BOUND_TEXT_PADDING * 2;
}

function getArrowLabelMaxWidth(arrowWidth: number, fontSize: number): number {
  const minWidth = fontSize * ARROW_LABEL_FONT_SIZE_TO_MIN_WIDTH_RATIO;
  return Math.max(ARROW_LABEL_WIDTH_FRACTION * arrowWidth, minWidth);
}

function computeTextMetrics(options: {
  text: string;
  fontSize: number;
  maxWidth?: number;
}): { text: string; width: number; height: number; lineCount: number } {
  const { fontSize } = options;
  const lineHeight = TEXT_LINE_HEIGHT;
  if (typeof options.maxWidth === "number" && options.maxWidth > 0) {
    const wrapped = wrapTextToWidth(options.text, fontSize, options.maxWidth);
    const width = Math.min(
      options.maxWidth,
      Math.max(1, estimateTextWidth(wrapped.text, fontSize))
    );
    const height = Math.ceil(fontSize * lineHeight * wrapped.lineCount);
    return {
      text: wrapped.text,
      width,
      height,
      lineCount: wrapped.lineCount,
    };
  }

  const width = Math.max(1, estimateTextWidth(options.text, fontSize));
  const lineCount = options.text.split("\n").length;
  const height = Math.ceil(fontSize * lineHeight * lineCount);
  return { text: options.text, width, height, lineCount };
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
  const maxTextWidth = Math.max(
    40,
    getShapeBoundTextMaxWidth(shape.type, shape.width) - BOUND_TEXT_PADDING
  );
  const textMetrics = computeTextMetrics({
    text: shape.label.text,
    fontSize: style.fontSize,
    maxWidth: maxTextWidth,
  });
  const textX = shape.x + (shape.width - textMetrics.width) / 2;
  const textY = shape.y + (shape.height - textMetrics.height) / 2;

  return [
    base,
    {
      id: `${shape.id}_text`,
      type: "text",
      x: textX,
      y: textY,
      width: textMetrics.width,
      height: textMetrics.height,
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
      text: textMetrics.text,
      fontSize: style.fontSize,
      fontFamily: style.fontFamily,
      textAlign: "center",
      verticalAlign: "middle",
      containerId: shape.id,
      originalText: shape.label.text,
      autoResize: true,
      lineHeight: TEXT_LINE_HEIGHT,
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
    endArrowhead: style.arrowhead,
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
  const maxLabelWidth = getArrowLabelMaxWidth(arrow.width, style.fontSize);
  const textMetrics = computeTextMetrics({
    text: arrow.label?.text ?? "",
    fontSize: style.fontSize,
    maxWidth: maxLabelWidth,
  });

  return [
    arrowElement,
    {
      id: textId,
      type: "text",
      x: midX - textMetrics.width / 2,
      y: midY - textMetrics.height / 2,
      width: textMetrics.width,
      height: textMetrics.height,
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
      text: textMetrics.text,
      fontSize: style.fontSize,
      fontFamily: style.fontFamily,
      textAlign: "center",
      verticalAlign: "middle",
      containerId: arrow.id,
      originalText: arrow.label?.text ?? "",
      autoResize: true,
      lineHeight: TEXT_LINE_HEIGHT,
    },
  ];
}

function addArrowToShape(
  arrowsByShape: Map<string, Set<string>>,
  shapeId: string,
  arrowId: string
): void {
  if (!arrowsByShape.has(shapeId)) {
    arrowsByShape.set(shapeId, new Set());
  }
  const arrowSet = arrowsByShape.get(shapeId);
  if (arrowSet) {
    arrowSet.add(arrowId);
  }
}

function buildArrowShapeMap(
  elements: Record<string, unknown>[]
): Map<string, Set<string>> {
  const arrowsByShape = new Map<string, Set<string>>();

  for (const element of elements) {
    if (element.type !== "arrow") {
      continue;
    }

    const startBinding = element.startBinding as { elementId: string } | null;
    const endBinding = element.endBinding as { elementId: string } | null;
    const arrowId = element.id as string;

    if (startBinding?.elementId) {
      addArrowToShape(arrowsByShape, startBinding.elementId, arrowId);
    }
    if (endBinding?.elementId) {
      addArrowToShape(arrowsByShape, endBinding.elementId, arrowId);
    }
  }

  return arrowsByShape;
}

const SHAPE_TYPES = ["rectangle", "ellipse", "diamond"];

function normalizeArrowBindings(
  elements: Record<string, unknown>[]
): Record<string, unknown>[] {
  const arrowsByShape = buildArrowShapeMap(elements);

  for (const element of elements) {
    const isShape = SHAPE_TYPES.includes(element.type as string);
    if (!isShape) {
      continue;
    }

    const arrowIds = arrowsByShape.get(element.id as string);
    if (!arrowIds || arrowIds.size === 0) {
      continue;
    }

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
