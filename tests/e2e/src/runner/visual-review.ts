import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { chromium } from "@playwright/test";

const require = createRequire(import.meta.url);
const RRWEB_PLAYER_ROOT = path.dirname(
  require.resolve("rrweb-player/package.json")
);
const RRWEB_PLAYER_JS = path.join(RRWEB_PLAYER_ROOT, "dist", "index.js");
const RRWEB_PLAYER_CSS = path.join(RRWEB_PLAYER_ROOT, "dist", "style.css");

export interface VisualReviewResult {
  summary: string;
  hasIssues: boolean;
  framesCaptured: number;
}

interface RrwebEvent {
  timestamp: number;
  type: number;
  data?: Record<string, unknown>;
}

export async function renderRrwebFrames(params: {
  recordingPath: string;
  frameCount?: number;
  speed?: number;
  maxPlaybackMs?: number;
}): Promise<{
  frames: Buffer[];
  durationMs: number;
  width: number;
  height: number;
}> {
  const { recordingPath } = params;
  const frameCount = Math.max(params.frameCount ?? 4, 1);
  const speed = normalizeSpeed(params.speed ?? 4);
  const maxPlaybackMs = params.maxPlaybackMs ?? 20_000;

  const raw = await fs.readFile(recordingPath, "utf8");
  const events = JSON.parse(raw) as RrwebEvent[];
  if (!Array.isArray(events) || events.length === 0) {
    throw new Error("Recording did not contain any rrweb events.");
  }

  const { width, height } = resolveViewport(events);
  const durationMs = Math.max(0, events.at(-1).timestamp - events[0].timestamp);
  const playbackMs = Math.min(durationMs / speed, maxPlaybackMs);
  const intervalMs = frameCount > 1 ? playbackMs / (frameCount - 1) : 0;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    html, body, #player { margin: 0; padding: 0; width: 100%; height: 100%; background: #0b0b0b; }
    .rr-player { width: 100% !important; height: 100% !important; }
  </style>
</head>
<body>
  <div id="player"></div>
</body>
</html>`;

  await page.setContent(html, { waitUntil: "domcontentloaded" });
  await page.addStyleTag({ path: RRWEB_PLAYER_CSS });
  await page.addScriptTag({ path: RRWEB_PLAYER_JS });
  await page.waitForFunction(() => "rrwebPlayer" in window);

  await page.evaluate(
    ({ events: injectedEvents, speed: injectedSpeed }) => {
      // @ts-expect-error rrwebPlayer injected at runtime
      window.__player = new window.rrwebPlayer({
        target: document.getElementById("player"),
        props: {
          events: injectedEvents,
          autoPlay: true,
          speed: injectedSpeed,
          skipInactive: true,
          showController: false,
        },
      });
      // @ts-expect-error marker for async ready state
      window.__playerReady = true;
    },
    { events, speed }
  );

  await page.waitForFunction(
    () => (window as unknown as { __playerReady?: boolean }).__playerReady
  );
  await page.waitForTimeout(1000);

  const frames: Buffer[] = [];
  for (let i = 0; i < frameCount; i += 1) {
    frames.push(await page.screenshot({ type: "png" }));
    if (intervalMs > 0 && i < frameCount - 1) {
      await page.waitForTimeout(intervalMs);
    }
  }

  await context.close();
  await browser.close();

  return { frames, durationMs, width, height };
}

export async function reviewScreenshotWithOpenRouter(params: {
  imagePath: string;
  modelName?: string;
  apiKey?: string;
  baseUrl?: string;
  appName?: string;
  prompt?: string;
}): Promise<VisualReviewResult> {
  const apiKey = params.apiKey?.trim() || process.env.OPENROUTER_API_KEY || "";
  if (!apiKey) {
    return {
      summary: "Visual review skipped (OPENROUTER_API_KEY not set).",
      hasIssues: false,
      framesCaptured: 1,
    };
  }

  const modelName =
    params.modelName?.trim() || process.env.VISION_MODEL_NAME || "";
  if (!modelName) {
    return {
      summary: "Visual review skipped (VISION_MODEL_NAME not set).",
      hasIssues: false,
      framesCaptured: 1,
    };
  }

  const prompt =
    params.prompt ??
    "Review this UI screenshot for obvious visual issues (broken layout, missing content, overlap, unreadable text, empty sections). If anything looks wrong, describe it in 1-4 bullets. If there are no issues, respond with exactly: All looks OK.";

  const imageBuffer = await fs.readFile(params.imagePath);
  const imageUrl = buildDataUrl(params.imagePath, imageBuffer);
  const referer = resolveOpenRouterReferer(params.baseUrl);
  const title = resolveOpenRouterTitle(params.baseUrl, params.appName);

  const response = await fetch(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": referer,
        "X-Title": title,
      },
      body: JSON.stringify({
        model: modelName,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              {
                type: "image_url",
                image_url: { url: imageUrl },
              },
            ],
          },
        ],
        max_tokens: 400,
      }),
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `OpenRouter visual review failed (${response.status}): ${body}`
    );
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const summary = payload.choices?.[0]?.message?.content ?? "";
  const hasIssues = containsIssueSignals(summary);

  return {
    summary: summary || "(no response)",
    hasIssues,
    framesCaptured: 1,
  };
}

export async function persistReviewReport(params: {
  outputDir: string;
  sessionId: string;
  summary: string;
}) {
  await fs.mkdir(params.outputDir, { recursive: true });
  const filePath = path.join(
    params.outputDir,
    `visual-review-${params.sessionId}.txt`
  );
  await fs.writeFile(filePath, params.summary);
  return filePath;
}

function buildDataUrl(imagePath: string, imageBuffer: Buffer) {
  const extension = path.extname(imagePath).toLowerCase();
  const mimeType = extension === ".png" ? "image/png" : "image/jpeg";
  return `data:${mimeType};base64,${imageBuffer.toString("base64")}`;
}

function resolveOpenRouterReferer(baseUrl?: string) {
  if (!baseUrl) {
    return "https://sketchi.app";
  }
  try {
    const url = new URL(baseUrl);
    const hostname = url.hostname.toLowerCase();
    if (hostname.includes("localhost")) {
      return "http://localhost:3001";
    }
    if (hostname.endsWith("sketchi.app")) {
      return "https://sketchi.app";
    }
    return url.origin;
  } catch {
    return baseUrl;
  }
}

function resolveOpenRouterTitle(baseUrl?: string, appName?: string) {
  if (appName?.trim()) {
    return appName.trim();
  }
  if (!baseUrl) {
    return "sketchi";
  }
  try {
    const url = new URL(baseUrl);
    const hostname = url.hostname.toLowerCase();
    if (hostname.includes("preview")) {
      return "sketchi (preview)";
    }
    if (hostname.includes("localhost")) {
      return "sketchi (local)";
    }
  } catch {
    return "sketchi";
  }
  return "sketchi";
}

function resolveViewport(events: RrwebEvent[]) {
  for (const event of events) {
    const data = event.data as { width?: number; height?: number } | undefined;
    if (data?.width && data?.height) {
      return {
        width: clampDimension(data.width, 640, 1920),
        height: clampDimension(data.height, 480, 1080),
      };
    }
  }
  return { width: 1280, height: 720 };
}

function clampDimension(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function normalizeSpeed(value: number) {
  if (value <= 1) {
    return 1;
  }
  if (value <= 2) {
    return 2;
  }
  if (value <= 4) {
    return 4;
  }
  return 8;
}

function containsIssueSignals(text: string) {
  const lower = text.toLowerCase();
  const trimmed = lower.trim();
  if (trimmed === "all looks ok" || trimmed === "all looks okay") {
    return false;
  }
  if (
    (lower.includes("all looks ok") || lower.includes("all looks okay")) &&
    !lower.includes("but") &&
    !lower.includes("however") &&
    !lower.includes("except")
  ) {
    return false;
  }
  return [
    "issue",
    "broken",
    "error",
    "missing",
    "overlap",
    "misaligned",
    "cut off",
    "blank",
    "unreadable",
    "wrong",
  ].some((signal) => lower.includes(signal));
}
