const EXCALIDRAW_SHARE_URL_PATTERN = /#json=([^,]+),(.+)$/;
const EXCALIDRAW_GET_URL = "https://json.excalidraw.com/api/v2/";
const IV_BYTE_LENGTH = 12;

export interface ExcalidrawShareLinkPayload {
  elements: unknown[];
  appState: Record<string, unknown>;
}

function getCrypto(): Crypto {
  if (!globalThis.crypto?.subtle) {
    throw new Error("WebCrypto is not available in this runtime.");
  }
  return globalThis.crypto;
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

  return JSON.parse(new TextDecoder().decode(decrypted)) as ExcalidrawShareLinkPayload;
}