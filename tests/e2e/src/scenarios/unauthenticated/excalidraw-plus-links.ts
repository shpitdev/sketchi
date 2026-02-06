/*
Scenario: Excalidraw+ link-share + readonly parsing (Issue #95)

Intent:
- Ensure Sketchi API can parse Excalidraw+ `/l/<workspace>/<scene>` URLs (export service)
  and surface permission metadata.
- Ensure modify flow accepts Excalidraw+ URLs and returns a new `excalidraw.com/#json=` share link
  without requiring an LLM (explicit edits path).

Steps:
1) Call Sketchi parse endpoint with a known Excalidraw+ `/l/...` URL.
2) Verify `source`, `permission`, and non-empty `elements`.
3) Ensure a known element id exists (guards against upstream scene changes).
4) Call Sketchi modify endpoint with explicit edits + preferExplicitEdits.
5) Parse returned Excalidraw share link and render to PNG via Playwright harness.
*/

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseExcalidrawShareLink } from "@sketchi/shared";
import { chromium } from "playwright";

const BASE_URL = process.env.STAGEHAND_TARGET_URL || "http://localhost:3001";
const BYPASS_SECRET = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

const PLUS_LINK_URL = "https://link.excalidraw.com/l/9e01NdVniGv/40KFTlwYlBD";
const TARGET_TEXT_ID = "browserbase-playwright_text";
const UPDATED_TEXT = "Browserbase Playwright UPDATED";

const OUTPUT_DIR = join(import.meta.dir, "../../../artifacts");
const OUTPUT_PNG = join(OUTPUT_DIR, "excalidraw-plus-modify.png");

const REQUEST_TIMEOUT_MS = 30_000;

const EXPORT_HARNESS_HTML = `
<!DOCTYPE html>
<html>
<head>
  <script type="importmap">
  { "imports": { "@excalidraw/excalidraw": "https://esm.sh/@excalidraw/excalidraw@0.18.0" } }
  </script>
</head>
<body>
  <div id="status">Loading...</div>
  <script type="module">
    import { exportToBlob } from "https://esm.sh/@excalidraw/excalidraw@0.18.0";
    window.exportPng = async function(elements, options = {}) {
      const { scale = 2, padding = 20, background = true, backgroundColor = "#ffffff" } = options;
      const blob = await exportToBlob({
        elements,
        appState: { exportScale: scale, exportBackground: background, viewBackgroundColor: backgroundColor },
        files: null,
        exportPadding: padding,
        mimeType: "image/png",
      });
      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
      return btoa(binary);
    };
    window.exportReady = true;
    document.getElementById('status').textContent = 'Ready';
  </script>
</body>
</html>
`;

async function renderElementsToPng(
  elements: Record<string, unknown>[]
): Promise<Buffer> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto("about:blank");
    await page.evaluate((html) => {
      document.open();
      document.write(html);
      document.close();
    }, EXPORT_HARNESS_HTML);

    await page.waitForFunction("window.exportReady === true", {
      timeout: REQUEST_TIMEOUT_MS,
    });

    const base64Png = (await page.evaluate(
      async ({ elements }) => {
        // biome-ignore lint/suspicious/noExplicitAny: injected by harness
        return await (window as any).exportPng(elements, {
          scale: 2,
          padding: 20,
          background: true,
          backgroundColor: "#ffffff",
        });
      },
      { elements }
    )) as string;

    return Buffer.from(base64Png, "base64");
  } finally {
    await context.close();
    await browser.close();
  }
}

async function fetchJson(
  url: string,
  init?: RequestInit & { timeoutMs?: number }
): Promise<{ status: number; json: unknown; headers: Headers }> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    init?.timeoutMs ?? REQUEST_TIMEOUT_MS
  );

  try {
    const headers = new Headers(init?.headers);
    if (BYPASS_SECRET) {
      headers.set("x-vercel-protection-bypass", BYPASS_SECRET);
      headers.set("x-vercel-set-bypass-cookie", "true");
    }

    const response = await fetch(url, {
      ...init,
      headers,
      signal: controller.signal,
    });
    const json = (await response.json()) as unknown;
    return { status: response.status, json, headers: response.headers };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  console.log("Excalidraw+ Link Parsing Test (Issue #95)");
  console.log("=".repeat(60));
  console.log(`Base URL: ${BASE_URL}`);

  // Step 1: Parse via Sketchi API
  console.log("\n[1/3] Parsing Excalidraw+ /l URL via Sketchi API...");
  const parseUrl = new URL("/api/diagrams/parse", BASE_URL);
  parseUrl.searchParams.set("shareUrl", PLUS_LINK_URL);

  const parsed = await fetchJson(parseUrl.toString(), {
    method: "GET",
    timeoutMs: REQUEST_TIMEOUT_MS,
  });

  if (parsed.status !== 200) {
    throw new Error(
      `parse failed: status=${parsed.status} body=${JSON.stringify(parsed.json).slice(0, 500)}`
    );
  }

  const parsedBody = parsed.json as {
    source?: string;
    permission?: string;
    elements?: unknown[];
  };

  if (parsedBody.source !== "excalidraw-plus-link") {
    throw new Error(`unexpected source: ${String(parsedBody.source)}`);
  }
  if (parsedBody.permission !== "read-only") {
    throw new Error(`unexpected permission: ${String(parsedBody.permission)}`);
  }
  if (!Array.isArray(parsedBody.elements) || parsedBody.elements.length === 0) {
    throw new Error("parse response missing elements");
  }

  const hasTargetId = parsedBody.elements.some(
    (el) => (el as { id?: unknown } | null)?.id === TARGET_TEXT_ID
  );
  if (!hasTargetId) {
    throw new Error(
      `expected element id '${TARGET_TEXT_ID}' not found; upstream scene likely changed`
    );
  }
  console.log(`  Elements: ${parsedBody.elements.length}`);

  // Step 2: Modify via Sketchi API (explicit edits path, no LLM)
  console.log("\n[2/3] Modifying via Sketchi API (explicit edits)...");
  const modifyUrl = new URL("/api/diagrams/modify", BASE_URL);
  const modify = await fetchJson(modifyUrl.toString(), {
    method: "POST",
    timeoutMs: REQUEST_TIMEOUT_MS,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      shareUrl: PLUS_LINK_URL,
      request: `${TARGET_TEXT_ID} text = '${UPDATED_TEXT}' ${TARGET_TEXT_ID} originalText = '${UPDATED_TEXT}'`,
      options: { preferExplicitEdits: true },
    }),
  });

  if (modify.status !== 200) {
    throw new Error(
      `modify failed: status=${modify.status} body=${JSON.stringify(modify.json).slice(0, 500)}`
    );
  }
  const modifyBody = modify.json as {
    status?: string;
    shareLink?: { url?: string };
  };
  if (modifyBody.status !== "success") {
    throw new Error(`modify returned status=${String(modifyBody.status)}`);
  }
  const shareUrl = modifyBody.shareLink?.url;
  if (!shareUrl?.includes("#json=")) {
    throw new Error("modify response missing shareLink.url");
  }
  console.log(`  Share URL: ${shareUrl.slice(0, 80)}...`);

  // Step 3: Parse returned share link and render to PNG
  console.log("\n[3/3] Parsing returned share link and rendering PNG...");
  const shareParsed = await parseExcalidrawShareLink(shareUrl);
  if (
    !Array.isArray(shareParsed.elements) ||
    shareParsed.elements.length === 0
  ) {
    throw new Error("parsed share link missing elements");
  }
  const png = await renderElementsToPng(
    shareParsed.elements as Record<string, unknown>[]
  );
  if (png.length === 0) {
    throw new Error("rendered PNG was empty");
  }

  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(OUTPUT_PNG, png);
  console.log(`  Wrote PNG: ${OUTPUT_PNG} (${png.length} bytes)`);

  console.log(
    "\nTEST PASSED: Excalidraw+ URL parsed and modified successfully"
  );
}

main().catch((error) => {
  const message =
    error instanceof Error ? error.stack || error.message : String(error);
  console.error("\nTEST FAILED:", message);
  process.exitCode = 1;
});
