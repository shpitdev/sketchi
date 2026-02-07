/*
Scenario: Excalidraw+ link-share + readonly parsing (Issue #95)

Intent:
- Ensure Sketchi API can parse Excalidraw+ `/l/<workspace>/<scene>` URLs (export service)
  and surface permission metadata.
- Ensure tweak flow accepts Excalidraw+ URLs and returns a new `excalidraw.com/#json=` share link
  without requiring an LLM (explicit edits path).

Steps:
1) Call Sketchi parse endpoint with a known Excalidraw+ `/l/...` URL.
2) Verify `source`, `permission`, and non-empty `elements`.
3) Ensure a known element id exists (guards against upstream scene changes).
4) Call Sketchi tweak endpoint with explicit edits + preferExplicitEdits.
5) Parse returned Excalidraw share link and verify the explicit edit was applied.
*/

import { parseExcalidrawShareLink } from "@sketchi/shared";

const BASE_URL = process.env.STAGEHAND_TARGET_URL || "http://localhost:3001";
const BYPASS_SECRET = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

const PLUS_LINK_URL = "https://link.excalidraw.com/l/9e01NdVniGv/40KFTlwYlBD";
const TARGET_TEXT_ID = "browserbase-playwright_text";
const UPDATED_TEXT = "Browserbase Playwright UPDATED";

const REQUEST_TIMEOUT_MS = 30_000;

function withBypass(url: string, bypassSecret?: string) {
  if (!bypassSecret) {
    return url;
  }
  const parsed = new URL(url);
  parsed.searchParams.set("x-vercel-protection-bypass", bypassSecret);
  return parsed.toString();
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
    const finalUrl = withBypass(url, BYPASS_SECRET);
    if (BYPASS_SECRET) {
      headers.set("x-vercel-protection-bypass", BYPASS_SECRET);
    }

    // In CI we may hit a http->https redirect or canonical-host redirect. Follow at
    // most one redirect so we can preserve bypass param + header.
    let currentUrl = finalUrl;
    for (let i = 0; i < 2; i++) {
      const response = await fetch(currentUrl, {
        ...init,
        headers,
        signal: controller.signal,
        redirect: "manual",
      });

      if (
        response.status === 301 ||
        response.status === 302 ||
        response.status === 303 ||
        response.status === 307 ||
        response.status === 308
      ) {
        const location = response.headers.get("location");
        if (location && i === 0) {
          const next = new URL(location, currentUrl).toString();
          currentUrl = withBypass(next, BYPASS_SECRET);
          continue;
        }
      }

      const contentType = response.headers.get("content-type") || "";
      const raw = await response.text();
      try {
        const json = JSON.parse(raw) as unknown;
        return { status: response.status, json, headers: response.headers };
      } catch {
        const location = response.headers.get("location");
        throw new Error(
          [
            `Failed to parse JSON (status=${response.status})`,
            `url=${currentUrl}`,
            `content-type=${contentType || "(missing)"}`,
            location ? `location=${location}` : null,
            `body=${raw.slice(0, 300)}`,
          ]
            .filter(Boolean)
            .join(" ")
        );
      }
    }

    throw new Error(`Too many redirects fetching ${finalUrl}`);
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

  // Step 2: Tweak via Sketchi API (explicit edits path, no LLM)
  console.log("\n[2/3] Tweaking via Sketchi API (explicit edits)...");
  const tweakUrl = new URL("/api/diagrams/tweak", BASE_URL);
  const tweak = await fetchJson(tweakUrl.toString(), {
    method: "POST",
    timeoutMs: REQUEST_TIMEOUT_MS,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      shareUrl: PLUS_LINK_URL,
      request: `${TARGET_TEXT_ID} text = '${UPDATED_TEXT}' ${TARGET_TEXT_ID} originalText = '${UPDATED_TEXT}'`,
      options: { preferExplicitEdits: true },
    }),
  });

  if (tweak.status !== 200) {
    throw new Error(
      `tweak failed: status=${tweak.status} body=${JSON.stringify(tweak.json).slice(0, 500)}`
    );
  }
  const tweakBody = tweak.json as {
    status?: string;
    shareLink?: { url?: string };
  };
  if (tweakBody.status !== "success") {
    throw new Error(`tweak returned status=${String(tweakBody.status)}`);
  }
  const shareUrl = tweakBody.shareLink?.url;
  if (!shareUrl?.includes("#json=")) {
    throw new Error("tweak response missing shareLink.url");
  }
  console.log(`  Share URL: ${shareUrl.slice(0, 80)}...`);

  // Step 3: Parse returned share link and validate edit applied
  console.log("\n[3/3] Parsing returned share link and validating edit...");
  const shareParsed = await parseExcalidrawShareLink(shareUrl);
  if (
    !Array.isArray(shareParsed.elements) ||
    shareParsed.elements.length === 0
  ) {
    throw new Error("parsed share link missing elements");
  }
  const updatedElement = shareParsed.elements.find(
    (el) => (el as { id?: unknown } | null)?.id === TARGET_TEXT_ID
  ) as { text?: unknown } | undefined;
  if (updatedElement?.text !== UPDATED_TEXT) {
    throw new Error(
      `expected '${TARGET_TEXT_ID}.text' to be updated to '${UPDATED_TEXT}'`
    );
  }

  console.log("\nTEST PASSED: Excalidraw+ URL parsed and tweaked successfully");
}

main().catch((error) => {
  const message =
    error instanceof Error ? error.stack || error.message : String(error);
  console.error("\nTEST FAILED:", message);
  process.exitCode = 1;
});
