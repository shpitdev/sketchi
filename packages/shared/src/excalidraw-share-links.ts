import { inflate } from "pako";

// Constants matching Excalidraw encode.ts:161-168
const CONCAT_BUFFERS_VERSION = 1;
const VERSION_DATAVIEW_BYTES = 4;
const NEXT_CHUNK_SIZE_DATAVIEW_BYTES = 4;
const IV_LENGTH_BYTES = 12;

const EXCALIDRAW_SHARE_URL_PATTERN = /#json=([^,]+),(.+)$/;
const EXCALIDRAW_GET_URL = "https://json.excalidraw.com/api/v2/";

export interface ExcalidrawShareLinkPayload {
  elements: unknown[];
  appState: Record<string, unknown>;
}

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
    const chunkSize = new DataView(
      concatenatedBuffer.buffer,
      concatenatedBuffer.byteOffset,
      concatenatedBuffer.byteLength
    ).getUint32(cursor);
    cursor += NEXT_CHUNK_SIZE_DATAVIEW_BYTES;
    buffers.push(concatenatedBuffer.slice(cursor, cursor + chunkSize));
    cursor += chunkSize;
  }

  return buffers;
}

function decompressBuffer(data: Uint8Array): Uint8Array {
  try {
    return inflate(data);
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

// V2 outer: [version][len][encodingMetadata][len][IV][len][ciphertext]
// V2 inner (after decrypt+decompress): [version][len][contentsMetadata][len][scene JSON]
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

async function importKey(keyString: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "jwk",
    { kty: "oct", k: keyString, alg: "A128GCM" },
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );
}

/**
 * Parse an Excalidraw share link URL and return the diagram payload.
 * Supports V2 (compressed) and V1 (legacy) formats with automatic detection.
 */
export async function parseExcalidrawShareLink(
  url: string
): Promise<ExcalidrawShareLinkPayload> {
  const match = url.match(EXCALIDRAW_SHARE_URL_PATTERN);
  if (!match) {
    throw new Error("Invalid Excalidraw share URL format");
  }

  const id = match[1];
  const keyString = match[2];

  if (!(id && keyString)) {
    throw new Error("Invalid Excalidraw share URL format: missing id or key");
  }

  const response = await fetch(`${EXCALIDRAW_GET_URL}${id}`);
  if (!response.ok) {
    throw new Error(`Fetch failed: ${response.status}`);
  }
  const encryptedBuffer = new Uint8Array(await response.arrayBuffer());

  const key = await importKey(keyString);

  if (isV2Format(encryptedBuffer)) {
    return parseV2(encryptedBuffer, key);
  }

  return parseV1(encryptedBuffer, key);
}
