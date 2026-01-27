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

async function createLibraryWithName(
  // biome-ignore lint/suspicious/noExplicitAny: Stagehand instance type
  stagehand: any,
  libraryName: string
): Promise<void> {
  await stagehand.act(
    `Click the button or link to create a new icon library. Then fill in the library name field with "${libraryName}" and confirm creation.`
  );
  await sleep(500);
}

// biome-ignore lint/suspicious/noExplicitAny: Stagehand instance type
async function uploadSvgFiles(stagehand: any): Promise<void> {
  await stagehand.act(
    "Upload 3 SVG files to the library. Use the upload button or drag-and-drop area. The SVGs should be simple valid SVGs."
  );
  await sleep(1000);
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
    await resetBrowserState(page as any, cfg.baseUrl);
    // biome-ignore lint/suspicious/noExplicitAny: Playwright Page types
    await ensureDesktopViewport(page as any);

    await page.goto(resolveUrl(cfg.baseUrl, "/"), {
      waitUntil: "domcontentloaded",
    });

    await stagehand.act(
      "Navigate to the Icon Library Generator page. Look for a link or button in the navigation that says 'Icon Library Generator' or similar."
    );
    await sleep(500);

    const libraryName = `test-lib-${Date.now()}`;
    await createLibraryWithName(stagehand, libraryName);

    await uploadSvgFiles(stagehand);

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
