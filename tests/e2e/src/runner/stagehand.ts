import fs from "node:fs/promises";
import path from "node:path";
import { Stagehand } from "@browserbasehq/stagehand";
import type { StagehandRunConfig } from "./config";
import {
  persistReviewReport,
  reviewScreenshotWithOpenRouter,
  type VisualReviewResult,
} from "./visual-review";

export interface ActResult {
  actionDescription?: string;
  message?: string;
  success?: boolean;
}

function buildBrowserbaseSessionCreateParams(cfg: StagehandRunConfig) {
  if (cfg.env !== "BROWSERBASE") {
    return undefined;
  }

  return {
    ...(cfg.browserbaseRegion ? { region: cfg.browserbaseRegion } : {}),
    ...(cfg.browserbaseSessionTimeoutSeconds
      ? { timeout: cfg.browserbaseSessionTimeoutSeconds }
      : {}),
  };
}

export async function createStagehand(cfg: StagehandRunConfig) {
  const browserbaseSessionCreateParams =
    buildBrowserbaseSessionCreateParams(cfg);
  const maxAttempts = cfg.env === "BROWSERBASE" ? 3 : 1;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const stagehand = new Stagehand({
      env: cfg.env,
      apiKey: cfg.browserbaseApiKey,
      projectId: cfg.browserbaseProjectId,
      browserbaseSessionCreateParams,
      cacheDir: cfg.cacheDir,
      verbose: cfg.verbose,
      model: {
        modelName: cfg.modelName,
        apiKey: cfg.openrouterApiKey,
        baseURL: "https://openrouter.ai/api/v1",
      },
      localBrowserLaunchOptions:
        cfg.env === "LOCAL"
          ? {
              headless: cfg.headless,
              executablePath: cfg.chromePath || undefined,
            }
          : undefined,
    });

    try {
      await stagehand.init();
      await applyVercelBypassCookie(stagehand.context, cfg);
      await persistBrowserbaseSessionMetadata(stagehand, cfg);
      return stagehand;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (
        cfg.env !== "BROWSERBASE" ||
        attempt === maxAttempts ||
        !isRetryableBrowserbaseError(message)
      ) {
        await shutdown(stagehand);
        throw error;
      }
      console.log(
        `Stagehand init failed (attempt ${attempt}/${maxAttempts}): ${message}`
      );
      await shutdown(stagehand);
      await delay(1000 * attempt);
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error(String(lastError ?? "Stagehand init failed"));
}

async function persistBrowserbaseSessionMetadata(
  stagehand: Stagehand,
  cfg: StagehandRunConfig
) {
  if (cfg.env !== "BROWSERBASE") {
    return;
  }

  const sessionId = stagehand.browserbaseSessionID;
  const sessionUrl = stagehand.browserbaseSessionURL;
  const debugUrl = stagehand.browserbaseDebugURL;
  if (!(sessionId || sessionUrl || debugUrl)) {
    return;
  }

  const metadataPath = path.join(
    cfg.screenshotsDir,
    "browserbase-sessions.jsonl"
  );
  const record = {
    capturedAt: new Date().toISOString(),
    scenario: path.basename(process.argv[1] ?? ""),
    baseUrl: cfg.baseUrl,
    sessionId: sessionId ?? null,
    sessionUrl: sessionUrl ?? null,
    debugUrl: debugUrl ?? null,
  };

  try {
    await fs.mkdir(cfg.screenshotsDir, { recursive: true });
    await fs.appendFile(metadataPath, `${JSON.stringify(record)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`Browserbase session metadata write failed: ${message}`);
  }

  if (sessionUrl) {
    console.log(`Browserbase replay URL: ${sessionUrl}`);
  } else if (sessionId) {
    console.log(`Browserbase session ID: ${sessionId}`);
  }
}

function isRetryableBrowserbaseError(message: string) {
  return (
    message.includes("Expected 101 status code") ||
    message.includes("WebSocket connection") ||
    message.toLowerCase().includes("browserbase")
  );
}

function delay(durationMs: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

function withTimeout<T>(
  task: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    if (typeof timeoutId.unref === "function") {
      timeoutId.unref();
    }

    task.then(
      (result) => {
        clearTimeout(timeoutId);
        resolve(result);
      },
      (error) => {
        clearTimeout(timeoutId);
        reject(error);
      }
    );
  });
}

const popupBlockerAttached = new WeakSet<object>();

async function applyVercelBypassCookie(
  context: Stagehand["context"],
  cfg: StagehandRunConfig
) {
  if (!cfg.vercelBypassSecret) {
    return;
  }
  // Stagehand 3 uses CDP-based pages without setExtraHTTPHeaders.
  // Instead, inject the Vercel bypass cookie via init script so it's
  // sent automatically on every request.
  await context.addInitScript((secret: string) => {
    // biome-ignore lint/suspicious/noDocumentCookie: runs in browser context via CDP
    document.cookie = `x-vercel-protection-bypass=${secret}; path=/`;
  }, cfg.vercelBypassSecret);
}

async function attachPopupBlocker(page: {
  addInitScript?: (script: () => void) => Promise<void>;
}) {
  if (process.env.STAGEHAND_ALLOW_POPUPS === "1") {
    return;
  }
  if (popupBlockerAttached.has(page)) {
    return;
  }
  popupBlockerAttached.add(page);

  if (typeof page.addInitScript === "function") {
    await page.addInitScript(() => {
      window.open = () => null;
      document.addEventListener(
        "click",
        (event) => {
          const target = event.target as HTMLElement | null;
          const anchor = target?.closest?.("a");
          if (anchor?.getAttribute("target") === "_blank") {
            anchor.setAttribute("target", "_self");
          }
        },
        { capture: true }
      );
    });
  }
}

export async function getActivePage(stagehand: Stagehand) {
  const pages = stagehand.context.pages();
  if (pages.length > 0) {
    const page = pages[0];
    await attachPopupBlocker(page);
    return page;
  }
  if ("awaitActivePage" in stagehand.context) {
    const active = await stagehand.context.awaitActivePage();
    if (active) {
      await attachPopupBlocker(active);
      return active;
    }
  }
  const page = await stagehand.context.newPage();
  await attachPopupBlocker(page);
  return page;
}

export function isSoftCompletion(result?: ActResult) {
  const message = result?.message?.toLowerCase() ?? "";
  return message.includes("task execution completed");
}

export async function captureScreenshot(
  page: {
    screenshot: (options: {
      path: string;
      fullPage: boolean;
    }) => Promise<unknown>;
    evaluate?: <T>(fn: () => T) => Promise<T>;
    locator?: (selector: string) => {
      screenshot: (options: { path: string }) => Promise<unknown>;
    };
  },
  cfg: StagehandRunConfig,
  name: string,
  options?: { selector?: string; prompt?: string }
): Promise<VisualReviewResult | null> {
  if (!cfg.screenshotsEnabled) {
    return null;
  }
  await fs.mkdir(cfg.screenshotsDir, { recursive: true });
  const filename = `${name}.png`;
  const filepath = path.join(cfg.screenshotsDir, filename);
  let screenshotCaptured = false;
  if (typeof page.evaluate === "function") {
    try {
      await page.evaluate(() => window.scrollTo(0, 0));
    } catch {
      // ignore scroll failures
    }
  }
  try {
    if (options?.selector && page.locator) {
      const locator = page.locator(options.selector);
      if (typeof locator?.screenshot === "function") {
        await locator.screenshot({ path: filepath });
      } else {
        await page.screenshot({ path: filepath, fullPage: true });
      }
    } else {
      await page.screenshot({ path: filepath, fullPage: true });
    }
    screenshotCaptured = true;
  } catch (error) {
    const notePath = path.join(cfg.screenshotsDir, `${name}.txt`);
    const message =
      error instanceof Error ? error.message : "Failed to capture screenshot";
    await fs.writeFile(notePath, `screenshot failed: ${message}\n`);
  }

  if (!screenshotCaptured) {
    return null;
  }

  try {
    const review = await reviewScreenshotWithOpenRouter({
      imagePath: filepath,
      baseUrl: cfg.baseUrl,
      apiKey: cfg.openrouterApiKey,
      modelName: cfg.visionModelName,
      prompt: options?.prompt,
    });
    await persistReviewReport({
      outputDir: cfg.screenshotsDir,
      sessionId: name,
      summary: review.summary,
    });
    if (review.hasIssues) {
      console.log(`Visual review issues for ${name}: ${review.summary}`);
    }
    return review;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`Visual review failed for ${name}: ${message}`);
    return null;
  }
}

export async function shutdown(stagehand: Stagehand, timeoutMs = 10_000) {
  try {
    await withTimeout(stagehand.close(), timeoutMs, "Stagehand close");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`Stagehand shutdown warning: ${message}`);
  }
}
