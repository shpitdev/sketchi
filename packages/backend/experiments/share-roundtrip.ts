// Experiment 0.1: Share Link Round-Trip
// Run: bun run packages/backend/experiments/share-roundtrip.ts

const EXCALIDRAW_SHARE_URL_PATTERN = /#json=([^,]+),(.+)$/;
const EXCALIDRAW_POST_URL = "https://json.excalidraw.com/api/v2/post/";
const EXCALIDRAW_GET_URL = "https://json.excalidraw.com/api/v2/";
const IV_BYTE_LENGTH = 12;
const AES_GCM_KEY_LENGTH = 128;

async function shareToExcalidraw(
  elements: unknown[],
  appState: Record<string, unknown> = {}
): Promise<{ url: string; shareId: string; encryptionKey: string }> {
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

async function parseExcalidrawLink(
  url: string
): Promise<{ elements: unknown[]; appState: Record<string, unknown> }> {
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

  return JSON.parse(new TextDecoder().decode(decrypted));
}

async function testRoundTrip() {
  console.log("=== Experiment 0.1: Share Link Round-Trip ===\n");

  const testElements = [
    {
      type: "rectangle",
      id: "rect1",
      x: 100,
      y: 100,
      width: 200,
      height: 100,
      backgroundColor: "#a5d8ff",
      label: { text: "Test Node" },
    },
    {
      type: "arrow",
      id: "arrow1",
      x: 150,
      y: 200,
      width: 100,
      height: 50,
      start: { id: "rect1" },
      end: { type: "ellipse" },
    },
  ];

  console.log("1. Original elements:", JSON.stringify(testElements, null, 2));

  console.log("\n2. Creating share link...");
  const { url, shareId, encryptionKey } = await shareToExcalidraw(
    testElements,
    { viewBackgroundColor: "#ffffff" }
  );
  console.log("   Share URL:", url);
  console.log("   Share ID:", shareId);
  console.log("   Key length:", encryptionKey.length, "chars");

  console.log("\n3. Parsing share link...");
  const parsed = await parseExcalidrawLink(url);
  console.log("   Parsed elements count:", parsed.elements.length);
  console.log("   Parsed appState keys:", Object.keys(parsed.appState));

  const originalJson = JSON.stringify(testElements);
  const parsedJson = JSON.stringify(parsed.elements);
  const elementsMatch = originalJson === parsedJson;

  console.log("\n4. Verification:");
  console.log("   Elements match:", elementsMatch ? "YES" : "NO");

  if (!elementsMatch) {
    console.log("   Diff:", {
      original: testElements,
      parsed: parsed.elements,
    });
  }

  console.log("\n5. Manual verification:");
  console.log("   Open this URL in browser:", url);
  console.log(
    "   Should see: Rectangle with 'Test Node' label + arrow to ellipse"
  );

  return { success: elementsMatch, url };
}

testRoundTrip().then((result) => {
  console.log("\n=== RESULT:", result.success ? "PASS" : "FAIL", "===");
  process.exit(result.success ? 0 : 1);
});
