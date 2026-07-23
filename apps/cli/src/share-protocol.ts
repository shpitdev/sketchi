import { inflateSync } from "node:zlib";

import { Effect } from "effect";
import { Deflate } from "pako";

import { CliShareError } from "./errors.js";
import { renderLimitFailure } from "./render-limits.js";

export const EXCALIDRAW_BASELINE_COMMIT =
  "e6ae6bf05755eb3845d9635953bd6477e948a8f6";
export const EXCALIDRAW_STORE_BASELINE_COMMIT =
  "76de642d0e9961f26bf6c1fe1dbe1aeaac5c5778";
export const EXCALIDRAW_POST_ENDPOINT =
  "https://json.excalidraw.com/api/v2/post/";
export const EXCALIDRAW_GET_ENDPOINT = "https://json.excalidraw.com/api/v2/";
export const MAX_SHARE_LINK_LENGTH = 4 * 1024;
export const MAX_SHARE_ID_LENGTH = 128;
export const MAX_SHARE_BODY_BYTES = 2 * 1024 * 1024;
export const MAX_DECOMPRESSED_BYTES = 16 * 1024 * 1024;
export const MAX_SHARE_ELEMENTS = 10_000;
export const MAX_SHARE_STRUCTURE_DEPTH = 64;
export const MAX_POST_RESPONSE_BYTES = 64 * 1024;
export const SHARE_BACKEND_TIMEOUT_MS = 15_000;
export const OPENER_WAIT_MS = 3_000;
export const EXCALIFONT_FONT_FAMILY = 5;

export const SUPPORTED_ELEMENT_TYPES = [
  "rectangle",
  "ellipse",
  "diamond",
  "arrow",
  "line",
  "freedraw",
  "text",
] as const;

const SUPPORTED_ELEMENT_TYPE_SET = new Set<string>(SUPPORTED_ELEMENT_TYPES);
const textEncoder = new TextEncoder();
const fatalTextDecoder = new TextDecoder("utf-8", { fatal: true });
const BUFFER_FORMAT_VERSION = 1;
const ENCODING_METADATA = textEncoder.encode(
  JSON.stringify({
    version: 2,
    compression: "pako@1",
    encryption: "AES-GCM",
  }),
);

export interface ShareLinkParts {
  readonly id: string;
  readonly key: string;
}

type UnknownRecord = Record<string, unknown>;

function invalid(
  code:
    | "invalid_share_link"
    | "unsupported_scene"
    | "share_payload_too_large"
    | "share_crypto_failed",
  message: string,
  hint: string,
  details: ReadonlyArray<string> = [],
) {
  return CliShareError.make({ code, message, hint, details });
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function writeUint32(buffer: Uint8Array, offset: number, value: number): void {
  new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength).setUint32(
    offset,
    value,
  );
}

function readUint32(buffer: Uint8Array, offset: number): number {
  if (offset + 4 > buffer.byteLength) throw new Error("truncated chunk header");
  return new DataView(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength,
  ).getUint32(offset);
}

function concatBuffers(buffers: ReadonlyArray<Uint8Array>): Uint8Array {
  const size =
    4 + buffers.reduce((total, buffer) => total + 4 + buffer.byteLength, 0);
  const output = new Uint8Array(size);
  writeUint32(output, 0, BUFFER_FORMAT_VERSION);
  let offset = 4;
  for (const buffer of buffers) {
    writeUint32(output, offset, buffer.byteLength);
    offset += 4;
    output.set(buffer, offset);
    offset += buffer.byteLength;
  }
  return output;
}

function splitBuffers(
  buffer: Uint8Array,
  expectedChunkCount: number,
): ReadonlyArray<Uint8Array> {
  if (
    buffer.byteLength < 4 + expectedChunkCount * 4 ||
    readUint32(buffer, 0) !== BUFFER_FORMAT_VERSION
  ) {
    throw new Error("unsupported chunk format");
  }
  const chunks: Uint8Array[] = [];
  let offset = 4;
  for (let index = 0; index < expectedChunkCount; index += 1) {
    const size = readUint32(buffer, offset);
    offset += 4;
    const end = offset + size;
    if (end > buffer.byteLength) throw new Error("truncated chunk");
    chunks.push(buffer.subarray(offset, end));
    offset = end;
  }
  if (offset !== buffer.byteLength)
    throw new Error("unexpected trailing chunk");
  return chunks;
}

function keyBytes(key: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]{22}$/.test(key)) {
    throw new Error("invalid AES key encoding");
  }
  const bytes = Buffer.from(key, "base64url");
  if (bytes.byteLength !== 16) throw new Error("invalid AES key length");
  return bytes;
}

function importKey(key: string, usage: "encrypt" | "decrypt") {
  return crypto.subtle.importKey(
    "raw",
    Uint8Array.from(keyBytes(key)),
    { name: "AES-GCM", length: 128 },
    false,
    [usage],
  );
}

export function generateShareKey(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString(
    "base64url",
  );
}

export function formatShareLink(parts: ShareLinkParts): string {
  return `https://excalidraw.com/#json=${parts.id},${parts.key}`;
}

export function parseShareLink(
  input: string,
): Effect.Effect<ShareLinkParts, CliShareError> {
  if (textEncoder.encode(input).byteLength > MAX_SHARE_LINK_LENGTH) {
    return Effect.fail(
      invalid(
        "invalid_share_link",
        "The Excalidraw share link is invalid.",
        "Provide one complete https://excalidraw.com/#json=ID,KEY link.",
        ["link exceeds 4 KiB"],
      ),
    );
  }
  return Effect.try({
    try: () => {
      const rawMatch =
        /^https:\/\/(www\.)?excalidraw\.com\/#json=([A-Za-z0-9_-]{1,128}),([A-Za-z0-9_-]{22})$/u.exec(
          input,
        );
      if (!rawMatch?.[2] || !rawMatch[3]) {
        throw new Error("invalid raw URL grammar");
      }
      const url = new URL(input);
      const canonical = `https://${rawMatch[1] ?? ""}excalidraw.com/#json=${rawMatch[2]},${rawMatch[3]}`;
      if (url.href !== canonical) {
        throw new Error("URL normalization changed the supplied link");
      }
      keyBytes(rawMatch[3]);
      return { id: rawMatch[2], key: rawMatch[3] };
    },
    catch: () =>
      invalid(
        "invalid_share_link",
        "The Excalidraw share link is invalid.",
        "Provide one complete https://excalidraw.com/#json=ID,KEY link.",
      ),
  });
}

function databaseAppState(appState: UnknownRecord): UnknownRecord {
  const allowed = [
    "gridSize",
    "gridStep",
    "gridModeEnabled",
    "viewBackgroundColor",
    "lockedMultiSelections",
  ];
  return Object.fromEntries(
    allowed.flatMap((key) => (key in appState ? [[key, appState[key]]] : [])),
  );
}

function sceneParts(value: unknown): {
  readonly type: string;
  readonly version: number;
  readonly source: string;
  readonly elements: ReadonlyArray<unknown>;
  readonly appState: UnknownRecord;
  readonly files: UnknownRecord;
} {
  if (
    !isRecord(value) ||
    value["type"] !== "excalidraw" ||
    !isFiniteNumber(value["version"]) ||
    typeof value["source"] !== "string" ||
    !Array.isArray(value["elements"]) ||
    !isRecord(value["appState"]) ||
    !(value["files"] === undefined || isRecord(value["files"]))
  ) {
    throw new Error("invalid Excalidraw artifact shape");
  }
  return {
    type: value["type"],
    version: value["version"],
    source: value["source"],
    elements: value["elements"],
    appState: value["appState"],
    files: value["files"] ?? {},
  };
}

function invalidReference(
  value: unknown,
  elementIds: ReadonlySet<string>,
): boolean {
  return typeof value !== "string" || !elementIds.has(value);
}

function validateFiniteNumbers(
  value: unknown,
  path: string,
): string | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? undefined : `${path} must be finite`;
  }
  if (Array.isArray(value)) {
    for (const member of value) {
      const failure = validateFiniteNumbers(member, `${path} item`);
      if (failure) return failure;
    }
  } else if (isRecord(value)) {
    for (const member of Object.values(value)) {
      const failure = validateFiniteNumbers(member, `${path} property`);
      if (failure) return failure;
    }
  }
  return undefined;
}

function validateElement(
  element: unknown,
  index: number,
  elementIds: ReadonlySet<string>,
): string | undefined {
  const path = `elements[${String(index)}]`;
  if (
    !isRecord(element) ||
    typeof element["id"] !== "string" ||
    element["id"].length === 0 ||
    typeof element["type"] !== "string"
  ) {
    return `elements[${String(index)}] is not an Excalidraw element`;
  }
  if (!SUPPORTED_ELEMENT_TYPE_SET.has(element["type"])) {
    return `${path}.type is unsupported`;
  }
  if (
    ("link" in element &&
      element["link"] !== null &&
      element["link"] !== undefined) ||
    "fileId" in element
  ) {
    return `${path} contains an external resource`;
  }
  const finiteFailure = validateFiniteNumbers(element, path);
  if (finiteFailure) return finiteFailure;
  for (const field of ["x", "y", "width", "height", "angle"] as const) {
    if (!isFiniteNumber(element[field]))
      return `${path}.${field} must be finite`;
  }
  if (element["type"] === "text") {
    if (element["fontFamily"] !== EXCALIFONT_FONT_FAMILY) {
      return `${path}.fontFamily must be ${String(EXCALIFONT_FONT_FAMILY)}`;
    }
    if (typeof element["text"] !== "string") return `${path}.text is invalid`;
  }
  if (["arrow", "line", "freedraw"].includes(element["type"])) {
    if (
      !Array.isArray(element["points"]) ||
      element["points"].some(
        (point) =>
          !Array.isArray(point) ||
          point.length < 2 ||
          !isFiniteNumber(point[0]) ||
          !isFiniteNumber(point[1]),
      )
    ) {
      return `${path}.points contains invalid geometry`;
    }
  }
  for (const field of ["containerId", "frameId"] as const) {
    if (
      element[field] !== null &&
      element[field] !== undefined &&
      invalidReference(element[field], elementIds)
    ) {
      return `${path}.${field} is an invalid element reference`;
    }
  }
  for (const field of ["startBinding", "endBinding"] as const) {
    const binding = element[field];
    if (
      binding !== null &&
      binding !== undefined &&
      (!isRecord(binding) || invalidReference(binding["elementId"], elementIds))
    ) {
      return `${path}.${field} is an invalid element binding`;
    }
  }
  const boundElements = element["boundElements"];
  if (
    boundElements !== null &&
    boundElements !== undefined &&
    (!Array.isArray(boundElements) ||
      boundElements.some(
        (bound) =>
          !isRecord(bound) || invalidReference(bound["id"], elementIds),
      ))
  ) {
    return `${path}.boundElements contains an invalid element reference`;
  }
  return undefined;
}

function validateDatabaseAppState(appState: UnknownRecord): string | undefined {
  if (
    "viewBackgroundColor" in appState &&
    typeof appState["viewBackgroundColor"] !== "string"
  ) {
    return "appState.viewBackgroundColor must be a string";
  }
  if (
    "gridModeEnabled" in appState &&
    typeof appState["gridModeEnabled"] !== "boolean"
  ) {
    return "appState.gridModeEnabled must be boolean";
  }
  for (const field of ["gridSize", "gridStep"] as const) {
    if (
      field in appState &&
      appState[field] !== null &&
      !isFiniteNumber(appState[field])
    ) {
      return `appState.${field} must be finite or null`;
    }
  }
  if ("lockedMultiSelections" in appState) {
    const selections = appState["lockedMultiSelections"];
    if (!isRecord(selections)) {
      return "appState.lockedMultiSelections must be an object";
    }
    for (const [groupId, locked] of Object.entries(selections)) {
      if (groupId.length === 0 || locked !== true) {
        return "appState.lockedMultiSelections contains an invalid lock entry";
      }
    }
  }
  return validateFiniteNumbers(appState, "appState");
}

export function validateShareScene(
  value: unknown,
): Effect.Effect<unknown, CliShareError> {
  return Effect.try({
    try: () => {
      const scene = sceneParts(value);
      if (isRecord(value) && "libraryItems" in value) {
        throw new Error("Excalidraw library state is unsupported");
      }
      if (scene.elements.length > MAX_SHARE_ELEMENTS) {
        throw new Error("element count exceeds 10000");
      }
      if (Object.keys(scene.files).length > 0) {
        throw new Error("binary files are unsupported");
      }
      const elementIds = new Set<string>();
      for (const [index, element] of scene.elements.entries()) {
        if (!isRecord(element) || typeof element["id"] !== "string") {
          throw new Error(`elements[${String(index)}].id is invalid`);
        }
        if (elementIds.has(element["id"])) {
          throw new Error(`elements[${String(index)}].id is duplicated`);
        }
        elementIds.add(element["id"]);
      }
      for (const [index, element] of scene.elements.entries()) {
        const failure = validateElement(element, index, elementIds);
        if (failure) throw new Error(failure);
      }
      const sizeFailure = renderLimitFailure(scene.elements);
      if (sizeFailure) throw new Error(sizeFailure);
      const appStateFailure = validateDatabaseAppState(scene.appState);
      if (appStateFailure) throw new Error(appStateFailure);
      return value;
    },
    catch: (cause) =>
      invalid(
        "unsupported_scene",
        "The Excalidraw scene is unsupported by share/pull v1.",
        `Use only ${SUPPORTED_ELEMENT_TYPES.join(", ")} elements, Excalifont fontFamily ${String(EXCALIFONT_FONT_FAMILY)}, and no files or images.`,
        [cause instanceof Error ? cause.message : "invalid scene"],
      ),
  });
}

export function serializeForShare(
  value: unknown,
): Effect.Effect<Uint8Array, CliShareError> {
  return validateShareScene(value).pipe(
    Effect.flatMap(() =>
      Effect.try({
        try: () => {
          const scene = sceneParts(value);
          return textEncoder.encode(
            JSON.stringify(
              {
                type: scene.type,
                version: scene.version,
                source: scene.source,
                elements: scene.elements,
                appState: databaseAppState(scene.appState),
              },
              null,
              2,
            ),
          );
        },
        catch: () =>
          invalid(
            "unsupported_scene",
            "The Excalidraw scene could not be serialized.",
            "Inspect the local diagram.excalidraw artifact and retry.",
          ),
      }),
    ),
  );
}

export function encodeSharePayload(
  data: Uint8Array,
  key: string,
  fixedIv?: Uint8Array,
): Effect.Effect<Uint8Array, CliShareError> {
  return Effect.tryPromise({
    try: async () => {
      if (data.byteLength > MAX_DECOMPRESSED_BYTES - 16) {
        throw invalid(
          "share_payload_too_large",
          "The Excalidraw share contents exceed 16 MiB.",
          "Reduce the drawing size and retry.",
        );
      }
      const maximumCompressedBytes =
        MAX_SHARE_BODY_BYTES -
        (4 + 3 * 4) -
        ENCODING_METADATA.byteLength -
        12 -
        16;
      const compressed = await deflateShareContents(
        data,
        maximumCompressedBytes,
      );
      const iv = Uint8Array.from(
        fixedIv ?? crypto.getRandomValues(new Uint8Array(12)),
      );
      if (iv.byteLength !== 12) throw new Error("invalid IV length");
      const encrypted = new Uint8Array(
        await crypto.subtle.encrypt(
          { name: "AES-GCM", iv: Uint8Array.from(iv) },
          await importKey(key, "encrypt"),
          Uint8Array.from(compressed),
        ),
      );
      const body = concatBuffers([ENCODING_METADATA, iv, encrypted]);
      return body;
    },
    catch: (cause) =>
      cause instanceof CliShareError
        ? cause
        : invalid(
            "share_crypto_failed",
            "The Excalidraw share payload could not be encrypted.",
            "Retry the command. If it persists, inspect the local artifact.",
          ),
  });
}

function uint32Buffer(value: number): Uint8Array {
  const output = new Uint8Array(4);
  writeUint32(output, 0, value);
  return output;
}

function deflateShareContents(
  data: Uint8Array,
  maximumBytes: number,
): Uint8Array {
  const contentsMetadata = textEncoder.encode("null");
  const segments = [
    uint32Buffer(BUFFER_FORMAT_VERSION),
    uint32Buffer(contentsMetadata.byteLength),
    contentsMetadata,
    uint32Buffer(data.byteLength),
    data,
  ];
  const deflater = new Deflate({ chunkSize: 64 * 1024 });
  const chunks: Uint8Array[] = [];
  let size = 0;
  deflater.onData = (chunk) => {
    const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
    size += bytes.byteLength;
    if (size > maximumBytes) {
      throw invalid(
        "share_payload_too_large",
        "The encrypted Excalidraw share payload exceeds 2 MiB.",
        "Reduce the drawing size and retry.",
      );
    }
    chunks.push(bytes);
  };
  for (const [index, segment] of segments.entries()) {
    deflater.push(segment, index === segments.length - 1);
    if (deflater.err !== 0) throw new Error(deflater.msg);
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function assertJsonDepth(bytes: Uint8Array): void {
  const text = fatalTextDecoder.decode(bytes);
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (const character of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{" || character === "[") {
      depth += 1;
      if (depth > MAX_SHARE_STRUCTURE_DEPTH) {
        throw new Error("JSON structure exceeds depth 64");
      }
    } else if (character === "}" || character === "]") {
      depth -= 1;
      if (depth < 0) throw new Error("unbalanced JSON structure");
    }
  }
  if (depth !== 0 || inString) throw new Error("incomplete JSON structure");
}

export function decodeSharePayload(
  body: Uint8Array,
  key: string,
): Effect.Effect<unknown, CliShareError> {
  if (body.byteLength > MAX_SHARE_BODY_BYTES) {
    return Effect.fail(
      invalid(
        "share_payload_too_large",
        "The Excalidraw share payload exceeds 2 MiB.",
        "Use a smaller supported Excalidraw link.",
      ),
    );
  }
  return Effect.tryPromise({
    try: async () => {
      const outer = splitBuffers(body, 3);
      const [metadata, iv, encrypted] = outer;
      if (!metadata || !iv || !encrypted || iv.byteLength !== 12) {
        throw new Error("invalid encrypted payload chunks");
      }
      const metadataValue: unknown = JSON.parse(
        fatalTextDecoder.decode(metadata),
      );
      if (
        !isRecord(metadataValue) ||
        metadataValue["version"] !== 2 ||
        metadataValue["compression"] !== "pako@1" ||
        metadataValue["encryption"] !== "AES-GCM"
      ) {
        throw new Error("unsupported encoding metadata");
      }
      const compressed = new Uint8Array(
        await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: Uint8Array.from(iv) },
          await importKey(key, "decrypt"),
          Uint8Array.from(encrypted),
        ),
      );
      const inflated = inflateSync(compressed, {
        maxOutputLength: MAX_DECOMPRESSED_BYTES + 1,
      });
      if (inflated.byteLength > MAX_DECOMPRESSED_BYTES) {
        throw new Error("decompressed payload exceeds 16 MiB");
      }
      const inner = splitBuffers(inflated, 2);
      if (!inner[0] || !inner[1]) {
        throw new Error("invalid inner chunk count");
      }
      if (fatalTextDecoder.decode(inner[0]) !== "null") {
        throw new Error("unsupported contents metadata");
      }
      assertJsonDepth(inner[1]);
      return JSON.parse(fatalTextDecoder.decode(inner[1]));
    },
    catch: (cause) => {
      const exceeded =
        cause instanceof RangeError ||
        (cause instanceof Error &&
          (cause.message.includes("maxOutputLength") ||
            cause.message.includes("larger than")));
      return exceeded
        ? invalid(
            "share_payload_too_large",
            "The decompressed Excalidraw share payload exceeds 16 MiB.",
            "Use a smaller supported Excalidraw link.",
          )
        : invalid(
            "share_crypto_failed",
            "The Excalidraw share payload could not be decrypted or decoded.",
            "Verify that the complete bearer link is correct and uses current format v2.",
          );
    },
  });
}
