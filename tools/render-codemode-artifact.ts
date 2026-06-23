import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { spawnSync } from "node:child_process";

type Shape = "rectangle" | "diamond" | "ellipse" | "circle";

type SceneElement =
  | {
      type: "node";
      id: string;
      nodeId: string;
      shape: Shape;
      x: number;
      y: number;
      width: number;
      height: number;
      label: string;
      fillColor?: string;
      strokeColor?: string;
      strokeWidth?: number;
    }
  | {
      type: "text";
      id: string;
      text: string;
      x: number;
      y: number;
      fontSize: number;
      maxWidth?: number;
      containerId?: string;
      nodeId?: string;
    }
  | {
      type: "arrow";
      id: string;
      edgeId: string;
      sourceNodeId: string;
      targetNodeId: string;
      points: Array<{ x: number; y: number }>;
      label?: string;
    };

interface RenderedScene {
  title: string;
  width: number;
  height: number;
  backgroundColor?: string;
  elements: SceneElement[];
}

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const TEXT_CHAR_WIDTH = 8;
const TITLE_CHAR_WIDTH = 10;
const NODE_LINE_HEIGHT = 15;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(Object.entries(value));
}

function numberField(source: Record<string, unknown>, key: string): number {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stringField(
  source: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = source[key];
  return typeof value === "string" ? value : undefined;
}

function shapeField(value: unknown): Shape {
  return value === "diamond" ||
    value === "ellipse" ||
    value === "circle" ||
    value === "rectangle"
    ? value
    : "rectangle";
}

function parsePoint(value: unknown): { x: number; y: number } | null {
  const point = record(value);
  const x = numberField(point, "x");
  const y = numberField(point, "y");
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function parseElement(value: unknown): SceneElement | null {
  const element = record(value);
  const type = stringField(element, "type");
  const id = stringField(element, "id");

  if (!id) {
    return null;
  }

  if (type === "node") {
    const nodeId = stringField(element, "nodeId");
    const label = stringField(element, "label");
    const width = numberField(element, "width");
    const height = numberField(element, "height");

    if (!nodeId || !label || width <= 0 || height <= 0) {
      return null;
    }

    return {
      type: "node",
      id,
      nodeId,
      shape: shapeField(element.shape),
      x: numberField(element, "x"),
      y: numberField(element, "y"),
      width,
      height,
      label,
      ...(stringField(element, "fillColor")
        ? { fillColor: stringField(element, "fillColor") }
        : {}),
      ...(stringField(element, "strokeColor")
        ? { strokeColor: stringField(element, "strokeColor") }
        : {}),
      ...(typeof element.strokeWidth === "number"
        ? { strokeWidth: element.strokeWidth }
        : {}),
    };
  }

  if (type === "text") {
    const text = stringField(element, "text");
    const fontSize = numberField(element, "fontSize");

    if (!text || fontSize <= 0) {
      return null;
    }

    return {
      type: "text",
      id,
      text,
      x: numberField(element, "x"),
      y: numberField(element, "y"),
      fontSize,
      ...(typeof element.maxWidth === "number"
        ? { maxWidth: element.maxWidth }
        : {}),
      ...(stringField(element, "containerId")
        ? { containerId: stringField(element, "containerId") }
        : {}),
      ...(stringField(element, "nodeId")
        ? { nodeId: stringField(element, "nodeId") }
        : {}),
    };
  }

  if (type === "arrow") {
    const edgeId = stringField(element, "edgeId");
    const sourceNodeId = stringField(element, "sourceNodeId");
    const targetNodeId = stringField(element, "targetNodeId");
    const points = Array.isArray(element.points)
      ? element.points.flatMap((point) => {
          const parsed = parsePoint(point);
          return parsed ? [parsed] : [];
        })
      : [];

    if (!edgeId || !sourceNodeId || !targetNodeId || points.length < 2) {
      return null;
    }

    return {
      type: "arrow",
      id,
      edgeId,
      sourceNodeId,
      targetNodeId,
      points,
      ...(stringField(element, "label")
        ? { label: stringField(element, "label") }
        : {}),
    };
  }

  return null;
}

export function sceneFromPayload(input: unknown): RenderedScene {
  const root = record(input);
  const candidate = root.inline ?? input;
  const scene = record(candidate);
  const rawElements = scene.elements;

  if (!Array.isArray(rawElements)) {
    throw new Error("Input must be a Code Mode scene or getArtifact response.");
  }

  const elements = rawElements.flatMap((element) => {
    const parsed = parseElement(element);
    return parsed ? [parsed] : [];
  });

  if (elements.length === 0) {
    throw new Error("Input scene did not contain renderable elements.");
  }

  return {
    title: String(scene.title ?? "Sketchi diagram"),
    width: Number(scene.width ?? 800),
    height: Number(scene.height ?? 600),
    backgroundColor:
      typeof scene.backgroundColor === "string"
        ? scene.backgroundColor
        : undefined,
    elements,
  };
}

function escapeXml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

function mergeBounds(bounds: Bounds, next: Bounds): Bounds {
  return {
    minX: Math.min(bounds.minX, next.minX),
    minY: Math.min(bounds.minY, next.minY),
    maxX: Math.max(bounds.maxX, next.maxX),
    maxY: Math.max(bounds.maxY, next.maxY),
  };
}

function textBounds(input: {
  text: string;
  centerX: number;
  centerY: number;
  maxChars: number;
  charWidth?: number;
  lineHeight?: number;
}): Bounds {
  const lines = wrapLines(input.text, input.maxChars);
  const charWidth = input.charWidth ?? TEXT_CHAR_WIDTH;
  const lineHeight = input.lineHeight ?? NODE_LINE_HEIGHT;
  const maxWidth = Math.max(
    ...lines.map((line) => line.length * charWidth),
    charWidth,
  );
  const totalHeight = Math.max(lines.length, 1) * lineHeight;

  return {
    minX: input.centerX - maxWidth / 2,
    minY: input.centerY - totalHeight / 2,
    maxX: input.centerX + maxWidth / 2,
    maxY: input.centerY + totalHeight / 2,
  };
}

function arrowLabelPosition(arrow: Extract<SceneElement, { type: "arrow" }>) {
  const index = Math.max(0, Math.floor((arrow.points.length - 1) / 2));
  const start = arrow.points[index];
  const end = arrow.points[index + 1] ?? start;

  if (!start || !end) {
    return null;
  }

  return {
    x: (start.x + end.x) / 2 + 8,
    y: (start.y + end.y) / 2 - 8,
  };
}

function elementBounds(scene: RenderedScene) {
  let bounds: Bounds = {
    minX: 0,
    minY: 0,
    maxX: scene.width,
    maxY: scene.height,
  };

  const labels = labelMap(scene.elements);

  for (const element of scene.elements) {
    if (element.type === "node") {
      bounds = mergeBounds(bounds, {
        minX: element.x,
        minY: element.y,
        maxX: element.x + element.width,
        maxY: element.y + element.height,
      });
      bounds = mergeBounds(
        bounds,
        textBounds({
          text:
            labels.get(element.id) ??
            labels.get(element.nodeId) ??
            element.label,
          centerX: element.x + element.width / 2,
          centerY: element.y + element.height / 2,
          maxChars: Math.max(10, Math.floor(element.width / TEXT_CHAR_WIDTH)),
        }),
      );
      continue;
    }

    if (element.type === "text") {
      const width =
        element.maxWidth ??
        Math.max(...wrapLines(element.text, 48).map((line) => line.length)) *
          TEXT_CHAR_WIDTH;
      bounds = mergeBounds(bounds, {
        minX: element.x,
        minY: element.y - element.fontSize,
        maxX: element.x + width,
        maxY: element.y + element.fontSize,
      });
      continue;
    }

    for (const point of element.points) {
      bounds = mergeBounds(bounds, {
        minX: point.x,
        minY: point.y,
        maxX: point.x,
        maxY: point.y,
      });
    }

    if (element.label) {
      const position = arrowLabelPosition(element);
      if (position) {
        const width = Math.max(28, element.label.length * TEXT_CHAR_WIDTH);
        bounds = mergeBounds(bounds, {
          minX: position.x - 4,
          minY: position.y - 14,
          maxX: position.x + width + 4,
          maxY: position.y + 6,
        });
      }
    }
  }

  return bounds;
}

function wrapLines(text: string, maxChars: number): string[] {
  const lines: string[] = [];

  for (const paragraph of text.split(/\n+/)) {
    let current = "";

    for (const word of paragraph.split(/\s+/)) {
      const candidate = current ? `${current} ${word}` : word;
      if (current && candidate.length > maxChars) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }

    if (current) {
      lines.push(current);
    }
  }

  return lines.length > 0 ? lines : [""];
}

function labelSvg(input: {
  text: string;
  x: number;
  y: number;
  maxChars: number;
}): string {
  const lines = wrapLines(input.text, input.maxChars);
  const firstY = input.y - ((lines.length - 1) * NODE_LINE_HEIGHT) / 2;

  return lines
    .map(
      (line, index) =>
        `<text x="${input.x}" y="${firstY + index * NODE_LINE_HEIGHT}" text-anchor="middle" dominant-baseline="middle" font-family="Inter, Arial, sans-serif" font-size="14" font-weight="600" fill="#111827">${escapeXml(line)}</text>`,
    )
    .join("");
}

function labelMap(elements: readonly SceneElement[]): Map<string, string> {
  return new Map(
    elements
      .filter((element): element is Extract<SceneElement, { type: "text" }> =>
        Boolean(element.type === "text" && element.containerId),
      )
      .map((element) => [element.containerId ?? "", element.text]),
  );
}

function renderNode(
  node: Extract<SceneElement, { type: "node" }>,
  labels: Map<string, string>,
  shift: { x: number; y: number },
): string {
  const x = node.x + shift.x;
  const y = node.y + shift.y;
  const width = node.width;
  const height = node.height;
  const label = labels.get(node.id) ?? labels.get(node.nodeId) ?? node.label;
  const text = labelSvg({
    text: label,
    x: x + width / 2,
    y: y + height / 2,
    maxChars: Math.max(10, Math.floor(width / TEXT_CHAR_WIDTH)),
  });
  const fill = node.fillColor ?? "#ffffff";
  const stroke = node.strokeColor ?? "#111827";
  const strokeWidth = node.strokeWidth ?? 2;

  if (node.shape === "diamond") {
    const points = [
      [x + width / 2, y],
      [x + width, y + height / 2],
      [x + width / 2, y + height],
      [x, y + height / 2],
    ]
      .map((point) => point.join(","))
      .join(" ");

    return `<polygon points="${points}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>${text}`;
  }

  if (node.shape === "ellipse" || node.shape === "circle") {
    return `<ellipse cx="${x + width / 2}" cy="${y + height / 2}" rx="${width / 2}" ry="${height / 2}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>${text}`;
  }

  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="8" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>${text}`;
}

function renderArrow(
  arrow: Extract<SceneElement, { type: "arrow" }>,
  shift: { x: number; y: number },
): string {
  const points = arrow.points.map((point) => [
    point.x + shift.x,
    point.y + shift.y,
  ]);
  const path = points
    .map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x} ${y}`)
    .join(" ");
  const label = arrow.label
    ? renderArrowLabel({ label: arrow.label, points })
    : "";

  return `<path d="${path}" fill="none" stroke="#374151" stroke-width="2" marker-end="url(#arrowhead)"/>${label}`;
}

function renderArrowLabel(input: {
  label: string;
  points: number[][];
}): string {
  const index = Math.max(0, Math.floor((input.points.length - 1) / 2));
  const start = input.points[index];
  const end = input.points[index + 1] ?? start;

  if (!start || !end) {
    return "";
  }

  const x = (start[0] + end[0]) / 2 + 8;
  const y = (start[1] + end[1]) / 2 - 8;
  const width = Math.max(28, input.label.length * TEXT_CHAR_WIDTH);
  return `<rect x="${x - 4}" y="${y - 13}" width="${width}" height="18" rx="4" fill="#ffffff"/><text x="${x}" y="${y}" font-family="Inter, Arial, sans-serif" font-size="12" font-weight="700" fill="#374151">${escapeXml(input.label)}</text>`;
}

export function renderSceneSvg(scene: RenderedScene): string {
  const bounds = elementBounds(scene);
  const margin = 56;
  const titleHeight = 34;
  const titleWidth = scene.title.length * TITLE_CHAR_WIDTH;
  const shift = {
    x: margin - bounds.minX,
    y: margin + titleHeight - bounds.minY,
  };
  const width = Math.ceil(
    Math.max(bounds.maxX - bounds.minX, titleWidth) + margin * 2,
  );
  const height = Math.ceil(
    bounds.maxY - bounds.minY + margin * 2 + titleHeight,
  );
  const labels = labelMap(scene.elements);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(scene.title)}">
  <defs>
    <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto"><polygon points="0 0, 10 3.5, 0 7" fill="#374151"/></marker>
  </defs>
  <rect width="100%" height="100%" fill="${escapeXml(scene.backgroundColor ?? "#ffffff")}"/>
  <text x="${margin}" y="30" font-family="Inter, Arial, sans-serif" font-size="18" font-weight="800" fill="#111827">${escapeXml(scene.title)}</text>
  <g>${scene.elements
    .filter((element) => element.type === "arrow")
    .map((element) => renderArrow(element, shift))
    .join("\n")}</g>
  <g>${scene.elements
    .filter((element) => element.type === "node")
    .map((element) => renderNode(element, labels, shift))
    .join("\n")}</g>
</svg>
`;
}

function defaultOutputPath(inputPath: string): string {
  const extension = extname(inputPath);
  const stem = basename(inputPath, extension);
  return join(dirname(inputPath), `${stem}.svg`);
}

function pngPathForSvg(svgPath: string): string {
  return svgPath.replace(/\.svg$/i, ".png");
}

function canRenderPng(): boolean {
  const found = spawnSync("bash", ["-lc", "command -v rsvg-convert"], {
    encoding: "utf8",
  });
  return found.status === 0 && found.stdout.trim().length > 0;
}

function renderPng(svgPath: string, pngPath: string): void {
  const result = spawnSync("rsvg-convert", [svgPath, "-o", pngPath], {
    encoding: "utf8",
  });

  if (result.status !== 0 || !existsSync(pngPath)) {
    throw new Error(
      `rsvg-convert failed: ${result.stderr || result.stdout || "no output"}`,
    );
  }
}

function runCli(args: string[]): void {
  const inputPath = args[0];

  if (!inputPath) {
    throw new Error(
      "Usage: pnpm proof:codemode-render <scene-json> [out.svg|out.png]",
    );
  }

  const requestedOutputPath = args[1] ?? defaultOutputPath(inputPath);
  const outputIsPng = extname(requestedOutputPath).toLowerCase() === ".png";
  const svgPath = outputIsPng
    ? requestedOutputPath.replace(/\.png$/i, ".svg")
    : requestedOutputPath;
  const input: unknown = JSON.parse(readFileSync(inputPath, "utf8"));
  const scene = sceneFromPayload(input);
  writeFileSync(svgPath, renderSceneSvg(scene));

  const outputPaths = [svgPath];
  const pngPath = outputIsPng ? requestedOutputPath : pngPathForSvg(svgPath);
  if (outputIsPng || canRenderPng()) {
    renderPng(svgPath, pngPath);
    outputPaths.push(pngPath);
  }

  console.log(outputPaths.join("\n"));
}

const scriptArgIndex = process.argv.findIndex((arg) =>
  arg.endsWith("render-codemode-artifact.ts"),
);

if (scriptArgIndex >= 0) {
  runCli(process.argv.slice(scriptArgIndex + 1));
}
