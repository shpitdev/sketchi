import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const EXCALIDRAW_SHARE_URL_PATTERN = /#json=([^,]+),(.+)$/;
const EXCALIDRAW_GET_URL = "https://json.excalidraw.com/api/v2/";
const IV_BYTE_LENGTH = 12;

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

export type ExcalidrawFile = {
  elements: Record<string, unknown>[];
  appState: Record<string, unknown>;
};

export type ExcalidrawShareLinkPayload = {
  elements: Record<string, unknown>[];
  appState: Record<string, unknown>;
};

export type ExcalidrawSummary = {
  elementCount: number;
  shapeCount: number;
  arrowCount: number;
  textCount: number;
  deletedCount: number;
  unboundArrowCount: number;
  overlapPairs: number;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
};

function getCrypto(): Crypto {
  if (!globalThis.crypto?.subtle) {
    throw new Error("WebCrypto is not available in this runtime.");
  }
  return globalThis.crypto;
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

export async function parseExcalidrawShareLink(
  url: string
): Promise<ExcalidrawShareLinkPayload> {
  const match = url.match(EXCALIDRAW_SHARE_URL_PATTERN);
  if (!match) {
    throw new Error("Invalid Excalidraw share URL format");
  }

  const [, id, keyString] = match;
  const response = await fetch(`${EXCALIDRAW_GET_URL}${id}`);
  if (!response.ok) {
    throw new Error(`Fetch failed: ${response.status}`);
  }

  const encrypted = await response.arrayBuffer();
  const crypto = getCrypto();

  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: "oct", k: keyString, alg: "A128GCM" },
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );

  const iv = new Uint8Array(encrypted.slice(0, IV_BYTE_LENGTH));
  const ciphertext = new Uint8Array(encrypted.slice(IV_BYTE_LENGTH));

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext
  );

  return JSON.parse(
    new TextDecoder().decode(decrypted)
  ) as ExcalidrawShareLinkPayload;
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

function overlaps(a: ReturnType<typeof getBoundingBox>, b: ReturnType<typeof getBoundingBox>): boolean {
  if (!(a && b)) {
    return false;
  }
  return !(a.maxX <= b.minX || a.minX >= b.maxX || a.maxY <= b.minY || a.minY >= b.maxY);
}

export function summarizeElements(elements: Record<string, unknown>[]): ExcalidrawSummary {
  const bounds = {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };

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
      const startBinding = base.startBinding as { elementId?: unknown } | undefined;
      const endBinding = base.endBinding as { elementId?: unknown } | undefined;
      if (!(startBinding?.elementId && endBinding?.elementId)) {
        unboundArrowCount += 1;
      }
    } else if (type === "text") {
      textCount += 1;
    } else if (SHAPE_TYPES.has(type)) {
      shapes.push(base);
    }

    const box = getBoundingBox(base);
    if (box) {
      bounds.minX = Math.min(bounds.minX, box.minX);
      bounds.minY = Math.min(bounds.minY, box.minY);
      bounds.maxX = Math.max(bounds.maxX, box.maxX);
      bounds.maxY = Math.max(bounds.maxY, box.maxY);
    }
  }

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

  if (!Number.isFinite(bounds.minX)) {
    bounds.minX = 0;
    bounds.minY = 0;
    bounds.maxX = 0;
    bounds.maxY = 0;
  }

  return {
    elementCount: elements.length,
    shapeCount: shapes.length,
    arrowCount,
    textCount,
    deletedCount,
    unboundArrowCount,
    overlapPairs,
    bounds,
  };
}