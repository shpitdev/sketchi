import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const EXCALIDRAW_SHARE_URL_PATTERN = /#json=([^,]+),(.+)$/;

const SHAPE_TYPES = new Set([
  "rectangle",
  "diamond",
  "ellipse",
  "roundRectangle",
  "parallelogram",
  "hexagon",
  "octagon",
  "triangle",
  "trapezoid",
]);

export interface ExcalidrawFile {
  appState: Record<string, unknown>;
  elements: Record<string, unknown>[];
}

interface Bounds {
  maxX: number;
  maxY: number;
  minX: number;
  minY: number;
}

export interface ExcalidrawSummary {
  arrowCount: number;
  bounds: Bounds;
  deletedCount: number;
  elementCount: number;
  overlapPairs: number;
  shapeCount: number;
  textCount: number;
  unboundArrowCount: number;
}

export function extractShareLink(url: string): {
  url: string;
  shareId?: string;
  encryptionKey?: string;
} {
  const match = url.match(EXCALIDRAW_SHARE_URL_PATTERN);
  if (!match) {
    return { url };
  }
  return { url, shareId: match[1], encryptionKey: match[2] };
}

export async function readExcalidrawFile(
  path: string,
  baseDir: string
): Promise<ExcalidrawFile> {
  const fullPath = resolve(baseDir, path);
  const raw = await readFile(fullPath, "utf-8");
  const data = JSON.parse(raw) as Partial<ExcalidrawFile>;
  if (!Array.isArray(data.elements)) {
    throw new Error("Invalid excalidraw file: missing elements array");
  }
  return {
    elements: data.elements,
    appState: data.appState ?? {},
  };
}

function getBoundingBox(element: Record<string, unknown>): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} | null {
  const x = typeof element.x === "number" ? element.x : null;
  const y = typeof element.y === "number" ? element.y : null;
  const width = typeof element.width === "number" ? element.width : null;
  const height = typeof element.height === "number" ? element.height : null;
  if (x === null || y === null || width === null || height === null) {
    return null;
  }
  return {
    minX: x,
    minY: y,
    maxX: x + width,
    maxY: y + height,
  };
}

function emptyBounds(): Bounds {
  return {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };
}

function normalizeBounds(bounds: Bounds): Bounds {
  if (Number.isFinite(bounds.minX)) {
    return bounds;
  }
  return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
}

function updateBounds(bounds: Bounds, box: Bounds | null): void {
  if (!box) {
    return;
  }
  bounds.minX = Math.min(bounds.minX, box.minX);
  bounds.minY = Math.min(bounds.minY, box.minY);
  bounds.maxX = Math.max(bounds.maxX, box.maxX);
  bounds.maxY = Math.max(bounds.maxY, box.maxY);
}

function overlaps(
  a: ReturnType<typeof getBoundingBox>,
  b: ReturnType<typeof getBoundingBox>
): boolean {
  if (!(a && b)) {
    return false;
  }
  return !(
    a.maxX <= b.minX ||
    a.minX >= b.maxX ||
    a.maxY <= b.minY ||
    a.minY >= b.maxY
  );
}

function countOverlaps(shapes: Record<string, unknown>[]): number {
  let overlapPairs = 0;
  for (let i = 0; i < shapes.length; i += 1) {
    const a = getBoundingBox(shapes[i] as Record<string, unknown>);
    if (!a) {
      continue;
    }
    for (let j = i + 1; j < shapes.length; j += 1) {
      const b = getBoundingBox(shapes[j] as Record<string, unknown>);
      if (overlaps(a, b)) {
        overlapPairs += 1;
      }
    }
  }
  return overlapPairs;
}

function isBoundArrow(element: Record<string, unknown>): boolean {
  const startBinding = element.startBinding as
    | { elementId?: unknown }
    | undefined;
  const endBinding = element.endBinding as { elementId?: unknown } | undefined;
  return Boolean(startBinding?.elementId && endBinding?.elementId);
}

export function summarizeElements(
  elements: Record<string, unknown>[]
): ExcalidrawSummary {
  const bounds = emptyBounds();
  let deletedCount = 0;
  let arrowCount = 0;
  let textCount = 0;
  let unboundArrowCount = 0;
  const shapes: Record<string, unknown>[] = [];

  for (const element of elements) {
    if (!element || typeof element !== "object") {
      continue;
    }
    const base = element as Record<string, unknown>;
    if (base.isDeleted === true) {
      deletedCount += 1;
      continue;
    }
    const type = typeof base.type === "string" ? base.type : "";
    if (type === "arrow") {
      arrowCount += 1;
      if (!isBoundArrow(base)) {
        unboundArrowCount += 1;
      }
    } else if (type === "text") {
      textCount += 1;
    } else if (SHAPE_TYPES.has(type)) {
      shapes.push(base);
    }

    updateBounds(bounds, getBoundingBox(base));
  }

  const overlapPairs = countOverlaps(shapes);

  return {
    elementCount: elements.length,
    shapeCount: shapes.length,
    arrowCount,
    textCount,
    deletedCount,
    unboundArrowCount,
    overlapPairs,
    bounds: normalizeBounds(bounds),
  };
}
