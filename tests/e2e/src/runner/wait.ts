const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_INTERVAL_MS = 250;

export interface WaitOptions {
  timeoutMs?: number;
  intervalMs?: number;
  label?: string;
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForCondition(
  condition: () => Promise<boolean> | boolean,
  options: WaitOptions = {}
) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      if (await condition()) {
        return true;
      }
    } catch {
      // ignore and retry
    }
    await sleep(intervalMs);
  }
  return false;
}

export async function isVisible(
  pageOrFrame: {
    locator: (selector: string) => { isVisible: () => Promise<boolean> };
  },
  selector: string
) {
  try {
    return await pageOrFrame.locator(selector).isVisible();
  } catch {
    return false;
  }
}

export function waitForVisible(
  pageOrFrame: {
    locator: (selector: string) => { isVisible: () => Promise<boolean> };
  },
  selector: string,
  options: WaitOptions = {}
) {
  return waitForCondition(() => isVisible(pageOrFrame, selector), options);
}

export async function clickWhenVisible(
  pageOrFrame: {
    locator: (selector: string) => {
      click: () => Promise<void>;
      isVisible: () => Promise<boolean>;
    };
  },
  selector: string,
  options: WaitOptions = {}
) {
  const ok = await waitForVisible(pageOrFrame, selector, options);
  if (!ok) {
    const label = options.label ? ` (${options.label})` : "";
    throw new Error(`Timed out waiting for selector: ${selector}${label}`);
  }
  await pageOrFrame.locator(selector).click();
}

export async function fillWhenVisible(
  pageOrFrame: {
    locator: (selector: string) => {
      fill: (value: string) => Promise<void>;
      isVisible: () => Promise<boolean>;
    };
  },
  selector: string,
  value: string,
  options: WaitOptions = {}
) {
  const ok = await waitForVisible(pageOrFrame, selector, options);
  if (!ok) {
    const label = options.label ? ` (${options.label})` : "";
    throw new Error(`Timed out waiting for selector: ${selector}${label}`);
  }
  await pageOrFrame.locator(selector).fill(value);
}

export function waitForUrl(
  page: { url: () => string },
  predicate: (url: string) => boolean,
  options: WaitOptions = {}
) {
  return waitForCondition(() => predicate(page.url()), options);
}
