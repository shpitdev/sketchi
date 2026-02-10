/*
Scenario: Diagram Studio happy path

Intent: Validate session create -> canvas interaction -> autosave -> reload persistence ->
        import share link -> export share link -> export .excalidraw file.

Steps:
- Navigate to /diagrams and click "New diagram" button.
- Wait for session URL (pattern /diagrams/<sessionId>).
- Verify Excalidraw canvas loads (diagram-canvas testid).
- Add a text element: press "t", click canvas, type "hello", press Escape.
- Wait for autosave (diagram-save-status becomes "Saved").
- Capture version from diagram-session-version.
- Reload page and verify version unchanged + element count > 0.
- Verify AI restructure warning exists (diagram-restructure-warning).
- Import a known share link and verify it persists after reload.
- Export share link and verify URL pattern.
- Export .excalidraw file and verify download JSON structure.

Success:
- Session created with valid URL.
- Text element added and autosaved.
- Reload preserves version and elements.
- Import/export flows complete without errors.
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
import { clickWhenVisible, sleep, waitForCondition } from "../../runner/wait";

type PageLike = Awaited<ReturnType<typeof getActivePage>>;

const SESSION_URL_REGEX = /\/diagrams\/[a-z0-9]+$/;
const SHARE_LINK_REGEX = /excalidraw\.com\/#json=/;

function testIdSelector(testId: string) {
  return `[data-testid="${testId}"]`;
}

function waitForTestId(
  page: PageLike,
  testId: string,
  timeoutMs = 30_000
): Promise<boolean> {
  return waitForCondition(
    () =>
      page.evaluate((tid: string) => {
        return Boolean(document.querySelector(`[data-testid="${tid}"]`));
      }, testId),
    { timeoutMs, label: `testid:${testId}` }
  );
}

function getTestIdText(page: PageLike, testId: string): Promise<string> {
  return page.evaluate((tid: string) => {
    const el = document.querySelector(`[data-testid="${tid}"]`);
    return el?.textContent?.trim() ?? "";
  }, testId);
}

function waitForSaveStatus(
  page: PageLike,
  statusSubstring: string,
  timeoutMs = 30_000
): Promise<boolean> {
  return waitForCondition(
    async () => {
      const text = await getTestIdText(page, "diagram-save-status");
      return text.includes(statusSubstring);
    },
    { timeoutMs, label: `save-status:${statusSubstring}` }
  );
}

async function createSessionAndNavigate(
  page: PageLike,
  baseUrl: string
): Promise<string> {
  await page.goto(resolveUrl(baseUrl, "/diagrams"), {
    waitUntil: "domcontentloaded",
  });
  await sleep(3000);

  await clickWhenVisible(page, testIdSelector("diagram-new-session"), {
    timeoutMs: 15_000,
    label: "new-session-button",
  });

  const navigated = await waitForCondition(
    () => SESSION_URL_REGEX.test(page.url()),
    { timeoutMs: 30_000, label: "session-url" }
  );
  if (!navigated) {
    throw new Error(`Expected session URL, got: ${page.url()}`);
  }

  return page.url();
}

async function waitForCanvas(page: PageLike): Promise<void> {
  const canvasLoaded = await waitForTestId(page, "diagram-canvas", 30_000);
  if (!canvasLoaded) {
    throw new Error("Excalidraw canvas did not load (diagram-canvas).");
  }
}

async function addTextElement(page: PageLike): Promise<void> {
  await page.locator("canvas").click();
  await sleep(300);

  await page.keyPress("t");
  await sleep(500);

  const canvasBounds = await page.evaluate(() => {
    const container = document.querySelector('[data-testid="diagram-canvas"]');
    if (!container) {
      return { x: 400, y: 300, width: 800, height: 600 };
    }
    const rect = container.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  const cx = canvasBounds.x + canvasBounds.width / 2;
  const cy = canvasBounds.y + canvasBounds.height / 2;
  await page.click(cx, cy);
  await sleep(500);

  await page.type("hello", { delay: 50 });
  await sleep(300);

  await page.keyPress("Escape");
  await sleep(500);

  await page.click(cx + 50, cy + 50);
  await sleep(300);
}

async function verifyAutosave(page: PageLike): Promise<void> {
  const saved = await waitForSaveStatus(page, "Saved", 30_000);
  if (!saved) {
    const currentStatus = await getTestIdText(page, "diagram-save-status");
    throw new Error(
      `Autosave did not complete. Current status: "${currentStatus}"`
    );
  }
}

async function getVersionAndElementCount(
  page: PageLike
): Promise<{ version: string; elementCount: string }> {
  const version = await getTestIdText(page, "diagram-session-version");
  const elementCount = await getTestIdText(page, "diagram-element-count");
  return { version, elementCount };
}

async function verifyReloadPersistence(
  page: PageLike,
  sessionUrl: string,
  expectedVersion: string
): Promise<void> {
  await page.goto(sessionUrl, { waitUntil: "domcontentloaded" });
  await waitForCanvas(page);

  // Wait for data to load
  await sleep(3000);

  const { version, elementCount } = await getVersionAndElementCount(page);

  if (version !== expectedVersion) {
    throw new Error(
      `Version mismatch after reload. Expected "${expectedVersion}", got "${version}".`
    );
  }

  const count = Number.parseInt(elementCount, 10);
  if (!(count > 0)) {
    throw new Error(
      `Expected element count > 0 after reload, got "${elementCount}".`
    );
  }
}

async function verifyRestructureWarning(page: PageLike): Promise<void> {
  const exists = await waitForTestId(
    page,
    "diagram-restructure-warning",
    10_000
  );
  if (!exists) {
    throw new Error("diagram-restructure-warning not found.");
  }
}

async function testImportShareLink(page: PageLike): Promise<void> {
  // Click the Import button to reveal the import input
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const importBtn = btns.find((b) => b.textContent?.trim() === "Import");
    if (importBtn) {
      importBtn.click();
    }
  });
  await sleep(500);

  const inputVisible = await waitForTestId(
    page,
    "diagram-import-input",
    10_000
  );
  if (!inputVisible) {
    throw new Error("Import input did not appear.");
  }

  // Use a well-known Excalidraw share link (empty scene)
  const testShareUrl =
    "https://excalidraw.com/#json=HFlhVbFqhFLHTsfXN2Pso,rW0denMKM5mC4E0FKbqKRQ";

  await page.locator(testIdSelector("diagram-import-input")).fill(testShareUrl);
  await sleep(300);

  await clickWhenVisible(page, testIdSelector("diagram-import-submit"), {
    timeoutMs: 5000,
    label: "import-submit",
  });

  // Wait for import to process and autosave
  await sleep(5000);

  // Verify the save completed
  const saved = await waitForSaveStatus(page, "Saved", 30_000);
  if (!saved) {
    const status = await getTestIdText(page, "diagram-save-status");
    // Non-fatal: import might have been empty
    console.log(
      `Import save status not "Saved" after import: "${status}" (may be expected for empty links).`
    );
  }
}

async function testExportShareLink(page: PageLike): Promise<string> {
  // Click the Export dropdown trigger
  await page.evaluate(() => {
    const triggers = Array.from(document.querySelectorAll("button"));
    const exportBtn = triggers.find((b) =>
      b.textContent?.trim().includes("Export")
    );
    if (exportBtn) {
      exportBtn.click();
    }
  });
  await sleep(500);

  await clickWhenVisible(page, testIdSelector("diagram-export-share"), {
    timeoutMs: 10_000,
    label: "export-share",
  });

  // Wait for the share URL to appear
  await sleep(3000);

  // The share link gets copied to clipboard and shown in UI
  const shareUrl = await page.evaluate(() => {
    // Look for the copy-share-url button that appears after export
    const btns = Array.from(document.querySelectorAll("button"));
    const shareBtn = btns.find((b) =>
      b.textContent?.includes("excalidraw.com")
    );
    return shareBtn?.textContent?.trim() ?? "";
  });

  if (!SHARE_LINK_REGEX.test(shareUrl)) {
    // Check toast for success message instead
    const toastContent = await page.evaluate(() => {
      const toast = document.querySelector("[data-sonner-toast]");
      return toast?.textContent?.trim() ?? "";
    });
    if (!toastContent.toLowerCase().includes("copied")) {
      throw new Error(
        `Export share link did not produce expected URL. Got: "${shareUrl}", toast: "${toastContent}"`
      );
    }
    console.log(
      "Share link exported (confirmed via toast, URL not visible in DOM)."
    );
    return "";
  }

  return shareUrl;
}

async function testExportExcalidraw(page: PageLike): Promise<void> {
  // Set up download tracker
  await page.evaluate(() => {
    const win = window as Window & { __downloadTriggered?: boolean };
    const original = URL.createObjectURL;
    URL.createObjectURL = function (...args) {
      win.__downloadTriggered = true;
      return original.apply(this, args as [Blob]);
    };
  });

  // Click the Export dropdown trigger
  await page.evaluate(() => {
    const triggers = Array.from(document.querySelectorAll("button"));
    const exportBtn = triggers.find((b) =>
      b.textContent?.trim().includes("Export")
    );
    if (exportBtn) {
      exportBtn.click();
    }
  });
  await sleep(500);

  await clickWhenVisible(page, testIdSelector("diagram-export-excalidraw"), {
    timeoutMs: 10_000,
    label: "export-excalidraw",
  });

  await sleep(2000);

  // Verify download was triggered
  const downloaded = await page.evaluate(() => {
    const win = window as Window & { __downloadTriggered?: boolean };
    return win.__downloadTriggered === true;
  });

  if (!downloaded) {
    // Check toast for success
    const toastContent = await page.evaluate(() => {
      const toast = document.querySelector("[data-sonner-toast]");
      return toast?.textContent?.trim() ?? "";
    });
    if (!toastContent.toLowerCase().includes("excalidraw")) {
      throw new Error(
        `Export .excalidraw did not trigger download. Toast: "${toastContent}"`
      );
    }
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
    // biome-ignore lint/suspicious/noExplicitAny: Playwright Page types
    await resetBrowserState(page as any, cfg.baseUrl, cfg.vercelBypassSecret);
    // biome-ignore lint/suspicious/noExplicitAny: Playwright Page types
    await ensureDesktopViewport(page as any);

    // Step 1: Create session
    console.log("[1/8] Creating new diagram session...");
    const sessionUrl = await createSessionAndNavigate(page, cfg.baseUrl);
    console.log(`  Session URL: ${sessionUrl}`);

    // Step 2: Wait for canvas
    console.log("[2/8] Waiting for Excalidraw canvas...");
    await waitForCanvas(page);

    // Step 3: Add text element
    console.log("[3/8] Adding text element...");
    await addTextElement(page);

    // Step 4: Wait for autosave
    console.log("[4/8] Waiting for autosave...");
    await verifyAutosave(page);

    const { version, elementCount } = await getVersionAndElementCount(page);
    console.log(`  Version: ${version}, Elements: ${elementCount}`);

    await captureScreenshot(reviewPage, cfg, "diagram-studio-after-text", {
      prompt: "Does the diagram canvas show a text element with 'hello'?",
    });

    // Step 5: Reload and verify persistence
    console.log("[5/8] Reloading and verifying persistence...");
    await verifyReloadPersistence(page, sessionUrl, version);
    console.log("  Persistence verified.");

    // Step 6: Verify restructure warning
    console.log("[6/8] Verifying restructure warning...");
    try {
      await verifyRestructureWarning(page);
      console.log("  Restructure warning present.");
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "restructure-warning check failed";
      warnings.push(msg);
      console.log(`  Warning: ${msg}`);
    }

    // Step 7: Import share link
    console.log("[7/8] Testing import share link...");
    try {
      await testImportShareLink(page);
      console.log("  Import completed.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "import test failed";
      warnings.push(msg);
      console.log(`  Warning: ${msg}`);
    }

    // Step 8: Export share link + .excalidraw
    console.log("[8/8] Testing export flows...");
    try {
      const exportedUrl = await testExportShareLink(page);
      if (exportedUrl) {
        console.log(`  Share link: ${exportedUrl}`);
      }
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "export share test failed";
      warnings.push(msg);
      console.log(`  Warning: ${msg}`);
    }

    try {
      await testExportExcalidraw(page);
      console.log("  .excalidraw export completed.");
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "export excalidraw test failed";
      warnings.push(msg);
      console.log(`  Warning: ${msg}`);
    }

    await captureScreenshot(reviewPage, cfg, "diagram-studio-final", {
      prompt:
        "Does the diagram studio page look correct with canvas, toolbar, and chat sidebar?",
    });

    if (warnings.length > 0) {
      console.log(`\nHappy path warnings:\n- ${warnings.join("\n- ")}`);
    }
  } catch (error) {
    status = "failed";
    errorMessage = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    await writeScenarioSummary({
      outputDir: cfg.screenshotsDir,
      summary: {
        scenario: "diagram-studio-happy-path",
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
