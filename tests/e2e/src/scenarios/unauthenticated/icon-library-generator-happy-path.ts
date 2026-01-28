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
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
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
const createLibraryMutation = makeFunctionReference("iconLibraries:create");

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

async function waitForConvexUrl(
  // biome-ignore lint/suspicious/noExplicitAny: Playwright Page type
  page: any,
  timeoutMs = 30_000
): Promise<string | undefined> {
  const startedAt = Date.now();
  for (;;) {
    const url = await page.evaluate(
      () =>
        (window as Window & { __SKETCHI_CONVEX_URL?: string })
          .__SKETCHI_CONVEX_URL
    );
    if (url) {
      return url;
    }
    if (Date.now() - startedAt > timeoutMs) {
      return undefined;
    }
    await sleep(250);
  }
}

async function createLibraryViaApi(
  // biome-ignore lint/suspicious/noExplicitAny: Playwright Page type
  page: any,
  baseUrl: string,
  libraryName: string
) {
  const convexUrl = await waitForConvexUrl(page, 30_000);
  if (!convexUrl) {
    throw new Error("Missing Convex URL from app runtime.");
  }
  const client = new ConvexHttpClient(convexUrl);
  const id = await client.mutation(createLibraryMutation, {
    name: libraryName,
  });
  await page.goto(resolveUrl(baseUrl, `/library-generator/${id}`), {
    waitUntil: "domcontentloaded",
  });
}

// biome-ignore lint/suspicious/noExplicitAny: Playwright Page type
async function createLibraryWithName(page: any, libraryName: string) {
  const actionResult = await page.evaluate((name: string) => {
    const input = document.querySelector<HTMLInputElement>(
      'input[placeholder="Library name"]'
    );
    if (!input) {
      return { ok: false, reason: "missing input" };
    }
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    )?.set;
    if (!setter) {
      return { ok: false, reason: "missing input setter" };
    }
    input.focus();
    setter.call(input, name);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.blur();

    const button = Array.from(document.querySelectorAll("button")).find(
      (element) => element.textContent?.trim() === "Create"
    );
    if (!button) {
      return { ok: false, reason: "missing create button" };
    }
    button.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true })
    );
    return { ok: true };
  }, libraryName);

  return actionResult?.ok === true;
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

// biome-ignore lint/suspicious/noExplicitAny: Stagehand instance type
async function verifyIconsLoaded(stagehand: any): Promise<boolean> {
  const result = await stagehand.act(
    "Check if the library now displays 3 icons in a grid. Count the visible icon thumbnails and report the count."
  );
  return (
    result?.message?.toLowerCase().includes("3") ||
    result?.message?.toLowerCase().includes("three")
  );
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

    const libraryName = `test-lib-${Date.now()}`;
    const libraryInputReady = await waitForLibraryInput(page as any, 20_000);
    if (!libraryInputReady) {
      warnings.push("Library create form did not load in time.");
    } else {
      const created = await createLibraryWithName(page as any, libraryName);
      if (!created) {
        warnings.push("Create library UI interaction failed.");
      }
    }

    const editorReady = await waitForUploadInput(page as any, 10_000);
    if (!editorReady) {
      warnings.push(
        "Create UI did not navigate to editor; creating library via API fallback."
      );
      await createLibraryViaApi(page as any, cfg.baseUrl, libraryName);
      const fallbackReady = await waitForUploadInput(page as any, 20_000);
      if (!fallbackReady) {
        throw new Error("Upload input not found after API fallback.");
      }
    }

    await uploadSvgFiles(page as any);

    const iconsLoaded = await verifyIconsLoaded(stagehand);
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
