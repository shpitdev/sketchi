#!/usr/bin/env node

import { chromium } from "playwright";

function getEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

function resolveUrl(baseUrl, path) {
  return new URL(path, baseUrl).toString();
}

function decodeJwtClaims(token) {
  const [, payload] = token.split(".");
  if (!payload) {
    return null;
  }

  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(Buffer.from(normalized, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function logAccessTokenClaims(token) {
  const claims = decodeJwtClaims(token);
  if (!claims || typeof claims !== "object") {
    console.error("[device-flow] access token claims unavailable");
    return;
  }

  const safeClaims = {
    iss: typeof claims.iss === "string" ? claims.iss : undefined,
    aud:
      typeof claims.aud === "string" || Array.isArray(claims.aud)
        ? claims.aud
        : undefined,
    client_id:
      typeof claims.client_id === "string" ? claims.client_id : undefined,
  };
  console.error(
    `[device-flow] access token claims ${JSON.stringify(safeClaims)}`
  );
}

async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function clickFirstVisible(page, selectors) {
  for (const selector of selectors) {
    const clicked = await clickSelectorIfVisible(page, selector);
    if (clicked) {
      return true;
    }
  }
  return false;
}

async function clickSelectorIfVisible(page, selector) {
  try {
    const locator = page.locator(selector).first();
    if (await locator.isVisible({ timeout: 1000 })) {
      await locator.click();
      return true;
    }
  } catch {
    // Ignore selector misses and continue trying fallback selectors.
    return false;
  }
  return false;
}

async function clickApprovalAction(page) {
  const clickedByLabel = await clickFirstVisible(page, [
    'button:has-text("Allow")',
    'button:has-text("Authorize")',
    'button:has-text("Approve")',
    'button:has-text("Continue")',
    'button:has-text("Confirm")',
    'button:has-text("Bevestig")',
    'button:has-text("Accept")',
  ]);
  if (clickedByLabel) {
    return true;
  }

  try {
    const submitButtons = page.locator('button[type="submit"]');
    const count = await submitButtons.count();
    if (count >= 2) {
      await submitButtons.nth(count - 1).click();
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

async function submitDeviceApproval(page) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const currentUrl = page.url();
    if (currentUrl.includes("/device/denied")) {
      throw new Error("WorkOS device authorization was denied.");
    }

    const approved = await page.evaluate(() => {
      const text = (document.body?.innerText ?? "").toLowerCase();
      return (
        text.includes("you can close") ||
        text.includes("device authorized") ||
        text.includes("successfully approved") ||
        text.includes("toestel geaktiveer")
      );
    });
    if (approved || currentUrl.includes("/device/approved")) {
      return;
    }

    await clickApprovalAction(page);
    await wait(900);
  }
}

async function clickAnySignInCallToAction(page) {
  await clickFirstVisible(page, [
    'button:has-text("Sign in to continue")',
    'a:has-text("Sign in to continue")',
    'a:has-text("Continue to sign in")',
  ]);
}

async function fillUserCodeIfPrompted(page, userCode) {
  const filled = await page.evaluate((value) => {
    const candidates = Array.from(
      document.querySelectorAll(
        'input[name*="code" i], input[id*="code" i], input[autocomplete="one-time-code"]'
      )
    );

    for (const candidate of candidates) {
      if (!(candidate instanceof HTMLInputElement) || candidate.disabled) {
        continue;
      }
      candidate.focus();
      candidate.value = value;
      candidate.dispatchEvent(new Event("input", { bubbles: true }));
      candidate.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
    return false;
  }, userCode);

  if (!filled) {
    return false;
  }

  await clickFirstVisible(page, [
    'button:has-text("Continue")',
    'button:has-text("Allow")',
    'button:has-text("Authorize")',
  ]);
  await wait(1200);
  return true;
}

async function fillAndSubmitCredentials(page, email, password, userCode) {
  await page.waitForLoadState("domcontentloaded");
  await clickAnySignInCallToAction(page);
  await wait(800);

  const hasEmailInput = await page
    .locator('input[type="email"]')
    .first()
    .isVisible({ timeout: 30_000 })
    .catch(() => false);

  if (hasEmailInput) {
    const emailInput = page.locator('input[type="email"]').first();
    await emailInput.fill(email);
    await page.keyboard.press("Enter");
  }

  const passwordInput = page.locator('input[type="password"]').first();
  let hasPasswordInput = await passwordInput
    .isVisible({ timeout: 12_000 })
    .catch(() => false);
  if (!hasPasswordInput) {
    await clickFirstVisible(page, [
      'button:has-text("Continue")',
      'button[type="submit"]',
    ]);
    hasPasswordInput = await passwordInput
      .isVisible({ timeout: 18_000 })
      .catch(() => false);
  }

  if (!hasPasswordInput) {
    throw new Error("WorkOS password field did not appear.");
  }

  await passwordInput.fill(password);
  await page.keyboard.press("Enter");

  // WorkOS may require an explicit approval click after sign-in.
  await wait(1500);
  await submitDeviceApproval(page);

  if (userCode) {
    await fillUserCodeIfPrompted(page, userCode);
  }
}

async function startDeviceFlow(baseUrl, bypassSecret) {
  const response = await fetch(resolveUrl(baseUrl, "/api/auth/device/start"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(bypassSecret ? { "x-vercel-protection-bypass": bypassSecret } : {}),
    },
    body: "{}",
  });

  const payload = await response.json().catch(() => null);
  if (!(response.ok && payload)) {
    throw new Error(
      `Device flow start failed (${response.status}): ${JSON.stringify(payload)}`
    );
  }

  if (
    typeof payload.deviceCode !== "string" ||
    typeof payload.verificationUrl !== "string"
  ) {
    throw new Error(
      `Unexpected device flow start payload: ${JSON.stringify(payload)}`
    );
  }

  return {
    deviceCode: payload.deviceCode,
    verificationUrl: payload.verificationUrl,
    intervalSeconds:
      typeof payload.interval === "number" && payload.interval > 0
        ? payload.interval
        : 5,
    expiresInSeconds:
      typeof payload.expiresIn === "number" && payload.expiresIn > 0
        ? payload.expiresIn
        : 600,
  };
}

async function pollForAccessToken(
  baseUrl,
  bypassSecret,
  deviceCode,
  intervalSeconds,
  expiresInSeconds
) {
  const startedAt = Date.now();
  let intervalMs = toIntervalMs(intervalSeconds, 1000);
  const timeoutMs = Math.max(30_000, expiresInSeconds * 1000);

  while (Date.now() - startedAt < timeoutMs) {
    await wait(intervalMs + 1000);

    const payload = await pollDeviceTokenEndpoint({
      baseUrl,
      bypassSecret,
      deviceCode,
    });

    const successToken = resolveSuccessToken(payload);
    if (successToken) {
      return successToken;
    }

    if (payload.status === "authorization_pending") {
      intervalMs = Math.max(
        intervalMs,
        toIntervalMs(payload.interval, intervalMs)
      );
      continue;
    }

    if (payload.status === "slow_down") {
      intervalMs = Math.max(
        intervalMs + 5000,
        toIntervalMs(payload.interval, intervalMs + 5000)
      );
      continue;
    }

    if (isTerminalTokenError(payload.status)) {
      throw new Error(`Device flow ended with status ${payload.status}`);
    }

    throw new Error(
      `Unexpected device flow poll status: ${JSON.stringify(payload)}`
    );
  }

  throw new Error("Device flow token polling timed out.");
}

function toIntervalMs(intervalSeconds, fallbackMs) {
  if (typeof intervalSeconds === "number" && intervalSeconds > 0) {
    return intervalSeconds * 1000;
  }
  return fallbackMs;
}

function isTerminalTokenError(status) {
  return status === "expired_token" || status === "invalid_grant";
}

function resolveSuccessToken(payload) {
  if (payload.status === "success" && typeof payload.accessToken === "string") {
    return payload.accessToken;
  }
  return null;
}

async function pollDeviceTokenEndpoint({ baseUrl, bypassSecret, deviceCode }) {
  const response = await fetch(resolveUrl(baseUrl, "/api/auth/device/token"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(bypassSecret ? { "x-vercel-protection-bypass": bypassSecret } : {}),
    },
    body: JSON.stringify({ deviceCode }),
  });

  const payload = await response.json().catch(() => null);
  if (!(response.ok && payload) || typeof payload.status !== "string") {
    throw new Error(
      `Device flow poll failed (${response.status}): ${JSON.stringify(payload)}`
    );
  }
  return payload;
}

async function main() {
  const baseUrl = getEnv("TARGET_URL");
  const email = getEnv("SKETCHI_E2E_EMAIL");
  const password = getEnv("SKETCHI_E2E_PASSWORD");
  const bypassSecret = process.env.BYPASS_SECRET?.trim() ?? "";

  const started = await startDeviceFlow(baseUrl, bypassSecret);
  console.error(
    `[device-flow] started (interval=${started.intervalSeconds}s, expires=${started.expiresInSeconds}s)`
  );

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(started.verificationUrl, { waitUntil: "domcontentloaded" });
    await fillAndSubmitCredentials(page, email, password, started.userCode);
    await wait(1500);
    await context.close();
  } finally {
    await browser.close();
  }

  const accessToken = await pollForAccessToken(
    baseUrl,
    bypassSecret,
    started.deviceCode,
    started.intervalSeconds,
    started.expiresInSeconds
  );
  logAccessTokenClaims(accessToken);

  process.stdout.write(accessToken);
}

await main();
