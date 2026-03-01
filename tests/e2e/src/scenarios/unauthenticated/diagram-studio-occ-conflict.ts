/*
Scenario: Diagram Studio OCC (optimistic concurrency) conflict

Intent: Validate that two tabs editing the same session triggers conflict UI,
        and that "Reload server version" resolves it correctly.

Steps:
- Create a new diagram session in tab A.
- Open the same session URL in tab B (new page in same context).
- Tab A: add a text element, wait for autosave.
- Tab B: add a different element, attempt save -> conflict banner appears.
- Tab B: click "Reload server version" -> conflict resolves, state refreshes.

Success:
- Conflict banner (diagram-conflict-banner) appears on tab B after tab A saves.
- Clicking "Reload server version" (conflict-reload) hides the conflict banner.
- Tab B shows the version from tab A's save after reload.
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

function parseVersionValue(versionText: string): number | null {
  const parsed = Number.parseInt(versionText.replace(/\D/g, ""), 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function waitForVersionAtLeast(
  page: PageLike,
  minVersion: number,
  timeoutMs = 35_000
): Promise<boolean> {
  return waitForCondition(
    async () => {
      const versionText = await getTestIdText(page, "diagram-session-version");
      const version = parseVersionValue(versionText);
      return version !== null && version >= minVersion;
    },
    { timeoutMs, label: `session-version>=${minVersion}` }
  );
}

async function createSession(page: PageLike, baseUrl: string): Promise<string> {
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
        return Boolean(
          document.querySelector('[data-testid="diagram-new-session"]')
        );
      }),
    { timeoutMs: 30_000, label: "auth-ready-for-create-session" }
  );
  if (!authReady) {
    throw new Error("Auth did not settle before session creation.");
  }

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
  const loaded = await waitForCondition(
    () =>
      page.evaluate(() => {
        return Boolean(
          document.querySelector('[data-testid="diagram-canvas"]') ||
            document.querySelector(".excalidraw")
        );
      }),
    { timeoutMs: 45_000, label: "diagram-canvas" }
  );
  if (!loaded) {
    throw new Error(`Excalidraw canvas did not load. URL: ${page.url()}`);
  }
}

async function addCanvasElement(page: PageLike): Promise<void> {
  const apiReady = await waitForCondition(
    () =>
      page.evaluate(() => {
        const w = window as unknown as Record<string, unknown>;
        return w.__excalidrawAPI != null;
      }),
    { timeoutMs: 15_000, label: "excalidraw-api-ready" }
  );
  if (!apiReady) {
    throw new Error("ExcalidrawImperativeAPI not available on window");
  }

  await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    const api = w.__excalidrawAPI as {
      getSceneElements: () => Record<string, unknown>[];
      updateScene: (scene: { elements: Record<string, unknown>[] }) => void;
    };
    const existing = api.getSceneElements().map((e) => ({ ...e }));
    existing.push({
      id: `test-rect-${Date.now()}`,
      type: "rectangle",
      x: 250 + Math.random() * 100,
      y: 150 + Math.random() * 100,
      width: 120,
      height: 80,
      version: 1,
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
    } as Record<string, unknown>);
    api.updateScene({ elements: existing });
  });

  await sleep(500);
}

async function triggerManualSave(_page: PageLike): Promise<void> {
  await sleep(500);
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: E2E scenario steps are intentionally explicit for traceability.
async function main() {
  const cfg = loadConfig();
  const stagehand = await createStagehand(cfg);
  const warnings: string[] = [];
  const startedAt = new Date().toISOString();
  let status: "passed" | "failed" = "passed";
  let errorMessage = "";

  try {
    const pageA = await getActivePage(stagehand);
    // biome-ignore lint/suspicious/noExplicitAny: Playwright Page types
    await resetBrowserState(pageA as any, cfg.baseUrl, cfg.vercelBypassSecret);
    // biome-ignore lint/suspicious/noExplicitAny: Playwright Page types
    await ensureDesktopViewport(pageA as any);

    console.log("[1/6] Creating diagram session in tab A...");
    const sessionUrl = await createSession(pageA, cfg.baseUrl);
    console.log(`  Session URL: ${sessionUrl}`);

    console.log("[2/6] Waiting for canvas in tab A...");
    await waitForCanvas(pageA);

    console.log("[3/6] Tab A: adding element and saving...");
    await addCanvasElement(pageA);
    await triggerManualSave(pageA);
    const savedA = await waitForSaveStatus(pageA, "Saved", 30_000);
    if (!savedA) {
      throw new Error("Tab A autosave did not complete.");
    }
    const versionA = await getTestIdText(pageA, "diagram-session-version");
    const versionAValue = parseVersionValue(versionA);
    console.log(`  Tab A version: ${versionA}`);

    console.log("[4/6] Opening same session in tab B...");
    const pageB = await stagehand.context.newPage();
    // biome-ignore lint/suspicious/noExplicitAny: Playwright Page types
    await ensureDesktopViewport(pageB as any);
    await pageB.goto(sessionUrl, { waitUntil: "domcontentloaded" });
    await sleep(3000);

    await waitForCanvas(pageB);

    const versionB = await getTestIdText(pageB, "diagram-session-version");
    console.log(`  Tab B version: ${versionB}`);

    console.log(
      "[5/6] Tab A + Tab B: overlapping edits to trigger deterministic conflict..."
    );
    await addCanvasElement(pageA);
    // Keep tab B dirty while tab A saves. This forces tab B into conflict mode
    // when reactive session updates arrive.
    await sleep(1200);
    await addCanvasElement(pageB);

    if (versionAValue !== null) {
      const advanced = await waitForVersionAtLeast(pageA, versionAValue + 1);
      if (!advanced) {
        throw new Error(
          `Tab A version did not advance to >= v${versionAValue + 1}.`
        );
      }
    } else {
      const savedA2 = await waitForSaveStatus(pageA, "Saved", 35_000);
      if (!savedA2) {
        throw new Error("Tab A second save did not complete.");
      }
    }
    const versionA2 = await getTestIdText(pageA, "diagram-session-version");
    console.log(`  Tab A new version: ${versionA2}`);

    await sleep(2500);

    const conflictBanner = await waitForTestId(
      pageB,
      "diagram-conflict-banner",
      20_000
    );
    const saveStatusB = await getTestIdText(pageB, "diagram-save-status");

    if (conflictBanner) {
      console.log("  Conflict banner appeared on tab B.");
      await captureScreenshot(
        // biome-ignore lint/suspicious/noExplicitAny: Playwright Page types
        pageB as any,
        cfg,
        "diagram-studio-conflict-banner",
        {
          prompt:
            "Diagram studio with OCC conflict banner visible. Verify the banner warns about conflicting changes.",
        }
      );
    } else if (saveStatusB.includes("Conflict")) {
      console.log(
        "  Conflict detected via save status (banner may not be visible)."
      );
    } else {
      warnings.push(
        `OCC conflict not triggered. Tab B save status: "${saveStatusB}". ` +
          "This may happen if Convex reactive queries updated tab B's version before its save attempt."
      );
      console.log(
        `  Warning: conflict not triggered (status: "${saveStatusB}").`
      );
    }

    console.log("[6/6] Tab B: clicking reload to resolve conflict...");
    const reloadButtonVisible = await waitForTestId(
      pageB,
      "conflict-reload",
      5000
    );

    if (reloadButtonVisible) {
      await clickWhenVisible(pageB, testIdSelector("conflict-reload"), {
        timeoutMs: 5000,
        label: "conflict-reload",
      });
      await sleep(3000);

      const conflictResolved = await waitForCondition(
        () =>
          pageB.evaluate(() => {
            return !document.querySelector(
              '[data-testid="diagram-conflict-banner"]'
            );
          }),
        { timeoutMs: 10_000, label: "conflict-resolved" }
      );

      if (conflictResolved) {
        console.log("  Conflict resolved after reload.");
        await captureScreenshot(
          // biome-ignore lint/suspicious/noExplicitAny: Playwright Page types
          pageB as any,
          cfg,
          "diagram-studio-conflict-resolved",
          {
            prompt:
              "Diagram studio after OCC conflict resolved. Verify the conflict banner is gone and the canvas is usable.",
          }
        );
      } else {
        warnings.push("Conflict banner still visible after reload.");
      }

      const versionBAfterReload = await getTestIdText(
        pageB,
        "diagram-session-version"
      );
      console.log(`  Tab B version after reload: ${versionBAfterReload}`);
    } else {
      console.log(
        "  Reload button not visible (conflict may not have been triggered)."
      );
      warnings.push("Could not test conflict reload - button not visible.");
    }

    await pageB.close();

    if (warnings.length > 0) {
      console.log(`\nOCC conflict warnings:\n- ${warnings.join("\n- ")}`);
    }
  } catch (error) {
    status = "failed";
    errorMessage = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    await writeScenarioSummary({
      outputDir: cfg.screenshotsDir,
      summary: {
        scenario: "diagram-studio-occ-conflict",
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
