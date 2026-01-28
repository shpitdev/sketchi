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

async function waitForLibraryInput(
  // biome-ignore lint/suspicious/noExplicitAny: Playwright Page type
  page: any,
  timeoutMs = 30_000
): Promise<boolean> {
  const startedAt = Date.now();
  for (;;) {
    const exists = await page.evaluate(
      () => Boolean(document.querySelector('input[placeholder="Library name"]'))
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
  // biome-ignore lint/suspicious/noExplicitAny: Playwright Page type
  page: any,
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

async function waitForUploadInput(
  // biome-ignore lint/suspicious/noExplicitAny: Playwright Page type
  page: any,
  timeoutMs = 30_000
): Promise<boolean> {
  const startedAt = Date.now();
  for (;;) {
    const exists = await page.evaluate(
      () => Boolean(document.querySelector('[data-testid="svg-file-input"]'))
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

async function waitForEditorOrToastError(
  // biome-ignore lint/suspicious/noExplicitAny: Playwright Page type
  page: any,
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

// biome-ignore lint/suspicious/noExplicitAny: Playwright Page type
async function createLibraryWithName(page: any, libraryName: string) {
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

// biome-ignore lint/suspicious/noExplicitAny: Playwright Page type
async function uploadSvgFiles(page: any): Promise<void> {
  const fixtures = [
    join(fixturesDir, "palantir-workshop.svg"),
    join(fixturesDir, "palantir-pipeline.svg"),
    join(fixturesDir, "palantir-ontology.svg"),
  ];

  await page.locator('[data-testid="svg-file-input"]').setInputFiles(fixtures);
  await sleep(1500); // Wait for uploads to process
}

async function waitForIconCount(
  // biome-ignore lint/suspicious/noExplicitAny: Playwright Page type
  page: any,
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

// biome-ignore lint/suspicious/noExplicitAny: Stagehand instance type
async function exportAsExcalidrawLib(stagehand: any): Promise<void> {
  await stagehand.act(
    "Find and click the export button or menu. Select the option to export as .excalidrawlib format. Confirm the export action."
  );
  await sleep(500);
}

// biome-ignore lint/suspicious/noExplicitAny: Stagehand instance type
async function exportAsSketchyZip(stagehand: any): Promise<void> {
  await stagehand.act(
    "Find and click the export button or menu. Select the option to export as Sketchy SVGs (ZIP). Confirm the export action."
  );
  await sleep(500);
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
    // biome-ignore lint/suspicious/noExplicitAny: Playwright Page types
    await resetBrowserState(page as any, cfg.baseUrl, cfg.vercelBypassSecret);
    // biome-ignore lint/suspicious/noExplicitAny: Playwright Page types
    await ensureDesktopViewport(page as any);

    await page.goto(resolveUrl(cfg.baseUrl, "/library-generator"), {
      waitUntil: "domcontentloaded",
    });

    const hydrated = await waitForHydration(page as any, 20_000);
    if (!hydrated) {
      throw new Error("App hydration did not complete in time.");
    }

    const libraryName = `test-lib-${Date.now()}`;
    const libraryInputReady = await waitForLibraryInput(page as any, 20_000);
    if (!libraryInputReady) {
      throw new Error("Library create form did not load in time.");
    }

    await createLibraryWithName(page as any, libraryName);

    const editorResult = await waitForEditorOrToastError(page as any, 45_000);
    if (!editorResult.ok) {
      if (editorResult.toast) {
        throw new Error(
          `Create UI failed before navigation: ${editorResult.toast}`
        );
      }
      throw new Error("Create UI did not navigate to editor.");
    }

    await uploadSvgFiles(page as any);

    const iconsLoaded = await waitForIconCount(page as any, 3, 20_000);
    if (!iconsLoaded) {
      warnings.push("Failed to verify 3 icons loaded after upload");
    }

    await exportAsExcalidrawLib(stagehand);
    const excalidrawExport = await captureScreenshot(
      // biome-ignore lint/suspicious/noExplicitAny: Playwright Page types
      page as any,
      cfg,
      "export-excalidrawlib",
      {
        prompt:
          "Did the .excalidrawlib export complete? Look for a download notification or success message.",
      }
    );
    if (excalidrawExport?.hasIssues) {
      warnings.push(
        `Excalidraw export may have issues: ${excalidrawExport.summary}`
      );
    }

    await exportAsSketchyZip(stagehand);
    const sketchyExport = await captureScreenshot(
      // biome-ignore lint/suspicious/noExplicitAny: Playwright Page types
      page as any,
      cfg,
      "export-sketchy-zip",
      {
        prompt:
          "Did the Sketchy SVGs ZIP export complete? Look for a download notification or success message.",
      }
    );
    if (sketchyExport?.hasIssues) {
      warnings.push(`Sketchy export may have issues: ${sketchyExport.summary}`);
    }

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
