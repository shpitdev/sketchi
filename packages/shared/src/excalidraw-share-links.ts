import { Inflate } from "pako";

// NOTE(sync): Convex deploys can't import workspace packages; keep parsing logic in sync with
// `packages/backend/convex/lib/excalidrawShareLinks.ts`.

// Constants matching Excalidraw encode.ts:161-168
const CONCAT_BUFFERS_VERSION = 1;
const VERSION_DATAVIEW_BYTES = 4;
const NEXT_CHUNK_SIZE_DATAVIEW_BYTES = 4;
const IV_LENGTH_BYTES = 12;
const MAX_COMPRESSED_BYTES = 5 * 1024 * 1024;
const MAX_DECOMPRESSED_BYTES = 20 * 1024 * 1024;
const MAX_UPSTREAM_BYTES = 25 * 1024 * 1024;
const DEFAULT_FETCH_TIMEOUT_MS = 10_000;

const EXCALIDRAW_SHARE_URL_PATTERN = /#json=([^,]+),(.+)$/;
const EXCALIDRAW_GET_URL = "https://json.excalidraw.com/api/v2/";
const EXCALIDRAW_PLUS_EXPORT_URL =
  "https://export.excalidraw.com/api/v1/export/s/";
const EXCALIDRAW_PLUS_FIRESTORE_URL =
  "https://firestore.googleapis.com/v1/projects/quickstart-1595168317408/databases/(default)/documents/scenes/";

export interface ExcalidrawShareLinkPayload {
  elements: unknown[];
  appState: Record<string, unknown>;
}

export type ShareUrlType = "v1" | "v2" | "base64" | "unknown";

export type ExcalidrawUrlSource =
  | "excalidraw-share"
  | "excalidraw-plus-link"
  | "excalidraw-plus-readonly";

export type ExcalidrawPermission = "read-only" | "view-and-edit" | "unknown";

export type ParseExcalidrawUrlResult =
  | {
      source: "excalidraw-share";
      permission: "unknown";
      payload: ExcalidrawShareLinkPayload;
      metadata: {
        shareId: string;
        encryptionKey: string;
        shareUrlType: ShareUrlType;
      };
    }
  | {
      source: "excalidraw-plus-link";
      permission: ExcalidrawPermission;
      payload: ExcalidrawShareLinkPayload;
      metadata: {
        workspaceId: string;
        sceneId: string;
        linkSharing?: number;
      };
    }
  | {
      source: "excalidraw-plus-readonly";
      permission: ExcalidrawPermission;
      payload: ExcalidrawShareLinkPayload;
      metadata: {
        token: string;
        workspaceId?: string;
        sceneId?: string;
        linkSharing?: number;
      };
    };

interface FileEncodingInfo {
  version: number;
  compression: string;
  encryption: string;
}

// Buffer format: [4-byte version][4-byte len][chunk]...[4-byte len][chunk]
// Mirrors Excalidraw encode.ts:254-291
function splitBuffers(concatenatedBuffer: Uint8Array): Uint8Array[] {
  const buffers: Uint8Array[] = [];
  let cursor = 0;

  if (concatenatedBuffer.byteLength < VERSION_DATAVIEW_BYTES) {
    throw new Error("V2 parsing failed: truncated buffer header");
  }
  const version = new DataView(
    concatenatedBuffer.buffer,
    concatenatedBuffer.byteOffset,
    concatenatedBuffer.byteLength
  ).getUint32(cursor);

  if (version > CONCAT_BUFFERS_VERSION) {
    throw new Error(
      `V2 parsing failed: invalid buffer version ${version}, expected <= ${CONCAT_BUFFERS_VERSION}`
    );
  }
  cursor += VERSION_DATAVIEW_BYTES;

  while (cursor < concatenatedBuffer.byteLength) {
    if (
      cursor + NEXT_CHUNK_SIZE_DATAVIEW_BYTES >
      concatenatedBuffer.byteLength
    ) {
      throw new Error("V2 parsing failed: truncated chunk header");
    }
    const chunkSize = new DataView(
      concatenatedBuffer.buffer,
      concatenatedBuffer.byteOffset,
      concatenatedBuffer.byteLength
    ).getUint32(cursor);
    cursor += NEXT_CHUNK_SIZE_DATAVIEW_BYTES;
    if (cursor + chunkSize > concatenatedBuffer.byteLength) {
      throw new Error("V2 parsing failed: chunk size exceeds remaining buffer");
    }
    buffers.push(concatenatedBuffer.slice(cursor, cursor + chunkSize));
    cursor += chunkSize;
  }

  return buffers;
}

function decompressBuffer(data: Uint8Array): Uint8Array {
  if (data.byteLength > MAX_COMPRESSED_BYTES) {
    throw new Error("V2 decompression failed: compressed payload too large");
  }
  try {
    const chunks: Uint8Array[] = [];
    let total = 0;
    const inflator = new Inflate();
    inflator.onData = (chunk: Uint8Array) => {
      total += chunk.length;
      if (total > MAX_DECOMPRESSED_BYTES) {
        inflator.err = 1;
        inflator.msg = "decompressed payload too large";
        return;
      }
      chunks.push(chunk);
    };
    inflator.push(data, true);
    if (inflator.err) {
      throw new Error(inflator.msg || "invalid compressed payload");
    }
    const output = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.length;
    }
    return output;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "invalid compressed payload";
    throw new Error(`V2 decompression failed: ${message}`);
  }
}

async function decryptData(
  ciphertext: Uint8Array,
  iv: Uint8Array,
  key: CryptoKey
): Promise<Uint8Array> {
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      key,
      ciphertext as BufferSource
    );
    return new Uint8Array(decrypted);
  } catch {
    throw new Error("Decryption failed: invalid key or corrupted data");
  }
}

function isV2Format(buffer: Uint8Array): boolean {
  if (buffer.byteLength < VERSION_DATAVIEW_BYTES) {
    return false;
  }
  const version = new DataView(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength
  ).getUint32(0);
  return version === CONCAT_BUFFERS_VERSION;
}

async function parseV2(
  encryptedBuffer: Uint8Array,
  key: CryptoKey
): Promise<ExcalidrawShareLinkPayload> {
  const outerBuffers = splitBuffers(encryptedBuffer);
  if (outerBuffers.length < 3) {
    throw new Error(
      `V2 parsing failed: expected 3 outer buffers, got ${outerBuffers.length}`
    );
  }

  const encodingMetadataBuffer = outerBuffers[0];
  const iv = outerBuffers[1];
  const ciphertext = outerBuffers[2];

  if (!(encodingMetadataBuffer && iv && ciphertext)) {
    throw new Error("V2 parsing failed: missing required buffers");
  }

  const encodingMetadataJson = new TextDecoder().decode(encodingMetadataBuffer);
  let encodingMetadata: FileEncodingInfo;
  try {
    encodingMetadata = JSON.parse(encodingMetadataJson) as FileEncodingInfo;
  } catch {
    throw new Error("V2 parsing failed: invalid encoding metadata JSON");
  }

  if (iv.byteLength !== IV_LENGTH_BYTES) {
    throw new Error(
      `V2 parsing failed: invalid IV length ${iv.byteLength}, expected ${IV_LENGTH_BYTES}`
    );
  }

  const decrypted = await decryptData(ciphertext, iv, key);

  let decompressed: Uint8Array;
  if (encodingMetadata.compression?.startsWith("pako")) {
    decompressed = decompressBuffer(decrypted);
  } else {
    decompressed = decrypted;
  }

  const decompressedStr = new TextDecoder().decode(decompressed);

  if (decompressedStr.startsWith("{")) {
    try {
      return JSON.parse(decompressedStr) as ExcalidrawShareLinkPayload;
    } catch {
      throw new Error("V2 parsing failed: invalid scene JSON");
    }
  }

  const innerBuffers = splitBuffers(decompressed);
  if (innerBuffers.length < 2) {
    throw new Error(
      `V2 parsing failed: expected 2 inner buffers, got ${innerBuffers.length}`
    );
  }

  const contentsBuffer = innerBuffers[1];
  if (!contentsBuffer) {
    throw new Error("V2 parsing failed: missing contents buffer");
  }

  const sceneJson = new TextDecoder().decode(contentsBuffer);
  try {
    return JSON.parse(sceneJson) as ExcalidrawShareLinkPayload;
  } catch {
    throw new Error("V2 parsing failed: invalid scene JSON");
  }
}

// V1 format: [12-byte IV][ciphertext]
async function parseV1(
  encryptedBuffer: Uint8Array,
  key: CryptoKey
): Promise<ExcalidrawShareLinkPayload> {
  const iv = encryptedBuffer.slice(0, IV_LENGTH_BYTES);
  const ciphertext = encryptedBuffer.slice(IV_LENGTH_BYTES);

  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ciphertext
    );

    return JSON.parse(
      new TextDecoder().decode(decrypted)
    ) as ExcalidrawShareLinkPayload;
  } catch {
    throw new Error("V1 decryption failed: invalid key or corrupted data");
  }
}

function base64UrlToBytes(str: string): Uint8Array {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

async function fetchWithTimeout(
  url: string,
  options?: RequestInit & { timeoutMs?: number }
): Promise<Response> {
  const { timeoutMs = DEFAULT_FETCH_TIMEOUT_MS, ...init } = options ?? {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function readResponseBytesWithLimit(
  response: Response,
  maxBytes: number
): Promise<Uint8Array> {
  const contentLength = Number(response.headers.get("content-length") ?? "NaN");
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error(
      `Upstream response too large: ${contentLength} bytes (max ${maxBytes})`
    );
  }
  const buffer = new Uint8Array(await response.arrayBuffer());
  if (buffer.byteLength > maxBytes) {
    throw new Error(
      `Upstream response too large: ${buffer.byteLength} bytes (max ${maxBytes})`
    );
  }
  return buffer;
}

async function importKey(keyString: string): Promise<CryptoKey> {
  const keyBytes = base64UrlToBytes(keyString);
  let alg: "A128GCM" | "A192GCM" | "A256GCM";
  switch (keyBytes.length) {
    case 16:
      alg = "A128GCM";
      break;
    case 24:
      alg = "A192GCM";
      break;
    case 32:
      alg = "A256GCM";
      break;
    default:
      throw new Error(
        `Invalid encryption key length: ${keyBytes.length} bytes`
      );
  }
  return await crypto.subtle.importKey(
    "jwk",
    { kty: "oct", k: keyString, alg },
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );
}

function isBase64EncodedData(str: string): boolean {
  if (str.length < 8) {
    return false;
  }
  try {
    const decoded = base64UrlToBytes(str);
    return isV2Format(decoded);
  } catch {
    return false;
  }
}

export function detectShareUrlType(url: string): ShareUrlType {
  const match = url.match(EXCALIDRAW_SHARE_URL_PATTERN);
  if (!match) {
    return "unknown";
  }
  const idOrData = match[1];
  if (!idOrData) {
    return "unknown";
  }
  if (isBase64EncodedData(idOrData)) {
    return "base64";
  }
  return "unknown";
}

export async function parseExcalidrawShareLinkWithMetadata(
  url: string
): Promise<{
  payload: ExcalidrawShareLinkPayload;
  shareUrlType: ShareUrlType;
  shareId: string;
  encryptionKey: string;
}> {
  const match = url.match(EXCALIDRAW_SHARE_URL_PATTERN);
  if (!match) {
    throw new Error("Invalid Excalidraw share URL format");
  }

  const idOrData = match[1];
  const keyString = match[2];

  if (!(idOrData && keyString)) {
    throw new Error("Invalid Excalidraw share URL format: missing id or key");
  }

  let encryptedBuffer: Uint8Array;
  let shareUrlType: ShareUrlType = "unknown";

  if (isBase64EncodedData(idOrData)) {
    encryptedBuffer = base64UrlToBytes(idOrData);
    shareUrlType = "base64";
  } else {
    const response = await fetchWithTimeout(`${EXCALIDRAW_GET_URL}${idOrData}`);
    if (!response.ok) {
      throw new Error(`Fetch failed: ${response.status}`);
    }
    encryptedBuffer = await readResponseBytesWithLimit(
      response,
      MAX_UPSTREAM_BYTES
    );
  }

  const key = await importKey(keyString);

  if (isV2Format(encryptedBuffer)) {
    if (shareUrlType !== "base64") {
      shareUrlType = "v2";
    }
    return {
      payload: await parseV2(encryptedBuffer, key),
      shareUrlType,
      shareId: idOrData,
      encryptionKey: keyString,
    };
  }

  if (shareUrlType !== "base64") {
    shareUrlType = "v1";
  }

  return {
    payload: await parseV1(encryptedBuffer, key),
    shareUrlType,
    shareId: idOrData,
    encryptionKey: keyString,
  };
}

export async function parseExcalidrawShareLink(
  url: string
): Promise<ExcalidrawShareLinkPayload> {
  const { payload } = await parseExcalidrawShareLinkWithMetadata(url);
  return payload;
}

function permissionFromLinkSharing(
  linkSharing: number | undefined
): ExcalidrawPermission {
  if (typeof linkSharing !== "number" || !Number.isFinite(linkSharing)) {
    return "unknown";
  }
  const value = Math.trunc(linkSharing);
  if (!Number.isFinite(value)) {
    return "unknown";
  }
  // Excalidraw+ linkSharing is a bitfield; observed values: 1 (read-only), 3 (view+edit).
  const canEdit = Math.trunc(value / 2) % 2 === 1;
  return canEdit ? "view-and-edit" : "read-only";
}

function parsePlusLinkParts(
  parsedUrl: URL
): { workspaceId: string; sceneId: string } | null {
  const hostname = parsedUrl.hostname.toLowerCase();
  if (hostname !== "link.excalidraw.com" && hostname !== "app.excalidraw.com") {
    return null;
  }
  const parts = parsedUrl.pathname.split("/").filter(Boolean);
  if (parts[0] !== "l") {
    return null;
  }
  const workspaceId = parts[1];
  const sceneId = parts[2];
  if (!(workspaceId && sceneId)) {
    throw new Error("Invalid Excalidraw+ link URL format");
  }
  return { workspaceId, sceneId };
}

function parseReadonlyToken(parsedUrl: URL): string | null {
  const hostname = parsedUrl.hostname.toLowerCase();
  if (hostname !== "link.excalidraw.com") {
    return null;
  }
  const parts = parsedUrl.pathname.split("/").filter(Boolean);
  if (parts[0] !== "readonly") {
    return null;
  }
  const token = parts.slice(1).join("/");
  if (!token) {
    throw new Error("Invalid Excalidraw+ readonly URL format");
  }
  return token;
}

function extractNextDataJson(html: string): unknown {
  const marker = '<script id="__NEXT_DATA__" type="application/json">';
  const start = html.indexOf(marker);
  if (start < 0) {
    throw new Error(
      "Failed to parse readonly link HTML: __NEXT_DATA__ missing"
    );
  }
  const jsonStart = start + marker.length;
  const end = html.indexOf("</script>", jsonStart);
  if (end < 0) {
    throw new Error(
      "Failed to parse readonly link HTML: __NEXT_DATA__ truncated"
    );
  }
  const jsonStr = html.slice(jsonStart, end);
  try {
    return JSON.parse(jsonStr) as unknown;
  } catch {
    throw new Error(
      "Failed to parse readonly link HTML: invalid __NEXT_DATA__ JSON"
    );
  }
}

async function fetchExportedScene(params: { sceneId: string }): Promise<{
  payload: ExcalidrawShareLinkPayload;
}> {
  const response = await fetchWithTimeout(
    `${EXCALIDRAW_PLUS_EXPORT_URL}${params.sceneId}/format/json/scene`
  );
  if (!response.ok) {
    throw new Error(`Export fetch failed: ${response.status}`);
  }
  const bytes = await readResponseBytesWithLimit(response, MAX_UPSTREAM_BYTES);
  const text = new TextDecoder().decode(bytes);
  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    throw new Error("Export fetch failed: invalid JSON");
  }

  const scene = json as {
    elements?: unknown;
    appState?: unknown;
  };

  if (!Array.isArray(scene.elements)) {
    throw new Error("Export fetch failed: missing elements array");
  }
  if (!scene.appState || typeof scene.appState !== "object") {
    throw new Error("Export fetch failed: missing appState");
  }

  return {
    payload: {
      elements: scene.elements,
      appState: scene.appState as Record<string, unknown>,
    },
  };
}

async function fetchLinkSharing(sceneId: string): Promise<number | undefined> {
  const response = await fetchWithTimeout(
    `${EXCALIDRAW_PLUS_FIRESTORE_URL}${sceneId}`
  );
  if (!response.ok) {
    return undefined;
  }
  const bytes = await readResponseBytesWithLimit(response, MAX_UPSTREAM_BYTES);
  const text = new TextDecoder().decode(bytes);
  try {
    const json = JSON.parse(text) as {
      fields?: { linkSharing?: { integerValue?: string } };
    };
    const raw = json.fields?.linkSharing?.integerValue;
    const value = raw != null ? Number(raw) : Number.NaN;
    return Number.isFinite(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export async function parseExcalidrawUrl(
  url: string
): Promise<ParseExcalidrawUrlResult> {
  if (EXCALIDRAW_SHARE_URL_PATTERN.test(url)) {
    const parsed = await parseExcalidrawShareLinkWithMetadata(url);
    return {
      source: "excalidraw-share",
      permission: "unknown",
      payload: parsed.payload,
      metadata: {
        shareId: parsed.shareId,
        encryptionKey: parsed.encryptionKey,
        shareUrlType: parsed.shareUrlType,
      },
    };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("Invalid Excalidraw URL format");
  }

  const plusLink = parsePlusLinkParts(parsedUrl);
  if (plusLink) {
    const exported = await fetchExportedScene({ sceneId: plusLink.sceneId });
    const linkSharing = await fetchLinkSharing(plusLink.sceneId);
    return {
      source: "excalidraw-plus-link",
      permission: permissionFromLinkSharing(linkSharing),
      payload: exported.payload,
      metadata: {
        workspaceId: plusLink.workspaceId,
        sceneId: plusLink.sceneId,
        linkSharing,
      },
    };
  }

  const readonlyToken = parseReadonlyToken(parsedUrl);
  if (readonlyToken) {
    const response = await fetchWithTimeout(parsedUrl.toString());
    if (!response.ok) {
      throw new Error(`Readonly fetch failed: ${response.status}`);
    }
    const bytes = await readResponseBytesWithLimit(
      response,
      MAX_UPSTREAM_BYTES
    );
    const html = new TextDecoder().decode(bytes);
    const nextData = extractNextDataJson(html) as {
      props?: {
        pageProps?: {
          sceneContents?: { elements?: unknown; appState?: unknown };
          sceneMetadata?: {
            linkSharing?: number;
            workspace?: string;
            id?: string;
          };
          readOnlyLink?: { workspace?: string; scene?: string };
        };
      };
    };

    const pageProps = nextData.props?.pageProps;
    const sceneContents = pageProps?.sceneContents;
    if (!Array.isArray(sceneContents?.elements)) {
      throw new Error("Readonly fetch failed: missing elements array");
    }
    if (
      !sceneContents?.appState ||
      typeof sceneContents.appState !== "object"
    ) {
      throw new Error("Readonly fetch failed: missing appState");
    }

    const linkSharing = pageProps?.sceneMetadata?.linkSharing;
    const workspaceId =
      pageProps?.readOnlyLink?.workspace ?? pageProps?.sceneMetadata?.workspace;
    const sceneId =
      pageProps?.readOnlyLink?.scene ?? pageProps?.sceneMetadata?.id;

    return {
      source: "excalidraw-plus-readonly",
      permission: permissionFromLinkSharing(linkSharing),
      payload: {
        elements: sceneContents.elements,
        appState: sceneContents.appState as Record<string, unknown>,
      },
      metadata: {
        token: readonlyToken,
        workspaceId,
        sceneId,
        linkSharing,
      },
    };
  }

  throw new Error("Unsupported Excalidraw URL format");
}
