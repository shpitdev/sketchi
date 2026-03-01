import { resolveUrl } from "./utils";
import { sleep, waitForCondition } from "./wait";

interface AuthPage {
  evaluate: <T, Args extends unknown[]>(
    fn: (...args: Args) => T,
    ...args: Args
  ) => Promise<T>;
  goto: (
    url: string,
    options?: { waitUntil?: "domcontentloaded" }
  ) => Promise<unknown>;
  keyboard?: {
    press: (key: string) => Promise<void>;
  };
  locator: (selector: string) => {
    click: () => Promise<void>;
    fill: (value: string) => Promise<void>;
    first: () => {
      click: () => Promise<void>;
      fill: (value: string) => Promise<void>;
      isVisible: (options?: { timeout?: number }) => Promise<boolean>;
    };
  };
  url: () => string;
}

function getCredential(name: string): string | null {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : null;
}

function getAuthCredentials():
  | { email: string; password: string }
  | { email: null; password: null } {
  const email =
    getCredential("SKETCHI_E2E_EMAIL") ?? getCredential("E2E_WORKOS_EMAIL");
  const password =
    getCredential("SKETCHI_E2E_PASSWORD") ??
    getCredential("E2E_WORKOS_PASSWORD");

  if (!(email && password)) {
    return { email: null, password: null };
  }

  return { email, password };
}

async function pageHasSelector(page: AuthPage, selector: string) {
  return await page.evaluate((querySelector) => {
    return Boolean(document.querySelector(querySelector));
  }, selector);
}

async function clickIfVisible(page: AuthPage, selector: string) {
  try {
    const target = page.locator(selector).first();
    const visible = await target.isVisible({ timeout: 1500 });
    if (visible) {
      await target.click();
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

async function waitForDiagramsReturn(page: AuthPage, label: string) {
  const returnedToDiagrams = await waitForCondition(
    () => page.url().includes("/diagrams"),
    { timeoutMs: 60_000, label }
  );
  if (!returnedToDiagrams) {
    throw new Error(`Expected redirect back to /diagrams, got ${page.url()}`);
  }
}

async function continueFromSignedInPage(page: AuthPage): Promise<boolean> {
  const clicked = await clickIfVisible(page, 'a:has-text("Continue")');
  if (!clicked) {
    return false;
  }
  await waitForDiagramsReturn(page, "auth-continue-diagrams");
  return true;
}

async function openHostedSignInIfNeeded(page: AuthPage): Promise<void> {
  if (!page.url().includes("/sign-in")) {
    return;
  }

  const signInHref = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll("a"));
    const continueLink = links.find((link) =>
      link.textContent?.toLowerCase().includes("continue to sign in")
    );
    return continueLink?.href ?? null;
  });

  if (!signInHref) {
    return;
  }

  await page.goto(signInHref, {
    waitUntil: "domcontentloaded",
  });
  await sleep(1200);
}

async function ensureCredentialsForm(page: AuthPage): Promise<void> {
  const reachedCredentialsForm = await waitForCondition(
    async () => {
      const hasPassword = await pageHasSelector(page, 'input[type="password"]');
      if (hasPassword) {
        return true;
      }
      return await pageHasSelector(page, 'input[type="email"]');
    },
    { timeoutMs: 30_000, label: "workos-credentials-form" }
  );
  if (!reachedCredentialsForm) {
    throw new Error("WorkOS email input did not appear.");
  }
}

async function submitEmailStep(page: AuthPage, email: string): Promise<void> {
  const hasPasswordFieldFirst = await pageHasSelector(
    page,
    'input[type="password"]'
  );
  if (hasPasswordFieldFirst) {
    return;
  }

  await page.locator('input[type="email"]').first().fill(email);
  if (page.keyboard) {
    await page.keyboard.press("Enter");
    return;
  }
  await clickIfVisible(page, 'button[type="submit"]');
}

async function submitPasswordStep(
  page: AuthPage,
  password: string
): Promise<void> {
  let hasPasswordField = await waitForCondition(
    () => pageHasSelector(page, 'input[type="password"]'),
    { timeoutMs: 12_000, label: "workos-password-input-enter" }
  );
  if (!hasPasswordField) {
    await clickIfVisible(page, 'button[type="submit"]');
    hasPasswordField = await waitForCondition(
      () => pageHasSelector(page, 'input[type="password"]'),
      { timeoutMs: 12_000, label: "workos-password-input-submit" }
    );
  }

  if (!hasPasswordField) {
    throw new Error("WorkOS password input did not appear.");
  }

  await page.locator('input[type="password"]').first().fill(password);
  if (page.keyboard) {
    await page.keyboard.press("Enter");
    return;
  }
  await clickIfVisible(page, 'button[type="submit"]');
}

export async function ensureSignedInForDiagrams(
  page: AuthPage,
  baseUrl: string
): Promise<void> {
  const credentials = getAuthCredentials();

  await page.goto(resolveUrl(baseUrl, "/diagrams"), {
    waitUntil: "domcontentloaded",
  });
  await sleep(1500);

  if (!page.url().includes("/sign-in")) {
    return;
  }

  const clickedContinueToSignIn = await clickIfVisible(
    page,
    'a:has-text("Continue to sign in")'
  );
  const continued =
    clickedContinueToSignIn || (await continueFromSignedInPage(page));
  const hasCredentials = Boolean(credentials.email && credentials.password);
  if (!(continued || hasCredentials)) {
    throw new Error(
      "Diagram Studio requires sign-in. Set SKETCHI_E2E_EMAIL and SKETCHI_E2E_PASSWORD for authenticated E2E."
    );
  }

  if (!page.url().includes("/diagrams")) {
    await openHostedSignInIfNeeded(page);
    if (!(credentials.email && credentials.password)) {
      throw new Error(
        "Diagram Studio requires sign-in. Set SKETCHI_E2E_EMAIL and SKETCHI_E2E_PASSWORD for authenticated E2E."
      );
    }
    await ensureCredentialsForm(page);
    await submitEmailStep(page, credentials.email);
    await submitPasswordStep(page, credentials.password);
    await waitForDiagramsReturn(page, "auth-return-diagrams");
  }
}
