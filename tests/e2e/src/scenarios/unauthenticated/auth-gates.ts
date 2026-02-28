/*
Scenario: Auth gates for protected paths

Intent: Validate unauthenticated users are prompted to sign in for protected features.

Steps:
- Visit /library-generator and verify create controls require sign-in.
- Visit /diagrams and verify redirect to /sign-in with return path.
- Visit /opencode/device and verify sign-in prompt is shown.

Success:
- Create button in library generator shows "Sign in" and input is disabled.
- /diagrams redirects to /sign-in with returnPathname.
- Device verification page displays "Sign in to continue".
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

const LIBRARY_SIGN_IN_SELECTOR =
  'xpath=//section[.//input[@placeholder="Library name"]]//button[normalize-space()="Sign in"]';

async function waitForText(
  page: Awaited<ReturnType<typeof getActivePage>>,
  expected: string,
  timeoutMs = 10_000
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hasText = await page.evaluate((needle) => {
      const text = document.body?.innerText ?? "";
      return text.includes(needle);
    }, expected);
    if (hasText) {
      return true;
    }
    await sleep(250);
  }
  return false;
}

async function assertLibraryGeneratorRequiresSignIn(
  page: Awaited<ReturnType<typeof getActivePage>>,
  baseUrl: string
) {
  await page.goto(resolveUrl(baseUrl, "/library-generator"), {
    waitUntil: "domcontentloaded",
  });

  await page.waitForSelector('input[placeholder="Library name"]', {
    state: "visible",
    timeout: 20_000,
  });

  await page.waitForSelector(LIBRARY_SIGN_IN_SELECTOR, {
    state: "visible",
    timeout: 20_000,
  });

  const inputDisabled = await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>(
      'input[placeholder="Library name"]'
    );
    return Boolean(input?.disabled);
  });
  if (!inputDisabled) {
    throw new Error(
      "Library name input should be disabled for unauthenticated users."
    );
  }
}

async function assertDiagramsRedirectsToSignIn(
  page: Awaited<ReturnType<typeof getActivePage>>,
  baseUrl: string
) {
  await page.goto(resolveUrl(baseUrl, "/diagrams"), {
    waitUntil: "domcontentloaded",
  });

  const deadline = Date.now() + 20_000;
  let currentUrl = "";
  while (Date.now() < deadline) {
    currentUrl = await page.evaluate(() => window.location.href);
    if (currentUrl.includes("/sign-in?returnPathname=")) {
      break;
    }
    await sleep(250);
  }

  if (!currentUrl.includes("/sign-in?returnPathname=")) {
    throw new Error(`Expected redirect to sign-in, got ${currentUrl}`);
  }

  if (!currentUrl.includes("returnPathname=%2Fdiagrams")) {
    throw new Error(
      `Expected /diagrams return path in sign-in redirect, got ${currentUrl}`
    );
  }

  const hasSignInLink = await waitForText(page, "Continue to sign in", 10_000);
  if (!hasSignInLink) {
    throw new Error("Sign-in page did not render expected continue link.");
  }
}

async function assertDevicePageShowsSignInPrompt(
  page: Awaited<ReturnType<typeof getActivePage>>,
  baseUrl: string
) {
  await page.goto(resolveUrl(baseUrl, "/opencode/device?userCode=ABCD-EFGH"), {
    waitUntil: "domcontentloaded",
  });

  const hasPrompt = await waitForText(page, "Sign in to continue", 10_000);
  if (!hasPrompt) {
    throw new Error("Device verification page did not render sign-in prompt.");
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

    await assertLibraryGeneratorRequiresSignIn(page, cfg.baseUrl);
    await captureScreenshot(reviewPage, cfg, "auth-gates-library-generator", {
      prompt:
        "Confirm this unauthenticated library generator view shows a Sign in create button and disabled create controls.",
    });

    await assertDiagramsRedirectsToSignIn(page, cfg.baseUrl);
    await captureScreenshot(reviewPage, cfg, "auth-gates-diagrams-sign-in", {
      prompt:
        "Confirm this shows the sign-in page reached from an unauthenticated /diagrams visit.",
    });

    await assertDevicePageShowsSignInPrompt(page, cfg.baseUrl);
    await captureScreenshot(reviewPage, cfg, "auth-gates-device-sign-in", {
      prompt:
        "Confirm this device verification page requires sign-in and shows the sign-in prompt button.",
    });
  } catch (error) {
    status = "failed";
    errorMessage = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    await writeScenarioSummary({
      outputDir: cfg.screenshotsDir,
      summary: {
        scenario: "auth-gates",
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
