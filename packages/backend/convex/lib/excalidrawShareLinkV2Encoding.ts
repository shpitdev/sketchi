import pako from "pako";

const CONCAT_BUFFERS_VERSION = 1;
const VERSION_DATAVIEW_BYTES = 4;
const NEXT_CHUNK_SIZE_DATAVIEW_BYTES = 4;
const IV_LENGTH_BYTES = 12;
const AES_GCM_KEY_LENGTH = 128;

function concatBuffers(...buffers: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const totalBytes =
    VERSION_DATAVIEW_BYTES +
    NEXT_CHUNK_SIZE_DATAVIEW_BYTES * buffers.length +
    buffers.reduce((sum, buffer) => sum + buffer.byteLength, 0);

  const output = new Uint8Array(totalBytes);
  const view = new DataView(output.buffer);

  let cursor = 0;
  view.setUint32(cursor, CONCAT_BUFFERS_VERSION);
  cursor += VERSION_DATAVIEW_BYTES;

  for (const buffer of buffers) {
    view.setUint32(cursor, buffer.byteLength);
    cursor += NEXT_CHUNK_SIZE_DATAVIEW_BYTES;
    output.set(buffer, cursor);
    cursor += buffer.byteLength;
  }

  return output;
}

export async function buildV2UploadBody(args: {
  elements: unknown[];
  appState: Record<string, unknown>;
}): Promise<{ body: Uint8Array<ArrayBuffer>; encryptionKey: string }> {
  const sceneJson = JSON.stringify({
    elements: args.elements,
    appState: args.appState,
  });

  const contentsBuffer = new TextEncoder().encode(sceneJson);
  const contentsMetadataBuffer = new TextEncoder().encode("null");
  const inner = concatBuffers(contentsMetadataBuffer, contentsBuffer);

  const compressed = pako.deflate(inner);
  const compressedBytes = new Uint8Array(compressed);

  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: AES_GCM_KEY_LENGTH },
    true,
    ["encrypt", "decrypt"]
  );

  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    compressedBytes
  );

  const encodingMetadataBuffer = new TextEncoder().encode(
    JSON.stringify({
      version: 2,
      compression: "pako@1",
      encryption: "AES-GCM",
    })
  );

  const outer = concatBuffers(
    encodingMetadataBuffer,
    iv,
    new Uint8Array(encrypted)
  );

  const jwk = await crypto.subtle.exportKey("jwk", key);
  if (!jwk.k) {
    throw new Error("Failed to export encryption key");
  }

  return { body: outer, encryptionKey: jwk.k };
}
