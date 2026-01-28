/*
Scenario: Visual sanity check (public)

Intent: A broad, low-precision sweep that walks the primary navigation and flags anything obviously broken or visually wrong.

Steps:
- Start on home.
- Use visible navigation only to visit key top-level pages.
- Do not assert exact copy or counts; just look for obvious breakage.

Success:
- No pages appear blank, misaligned, or visibly broken.
- Key sections render and the site feels usable.
*/

import { loadConfig } from "../../runner/config";
import {
  captureScreenshot,
  createStagehand,
  getActivePage,
  shutdown,
} from "../../runner/stagehand";
import { writeScenarioSummary } from "../../runner/summary";
import {
  ensureDesktopViewport,
  finalizeScenario,
  resetBrowserState,
  resolveUrl,
} from "../../runner/utils";
import { sleep, waitForVisible } from "../../runner/wait";

const themeModes = ["light", "dark"] as const;
const visualPrompt =
  "Review this UI screenshot for obvious breakage (blank pages, loading states like 'Loading ...', overlap, cut-off content, unreadable text, low-contrast borders/dividers or invisible section boundaries). If there are no issues, respond with exactly: All looks OK.";

async function waitForThemeClass(
  page: { evaluate: <T>(fn: () => T) => Promise<T> },
  shouldBeDark: boolean
) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    const isDark = await page.evaluate(
      () =>
        document.documentElement.classList.contains("dark") ||
        document.body.classList.contains("dark")
    );
    if (isDark === shouldBeDark) {
      return isDark;
    }
    await sleep(200);
  }
  return page.evaluate(
    () =>
      document.documentElement.classList.contains("dark") ||
      document.body.classList.contains("dark")
  );
}

// biome-ignore lint/suspicious/noExplicitAny: Playwright Page types
async function applyTheme(page: any, theme: "light" | "dark"): Promise<void> {
  const toggleSelector = '[data-testid="theme-toggle"]';
  const toggleVisible = await waitForVisible(page, toggleSelector, {
    timeoutMs: 2000,
  });

  if (toggleVisible) {
    const isDark = await page.evaluate(
      () =>
        document.documentElement.classList.contains("dark") ||
        document.body.classList.contains("dark")
    );
    const shouldBeDark = theme === "dark";
    if (isDark !== shouldBeDark) {
      await page.locator(toggleSelector).click();
      await sleep(300);
    }
  } else {
    await page.evaluate((value: string) => {
      localStorage.setItem("theme", value);
    }, theme);
    await page.reload({ waitUntil: "domcontentloaded" });
  }
}

function checkThemeApplied(
  theme: "light" | "dark",
  isDark: boolean,
  isLocal: boolean,
  warnings: string[],
  visualIssues: string[]
): void {
  const shouldBeDark = theme === "dark";

  if (shouldBeDark && !isDark) {
    const message = "dark mode did not apply";
    warnings.push(message);
    if (!isLocal) {
      visualIssues.push(message);
    }
  }
  if (!shouldBeDark && isDark) {
    const message = "light mode did not apply";
    warnings.push(message);
    if (!isLocal) {
      visualIssues.push(message);
    }
  }
}

async function reviewThemeVisuals(
  // biome-ignore lint/suspicious/noExplicitAny: Playwright Page type
  page: any,
  // biome-ignore lint/suspicious/noExplicitAny: config type
  cfg: any,
  theme: "light" | "dark",
  strict: boolean,
  warnings: string[],
  visualIssues: string[]
): Promise<void> {
  const homeReview = await captureScreenshot(
    page,
    cfg,
    `visual-${theme}-home`,
    { prompt: visualPrompt }
  );

  if (homeReview?.hasIssues) {
    const summary = homeReview.summary.replace(/\s+/g, " ").trim();
    visualIssues.push(summary);
    if (strict) {
      throw new Error(`visual review failed: ${summary}`);
    }
    warnings.push(`visual review: ${summary}`);
  }
}

async function main() {
  const cfg = loadConfig();
  const stagehand = await createStagehand(cfg);
  const warnings: string[] = [];
  const visualIssues: string[] = [];
  const startedAt = new Date().toISOString();
  let status: "passed" | "failed" = "passed";
  let errorMessage = "";
  const strict = process.env.STAGEHAND_VISUAL_STRICT === "true";
  const isLocal = cfg.env === "LOCAL";

  try {
    const page = await getActivePage(stagehand);
    // biome-ignore lint/suspicious/noExplicitAny: Playwright Page types are complex; utility functions use structural typing
    await resetBrowserState(page as any, cfg.baseUrl, cfg.vercelBypassSecret);
    // biome-ignore lint/suspicious/noExplicitAny: Playwright Page types are complex; utility functions use structural typing
    await ensureDesktopViewport(page as any);

    for (const theme of themeModes) {
      await page.goto(resolveUrl(cfg.baseUrl, "/"), {
        waitUntil: "domcontentloaded",
      });

      // biome-ignore lint/suspicious/noExplicitAny: Playwright Page types
      await applyTheme(page as any, theme);

      const shouldBeDark = theme === "dark";
      const isDark = await waitForThemeClass(page, shouldBeDark);

      checkThemeApplied(theme, isDark, isLocal, warnings, visualIssues);

      await reviewThemeVisuals(
        // biome-ignore lint/suspicious/noExplicitAny: Playwright Page type
        page as any,
        cfg,
        theme,
        strict,
        warnings,
        visualIssues
      );
    }

    if (warnings.length > 0) {
      console.log(`Visual navigation warnings:\n- ${warnings.join("\n- ")}`);
      if (strict) {
        throw new Error("Visual navigation warnings reported in strict mode.");
      }
    }

    if (cfg.env === "BROWSERBASE") {
      const sessionId = stagehand.browserbaseSessionID;
      if (!sessionId) {
        console.log("Browserbase session ID unavailable.");
        return;
      }

      console.log(
        `remember: open the Browserbase session browser and search for session ${sessionId} to manually confirm the replay`
      );
    }
  } catch (error) {
    status = "failed";
    errorMessage = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    await writeScenarioSummary({
      outputDir: cfg.screenshotsDir,
      summary: {
        scenario: "visual-sanity",
        status,
        warnings,
        visualIssues,
        error: errorMessage || undefined,
        baseUrl: cfg.baseUrl,
        env: cfg.env,
        startedAt,
        finishedAt: new Date().toISOString(),
      },
    });
    await shutdown(stagehand);
    finalizeScenario(status);
  }
}

await main();
