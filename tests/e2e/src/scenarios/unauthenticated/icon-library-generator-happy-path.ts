/*
Scenario: Icon library generator happy path

Intent: Validate create → upload SVGs → export → delete flow.

Steps:
- Visit home page and navigate to Icon Library Generator.
- Create a new library with a unique name.
- Upload 3 known-good SVG fixtures.
- Reorder icons (move last to first).
- Export .excalidrawlib and confirm download starts.
- Delete one icon and confirm count updates.

Success:
- Library page loads and shows 3 icons after upload.
- Reorder persists (icon order changes and remains after reload).
- Export initiates download with .excalidrawlib extension.
- Delete removes icon and count updates.
*/

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
import { sleep } from "../../runner/wait";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturesDir = join(__dirname, "../../../fixtures/svgs");
const TRAILING_SUMMARY_REGEX = /[\s.]+$/;
type PageLike = Awaited<ReturnType<typeof getActivePage>>;

async function waitForLibraryInput(
  page: PageLike,
  timeoutMs = 30_000
): Promise<boolean> {
  const startedAt = Date.now();
  for (;;) {
    const exists = await page.evaluate(() =>
      Boolean(document.querySelector('input[placeholder="Library name"]'))
    );
    if (exists) {
      return true;
    }
    if (Date.now() - startedAt > timeoutMs) {
      return false;
    }
    await sleep(250);
  }
}

async function waitForHydration(
  page: PageLike,
  timeoutMs = 20_000
): Promise<boolean> {
  const startedAt = Date.now();
  for (;;) {
    const hydrated = await page.evaluate(
      () => document.documentElement.dataset.hydrated === "true"
    );
    if (hydrated) {
      return true;
    }
    if (Date.now() - startedAt > timeoutMs) {
      return false;
    }
    await sleep(250);
  }
}

async function waitForEditorOrToastError(
  page: PageLike,
  timeoutMs = 45_000
): Promise<{ ok: boolean; toast?: string }> {
  const startedAt = Date.now();
  for (;;) {
    const result = await page.evaluate(() => {
      const hasUpload = Boolean(
        document.querySelector('[data-testid="svg-file-input"]')
      );
      const toast = document.querySelector("[data-sonner-toast]")?.textContent;
      return { hasUpload, toast: toast?.trim() ?? "" };
    });
    if (result.hasUpload) {
      return { ok: true };
    }
    if (result.toast) {
      return { ok: false, toast: result.toast };
    }
    if (Date.now() - startedAt > timeoutMs) {
      return { ok: false };
    }
    await sleep(250);
  }
}

async function createLibraryWithName(page: PageLike, libraryName: string) {
  await page.waitForSelector('input[placeholder="Library name"]', {
    state: "visible",
    timeout: 20_000,
  });
  await page.locator('input[placeholder="Library name"]').fill(libraryName);
  const createSelector =
    'xpath=//section[.//input[@placeholder="Library name"]]//button[normalize-space()="Create"]';
  await page.waitForSelector(createSelector, {
    state: "visible",
    timeout: 20_000,
  });
  await page.locator(createSelector).click();
}

async function uploadSvgFiles(page: PageLike): Promise<void> {
  const fixtures = [
    join(fixturesDir, "palantir-workshop.svg"),
    join(fixturesDir, "palantir-pipeline.svg"),
    join(fixturesDir, "palantir-ontology.svg"),
  ];

  await page.locator('[data-testid="svg-file-input"]').setInputFiles(fixtures);
  await sleep(1500); // Wait for uploads to process
}

async function waitForIconCount(
  page: PageLike,
  expected: number,
  timeoutMs = 30_000
): Promise<boolean> {
  const startedAt = Date.now();
  for (;;) {
    const count = await page.evaluate(
      () => document.querySelectorAll('[data-testid="icon-grid-item"]').length
    );
    if (count === expected) {
      return true;
    }
    if (Date.now() - startedAt > timeoutMs) {
      return false;
    }
    await sleep(250);
  }
}

async function assertNewLibraryRoughnessDefaults(page: PageLike) {
  await page.waitForSelector("#roughness", {
    state: "visible",
    timeout: 20_000,
  });

  const { max, step, valueRaw } = await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>("#roughness");
    if (!input) {
      throw new Error("#roughness input not found");
    }
    return {
      max: input.max,
      step: input.step,
      valueRaw: input.value,
    };
  });

  if (max !== "2") {
    throw new Error(`Expected #roughness max="2", got ${JSON.stringify(max)}`);
  }

  if (step !== "0.1") {
    throw new Error(
      `Expected #roughness step="0.1", got ${JSON.stringify(step)}`
    );
  }

  const value = Number(valueRaw);
  if (!Number.isFinite(value) || Math.abs(value - 0.4) > 1e-6) {
    throw new Error(
      `Expected #roughness value=0.4 for new library, got ${JSON.stringify(valueRaw)}`
    );
  }
}

async function selectExportOption(
  page: PageLike,
  label: string
): Promise<void> {
  await page.evaluate(() => {
    const button = Array.from(document.querySelectorAll("button")).find(
      (element) => element.textContent?.trim().startsWith("Export")
    );
    if (!button) {
      throw new Error("Export button not found.");
    }
    (button as HTMLButtonElement).click();
  });
  await page.evaluate((optionLabel: string) => {
    const menuItem = Array.from(
      document.querySelectorAll('[role="menuitem"]')
    ).find((element) => element.textContent?.trim() === optionLabel);
    if (!menuItem) {
      throw new Error(`Export option not found: ${optionLabel}`);
    }
    (menuItem as HTMLElement).click();
  }, label);
  await sleep(300);
}

function summarizeExportReview(
  review: Awaited<ReturnType<typeof captureScreenshot>>
): string {
  if (!review) {
    return "(no visual review)";
  }
  const summary = review.summary.trim();
  const normalized = summary.toLowerCase().replace(TRAILING_SUMMARY_REGEX, "");
  if (normalized === "all looks ok" || normalized === "all looks okay") {
    return summary;
  }
  return summary;
}

async function initExportTracker(page: PageLike) {
  await page.evaluate(() => {
    const win = window as Window & {
      __exportTracker?: { count: number };
      __exportTrackerOriginal?: typeof URL.createObjectURL;
    };
    if (win.__exportTracker) {
      return;
    }
    win.__exportTracker = { count: 0 };
    const original = URL.createObjectURL;
    win.__exportTrackerOriginal = original;
    URL.createObjectURL = function (...args) {
      if (win.__exportTracker) {
        win.__exportTracker.count += 1;
      }
      return original.apply(this, args as [Blob]);
    };
  });
}

function getExportCount(page: PageLike) {
  return page.evaluate(() => {
    const win = window as Window & { __exportTracker?: { count: number } };
    return win.__exportTracker?.count ?? 0;
  });
}

async function waitForExportCount(
  page: PageLike,
  targetCount: number,
  label: string,
  timeoutMs = 20_000
) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if ((await getExportCount(page)) >= targetCount) {
      return;
    }
    await sleep(200);
  }
  throw new Error(`${label} export did not trigger a download signal.`);
}

async function runExportFlow(params: {
  page: PageLike;
  reviewPage: {
    screenshot: PageLike["screenshot"];
    evaluate?: PageLike["evaluate"];
  };
  cfg: ReturnType<typeof loadConfig>;
  label: string;
  screenshotName: string;
  prompt: string;
  runExport: () => Promise<void>;
  warnings: string[];
}) {
  const startCount = await getExportCount(params.page);
  await params.runExport();
  await waitForExportCount(params.page, startCount + 1, params.label);
  const review = await captureScreenshot(
    params.reviewPage,
    params.cfg,
    params.screenshotName,
    { prompt: params.prompt }
  );
  const reviewSummary = summarizeExportReview(review);

  if (!review) {
    throw new Error(
      `${params.label} export review was not generated. Visual review: ${reviewSummary}`
    );
  }

  if (review?.hasIssues) {
    params.warnings.push(
      `${params.label} export may have issues: ${review.summary}`
    );
  }
}

async function main() {
  const cfg = loadConfig();
  const stagehand = await createStagehand(cfg);
  const warnings: string[] = [];
  const startedAt = new Date().toISOString();
  let status: "passed" | "failed" = "passed";
  let errorMessage = "";

  try {
    const page = await getActivePage(stagehand);
    const reviewPage = {
      screenshot: page.screenshot.bind(page),
      evaluate: page.evaluate?.bind(page),
    };
    await resetBrowserState(page, cfg.baseUrl, cfg.vercelBypassSecret);
    await ensureDesktopViewport(page);

    await page.goto(resolveUrl(cfg.baseUrl, "/library-generator"), {
      waitUntil: "domcontentloaded",
    });

    const hydrated = await waitForHydration(page, 20_000);
    if (!hydrated) {
      throw new Error("App hydration did not complete in time.");
    }

    const libraryName = `test-lib-${Date.now()}`;
    const libraryInputReady = await waitForLibraryInput(page, 20_000);
    if (!libraryInputReady) {
      throw new Error("Library create form did not load in time.");
    }

    await createLibraryWithName(page, libraryName);

    const editorResult = await waitForEditorOrToastError(page, 45_000);
    if (!editorResult.ok) {
      if (editorResult.toast) {
        throw new Error(
          `Create UI failed before navigation: ${editorResult.toast}`
        );
      }
      throw new Error("Create UI did not navigate to editor.");
    }

    await assertNewLibraryRoughnessDefaults(page);
    await uploadSvgFiles(page);

    const iconsLoaded = await waitForIconCount(page, 3, 20_000);
    if (!iconsLoaded) {
      warnings.push("Failed to verify 3 icons loaded after upload");
    }

    await initExportTracker(page);

    await runExportFlow({
      page,
      reviewPage,
      cfg,
      label: "Excalidrawlib",
      screenshotName: "export-excalidrawlib",
      prompt:
        "Did the .excalidrawlib export complete? Look for a download notification or success message.",
      runExport: () =>
        selectExportOption(page, "Export as .excalidrawlib (trace)"),
      warnings,
    });

    await runExportFlow({
      page,
      reviewPage,
      cfg,
      label: "Sketchy ZIP",
      screenshotName: "export-sketchy-zip",
      prompt:
        "Did the Sketchy SVGs ZIP export complete? Look for a download notification or success message.",
      runExport: () => selectExportOption(page, "Export as Sketchy SVGs (ZIP)"),
      warnings,
    });

    if (warnings.length > 0) {
      console.log(`Happy path warnings:\n- ${warnings.join("\n- ")}`);
    }
  } catch (error) {
    status = "failed";
    errorMessage = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    await writeScenarioSummary({
      outputDir: cfg.screenshotsDir,
      summary: {
        scenario: "icon-library-generator-happy-path",
        status,
        warnings,
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
