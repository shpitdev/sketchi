const EXCALIDRAW_SHARE_URL_PATTERN = /#json=([^,]+),(.+)$/;
const EXCALIDRAW_POST_URL = "https://json.excalidraw.com/api/v2/post/";
const EXCALIDRAW_GET_URL = "https://json.excalidraw.com/api/v2/";
const IV_BYTE_LENGTH = 12;
const AES_GCM_KEY_LENGTH = 128;

export interface ExcalidrawShareLinkResult {
  url: string;
  shareId: string;
  encryptionKey: string;
}

export interface ExcalidrawShareLinkPayload {
  elements: unknown[];
  appState: Record<string, unknown>;
}

export async function createExcalidrawShareLink(
  elements: unknown[],
  appState: Record<string, unknown> = {}
): Promise<ExcalidrawShareLinkResult> {
  const payload = JSON.stringify({ elements, appState });
  const encodedPayload = new TextEncoder().encode(payload);

  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: AES_GCM_KEY_LENGTH },
    true,
    ["encrypt", "decrypt"]
  );

  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTE_LENGTH));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encodedPayload
  );

  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);

  const response = await fetch(EXCALIDRAW_POST_URL, {
    method: "POST",
    body: combined,
  });

  if (!response.ok) {
    throw new Error(
      `Upload failed: ${response.status} ${await response.text()}`
    );
  }

  const { id } = (await response.json()) as { id: string };

  const jwk = await crypto.subtle.exportKey("jwk", key);
  if (!jwk.k) {
    throw new Error("Failed to export encryption key");
  }

  return {
    url: `https://excalidraw.com/#json=${id},${jwk.k}`,
    shareId: id,
    encryptionKey: jwk.k,
  };
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
