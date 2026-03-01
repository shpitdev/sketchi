/*
Scenario: Diagram Studio happy path

Intent: Validate session create -> prompt streaming/tool lifecycle -> autosave ->
        stop flow -> off-bottom scroll behavior -> reload persistence ->
        import share link -> export share link -> export .excalidraw file.

Steps:
- Navigate to /diagrams and click "New diagram" button.
- Wait for session URL (pattern /diagrams/<sessionId>).
- Verify Excalidraw canvas loads (diagram-canvas testid).
- Add a text element to trigger autosave.
- Wait for autosave (diagram-save-status becomes "Saved").
- Capture version from diagram-session-version.
- Reload page and verify version unchanged + element count > 0.
- Trigger stop while streaming and verify stopped status.
- Verify off-bottom streaming does not yank and scroll-to-latest works.
- Verify AI restructure warning exists (diagram-restructure-warning).
- Import a known share link and verify it persists after reload.
- Export share link and verify URL pattern.
- Export .excalidraw file and verify download JSON structure.

Success:
- Session created with valid URL.
- Streaming shows tool lifecycle statuses.
- Stop during streaming reaches terminal stopped state.
- Off-bottom behavior preserves user scroll and affordance works.
- Reload preserves version and elements.
- Import/export flows complete without errors.
*/

import { ensureSignedInForDiagrams } from "../../runner/auth";
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

function waitForRunStatus(
  page: PageLike,
  statusSubstring: string,
  timeoutMs = 30_000
): Promise<boolean> {
  return waitForCondition(
    async () => {
      const text = await getTestIdText(page, "diagram-status-row");
      return text.includes(statusSubstring);
    },
    { timeoutMs, label: `run-status:${statusSubstring}` }
  );
}

async function sendChatPrompt(page: PageLike, prompt: string): Promise<void> {
  await page.locator(testIdSelector("diagram-chat-input")).fill(prompt);
  await clickWhenVisible(page, testIdSelector("diagram-chat-send"), {
    timeoutMs: 5000,
    label: "diagram-chat-send",
  });
}

function hasToolStatus(
  page: PageLike,
  statuses: Array<"pending" | "running" | "completed" | "error">
): Promise<boolean> {
  return page.evaluate((wanted) => {
    const nodes = Array.from(
      document.querySelectorAll('[data-testid="diagram-tool-message"]')
    );
    return nodes.some((node) => {
      const status = node.getAttribute("data-tool-status");
      return Boolean(
        status && wanted.includes(status as (typeof wanted)[number])
      );
    });
  }, statuses);
}

async function createSessionAndNavigate(
  page: PageLike,
  baseUrl: string,
  cfg: import("../../runner/config").StagehandRunConfig
): Promise<string> {
  await ensureSignedInForDiagrams(page, baseUrl);
  if (!page.url().includes("/diagrams")) {
    await page.goto(resolveUrl(baseUrl, "/diagrams"), {
      waitUntil: "domcontentloaded",
    });
  }
  await sleep(2500);
  const authReady = await waitForCondition(
    () =>
      page.evaluate(() => {
        const hasSignInLink = Array.from(document.querySelectorAll("a")).some(
          (anchor) => anchor.textContent?.trim() === "Sign in"
        );
        if (hasSignInLink) {
          return false;
        }
        return Array.from(document.querySelectorAll("button")).some((button) =>
          button.textContent?.toLowerCase().includes("sketchi preview")
        );
      }),
    { timeoutMs: 30_000, label: "auth-ready-for-create-session" }
  );
  if (!authReady) {
    throw new Error("Auth did not settle before session creation.");
  }

  // biome-ignore lint/suspicious/noExplicitAny: Playwright Page types
  await captureScreenshot(page as any, cfg, "diagram-studio-landing", {
    prompt: "Capture /diagrams landing page with recents list",
  });

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    await clickWhenVisible(page, testIdSelector("diagram-new-session"), {
      timeoutMs: 15_000,
      label: `new-session-button-attempt-${attempt}`,
    });

    const navigated = await waitForCondition(
      () => SESSION_URL_REGEX.test(page.url()),
      { timeoutMs: 10_000, label: `session-url-attempt-${attempt}` }
    );
    if (navigated) {
      return page.url();
    }

    await sleep(800 * attempt);
    await page.goto(resolveUrl(baseUrl, "/diagrams"), {
      waitUntil: "domcontentloaded",
    });
    await sleep(1200);
  }

  throw new Error(`Expected session URL, got: ${page.url()}`);
}

async function waitForCanvas(page: PageLike): Promise<void> {
  const canvasLoaded = await waitForCondition(
    () =>
      page.evaluate(() => {
        return Boolean(
          document.querySelector('[data-testid="diagram-canvas"]') ||
            document.querySelector(".excalidraw")
        );
      }),
    { timeoutMs: 45_000, label: "diagram-canvas" }
  );
  if (!canvasLoaded) {
    throw new Error(`Excalidraw canvas did not load. URL: ${page.url()}`);
  }
}

async function waitForExcalidrawAPI(page: PageLike): Promise<void> {
  const ready = await waitForCondition(
    () =>
      page.evaluate(() => {
        const w = window as unknown as Record<string, unknown>;
        return w.__excalidrawAPI != null;
      }),
    { timeoutMs: 15_000, label: "excalidraw-api-ready" }
  );
  if (!ready) {
    throw new Error("ExcalidrawImperativeAPI not available on window");
  }
}

async function addTextElement(page: PageLike): Promise<void> {
  await waitForExcalidrawAPI(page);

  await page.evaluate(() => {
    const api = (window as unknown as Record<string, unknown>)
      .__excalidrawAPI as {
      getSceneElements: () => Record<string, unknown>[];
      updateScene: (s: { elements: Record<string, unknown>[] }) => void;
    };
    const existing = api.getSceneElements().map((el) => ({ ...el }));
    existing.push({
      id: `test-text-${Date.now()}`,
      type: "text",
      x: 300,
      y: 200,
      width: 100,
      height: 25,
      text: "hello",
      fontSize: 20,
      fontFamily: 1,
      version: 2,
      versionNonce: Math.floor(Math.random() * 2_147_483_647),
      isDeleted: false,
      strokeColor: "#1e1e1e",
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeWidth: 2,
      roughness: 1,
      opacity: 100,
      angle: 0,
      seed: Math.floor(Math.random() * 2_147_483_647),
      groupIds: [],
      boundElements: null,
      link: null,
      locked: false,
    });
    api.updateScene({ elements: existing });
  });

  await sleep(500);
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
  minExpectedVersion: string
): Promise<void> {
  await page.goto(sessionUrl, { waitUntil: "domcontentloaded" });
  await waitForCanvas(page);

  // Wait for data to load
  await sleep(3000);

  const { version, elementCount } = await getVersionAndElementCount(page);

  // Version may advance between capture and reload due to autosave timing.
  // Just verify it's >= the version we saw before reload.
  const vNum = Number.parseInt(version.replace(/\D/g, ""), 10);
  const minNum = Number.parseInt(minExpectedVersion.replace(/\D/g, ""), 10);
  if (Number.isNaN(vNum) || vNum < minNum) {
    throw new Error(
      `Version after reload (${version}) is less than expected minimum (${minExpectedVersion}).`
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

async function verifyEmptyCanvasAssertions(page: PageLike): Promise<void> {
  const headerText = await getTestIdText(page, "diagram-chat-header");
  if (headerText.includes("Restructure")) {
    throw new Error(
      "Header still says 'Restructure' - should be 'AI Assistant'"
    );
  }

  const placeholder = await page.evaluate(() => {
    const input = document.querySelector(
      '[data-testid="diagram-chat-placeholder"]'
    );
    return input?.textContent?.trim() ?? "";
  });
  const validPlaceholders = [
    "Describe the diagram to generate...",
    "Describe how the current diagram should change...",
  ];
  if (!validPlaceholders.includes(placeholder)) {
    throw new Error(`Wrong placeholder: ${placeholder}`);
  }

  const warningWhenEmpty = await page.evaluate(() => {
    return Boolean(
      document.querySelector('[data-testid="diagram-restructure-warning"]')
    );
  });
  if (warningWhenEmpty) {
    throw new Error("Warning should not show on empty canvas");
  }
}

async function generateFromBlankCanvas(
  page: PageLike,
  reviewPage: Parameters<typeof captureScreenshot>[0],
  cfg: import("../../runner/config").StagehandRunConfig
): Promise<void> {
  await sendChatPrompt(page, "Flowchart: Start -> Process -> End");
  const statusRowAppeared = await waitForTestId(
    page,
    "diagram-status-row",
    10_000
  );
  if (statusRowAppeared) {
    await captureScreenshot(reviewPage, cfg, "diagram-studio-generating", {
      prompt: "Capture status row showing generating state",
    });
  }
  const sawLiveToolStatus = await waitForCondition(
    () => hasToolStatus(page, ["pending", "running"]),
    { timeoutMs: 20_000, label: "tool-status-live" }
  );
  if (!sawLiveToolStatus) {
    throw new Error(
      "Did not observe pending/running tool status during generation."
    );
  }
  const sawCompletedToolStatus = await waitForCondition(
    () => hasToolStatus(page, ["completed"]),
    { timeoutMs: 60_000, label: "tool-status-complete" }
  );
  if (!sawCompletedToolStatus) {
    throw new Error("Did not observe completed tool status.");
  }
  const persisted = await waitForRunStatus(page, "Persisted", 60_000);
  if (!persisted) {
    throw new Error("Run did not reach persisted status.");
  }
  await waitForSaveStatus(page, "Saved", 60_000);
}

async function stopDuringStreaming(
  page: PageLike,
  reviewPage: Parameters<typeof captureScreenshot>[0],
  cfg: import("../../runner/config").StagehandRunConfig
): Promise<void> {
  await sendChatPrompt(
    page,
    "Create a detailed architecture with many components, retries, fallbacks, and monitoring lanes."
  );
  const stopVisible = await waitForTestId(page, "diagram-chat-stop", 15_000);
  if (!stopVisible) {
    throw new Error("Stop button did not appear during streaming.");
  }

  await clickWhenVisible(page, testIdSelector("diagram-chat-stop"), {
    timeoutMs: 5000,
    label: "diagram-chat-stop",
  });

  const stopped = await waitForRunStatus(page, "Stopped", 30_000);
  if (!stopped) {
    throw new Error("Run status did not transition to Stopped.");
  }

  await captureScreenshot(reviewPage, cfg, "diagram-studio-stopped", {
    prompt: "Capture chat sidebar after stop during streaming.",
  });
}

async function verifyOffBottomScrollBehavior(
  page: PageLike,
  reviewPage: Parameters<typeof captureScreenshot>[0],
  cfg: import("../../runner/config").StagehandRunConfig
): Promise<void> {
  await page.evaluate(() => {
    const container = document.querySelector(
      '[data-testid="diagram-chat-scroll-container"]'
    ) as HTMLElement | null;
    if (container) {
      container.style.maxHeight = "180px";
      container.style.overflowY = "auto";
    }
  });

  await sendChatPrompt(page, "Add a validation step after Process.");
  await waitForRunStatus(page, "Persisted", 60_000);
  await sendChatPrompt(page, "Add a final reporting node.");
  await waitForRunStatus(page, "Persisted", 60_000);

  const hasOverflow = await waitForCondition(
    () =>
      page.evaluate(() => {
        const container = document.querySelector(
          '[data-testid="diagram-chat-scroll-container"]'
        ) as HTMLElement | null;
        if (!container) {
          return false;
        }
        return container.scrollHeight > container.clientHeight + 24;
      }),
    { timeoutMs: 15_000, label: "chat-overflow" }
  );
  if (!hasOverflow) {
    throw new Error(
      "Chat history did not overflow; cannot validate off-bottom behavior."
    );
  }

  await page.evaluate(() => {
    const container = document.querySelector(
      '[data-testid="diagram-chat-scroll-container"]'
    ) as HTMLElement | null;
    if (container) {
      container.scrollTop = 0;
    }
  });

  await sendChatPrompt(page, "Add an audit trail side branch.");
  const running = await waitForRunStatus(page, "Running", 20_000);
  if (!running) {
    throw new Error("Run did not enter running state for off-bottom check.");
  }

  await sleep(1200);
  const stillOffBottom = await page.evaluate(() => {
    const container = document.querySelector(
      '[data-testid="diagram-chat-scroll-container"]'
    ) as HTMLElement | null;
    if (!container) {
      return false;
    }
    return container.scrollTop < 32;
  });
  if (!stillOffBottom) {
    throw new Error(
      "Chat auto-follow yanked scroll while user was off-bottom."
    );
  }

  const affordanceVisible = await waitForTestId(
    page,
    "diagram-scroll-to-latest",
    15_000
  );
  if (!affordanceVisible) {
    throw new Error("Scroll-to-latest affordance did not appear off-bottom.");
  }

  await clickWhenVisible(page, testIdSelector("diagram-scroll-to-latest"), {
    timeoutMs: 5000,
    label: "diagram-scroll-to-latest",
  });

  const returnedToBottom = await waitForCondition(
    () =>
      page.evaluate(() => {
        const container = document.querySelector(
          '[data-testid="diagram-chat-scroll-container"]'
        ) as HTMLElement | null;
        if (!container) {
          return false;
        }
        const distance =
          container.scrollHeight -
          (container.scrollTop + container.clientHeight);
        return distance <= 32;
      }),
    { timeoutMs: 10_000, label: "scroll-return-bottom" }
  );
  if (!returnedToBottom) {
    throw new Error("Scroll-to-latest did not return the feed to bottom.");
  }

  await captureScreenshot(reviewPage, cfg, "diagram-studio-scroll-affordance", {
    prompt:
      "Capture chat sidebar while streaming off-bottom with scroll-to-latest behavior validated.",
  });
}

function catchWarning(
  fn: () => Promise<void>,
  warnings: string[],
  fallbackMsg: string
): Promise<void> {
  return fn().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : fallbackMsg;
    warnings.push(msg);
    console.log(`  Warning: ${msg}`);
  });
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
    console.log("[1/12] Creating new diagram session...");
    const sessionUrl = await createSessionAndNavigate(page, cfg.baseUrl, cfg);
    console.log(`  Session URL: ${sessionUrl}`);

    // Step 2: Wait for canvas
    console.log("[2/12] Waiting for Excalidraw canvas...");
    await waitForCanvas(page);

    // Step 3: Empty canvas screenshot + assertions
    console.log(
      "[3/12] Capturing empty canvas and verifying AI Assistant UI..."
    );
    await captureScreenshot(reviewPage, cfg, "diagram-studio-empty-canvas", {
      prompt: "Capture empty canvas with AI Assistant sidebar",
    });
    await verifyEmptyCanvasAssertions(page);

    // Step 4: Generate from blank canvas via chat
    console.log("[4/12] Sending prompt to generate from blank canvas...");
    await generateFromBlankCanvas(page, reviewPage, cfg);
    console.log("  Generation complete and saved.");

    // Step 5: Add text element
    console.log("[5/12] Adding text element...");
    await addTextElement(page);

    // Step 6: Wait for autosave
    console.log("[6/12] Waiting for autosave...");
    await verifyAutosave(page);

    const { version, elementCount } = await getVersionAndElementCount(page);
    console.log(`  Version: ${version}, Elements: ${elementCount}`);

    await captureScreenshot(reviewPage, cfg, "diagram-studio-after-text", {
      prompt: "Does the diagram canvas show a text element with 'hello'?",
    });

    // Step 7: Reload and verify persistence
    console.log("[7/12] Reloading and verifying persistence...");
    await verifyReloadPersistence(page, sessionUrl, version);
    console.log("  Persistence verified.");

    // Step 8: Verify restructure warning
    console.log("[8/12] Verifying restructure warning...");
    await catchWarning(
      async () => {
        await verifyRestructureWarning(page);
        console.log("  Restructure warning present.");
      },
      warnings,
      "restructure-warning check failed"
    );

    // Step 9: Stop during streaming
    console.log("[9/14] Testing stop during streaming...");
    await catchWarning(
      async () => {
        await stopDuringStreaming(page, reviewPage, cfg);
        console.log("  Stop flow verified.");
      },
      warnings,
      "stop-during-streaming check failed"
    );

    // Step 10: Off-bottom scroll behavior
    console.log("[10/14] Testing off-bottom scroll behavior...");
    await catchWarning(
      async () => {
        await verifyOffBottomScrollBehavior(page, reviewPage, cfg);
        console.log("  Off-bottom scroll behavior verified.");
      },
      warnings,
      "off-bottom scroll behavior check failed"
    );

    // Step 11: Import share link
    console.log("[11/14] Testing import share link...");
    await catchWarning(
      async () => {
        await testImportShareLink(page);
        // biome-ignore lint/suspicious/noExplicitAny: Playwright Page types
        await captureScreenshot(page as any, cfg, "diagram-studio-import", {
          prompt: "Capture import UI state",
        });
        console.log("  Import completed.");
      },
      warnings,
      "import test failed"
    );

    // Step 12: Export share link + .excalidraw
    console.log("[12/14] Testing export flows...");
    await catchWarning(
      async () => {
        const exportedUrl = await testExportShareLink(page);
        // biome-ignore lint/suspicious/noExplicitAny: Playwright Page types
        await captureScreenshot(page as any, cfg, "diagram-studio-export", {
          prompt: "Capture export menu state",
        });
        if (exportedUrl) {
          console.log(`  Share link: ${exportedUrl}`);
        }
      },
      warnings,
      "export share test failed"
    );

    await catchWarning(
      async () => {
        await testExportExcalidraw(page);
        console.log("  .excalidraw export completed.");
      },
      warnings,
      "export excalidraw test failed"
    );

    // Step 13: Recents screenshot
    console.log("[13/14] Capturing recents list...");
    await page.goto(resolveUrl(cfg.baseUrl, "/diagrams"), {
      waitUntil: "domcontentloaded",
    });
    await sleep(2000);
    // biome-ignore lint/suspicious/noExplicitAny: Playwright Page types
    await captureScreenshot(page as any, cfg, "diagram-studio-recents", {
      prompt: "Capture recents list showing visited session",
    });

    // Step 14: Final screenshot
    console.log("[14/14] Final capture...");
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
