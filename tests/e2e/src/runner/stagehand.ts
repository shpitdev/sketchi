import fs from "node:fs/promises";
import path from "node:path";
import { CustomOpenAIClient, Stagehand } from "@browserbasehq/stagehand";
import OpenAI from "openai";
import type { StagehandRunConfig } from "./config";
import {
  persistReviewReport,
  reviewScreenshotWithOpenRouter,
  type VisualReviewResult,
} from "./visual-review";

export interface ActResult {
  success?: boolean;
  message?: string;
  actionDescription?: string;
}

export async function createStagehand(cfg: StagehandRunConfig) {
  const llmClient = new CustomOpenAIClient({
    modelName: cfg.modelName,
    client: new OpenAI({
      apiKey: cfg.openrouterApiKey,
      baseURL: "https://openrouter.ai/api/v1",
    }),
  });
  const stagehand = new Stagehand({
    env: cfg.env,
    apiKey: cfg.browserbaseApiKey,
    projectId: cfg.browserbaseProjectId,
    cacheDir: cfg.cacheDir,
    verbose: cfg.verbose,
    model: {
      modelName: cfg.modelName,
    },
    llmClient,
    localBrowserLaunchOptions:
      cfg.env === "LOCAL"
        ? {
            headless: cfg.headless,
            executablePath: cfg.chromePath || undefined,
          }
        : undefined,
  });

  await stagehand.init();
  await applyVercelBypassHeaders(stagehand.context, cfg);
  return stagehand;
}

const popupBlockerAttached = new WeakSet<object>();

async function applyVercelBypassHeaders(
  context: {
    setExtraHTTPHeaders?: (headers: Record<string, string>) => Promise<void>;
    pages?: () => Array<{ setExtraHTTPHeaders?: (headers: Record<string, string>) => Promise<void> }>;
  },
  cfg: StagehandRunConfig
) {
  if (!cfg.vercelBypassSecret) {
    return;
  }
  const headers = {
    "x-vercel-protection-bypass": cfg.vercelBypassSecret,
    "x-vercel-set-bypass-cookie": "true",
  };
  if (typeof context.setExtraHTTPHeaders === "function") {
    await context.setExtraHTTPHeaders(headers);
    return;
  }
  if (typeof context.pages === "function") {
    const pages = context.pages();
    await Promise.all(
      pages.map((page) =>
        typeof page.setExtraHTTPHeaders === "function"
          ? page.setExtraHTTPHeaders(headers)
          : Promise.resolve()
      )
    );
  }
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

export async function shutdown(stagehand: Stagehand) {
  try {
    await stagehand.close();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`Stagehand shutdown warning: ${message}`);
  }
}
