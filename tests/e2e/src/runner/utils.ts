const LEADING_SLASH_REGEX = /^\//;

export function resolveUrl(baseUrl: string, pathname: string): string {
  if (!pathname || pathname === "/") {
    return `${baseUrl}/`;
  }
  if (pathname.startsWith("http://") || pathname.startsWith("https://")) {
    return pathname;
  }
  return `${baseUrl}/${pathname.replace(LEADING_SLASH_REGEX, "")}`;
}

export function withVercelBypass(url: string, bypassSecret?: string): string {
  if (!bypassSecret) {
    return url;
  }
  const parsed = new URL(url);
  parsed.searchParams.set("x-vercel-protection-bypass", bypassSecret);
  parsed.searchParams.set("x-vercel-set-bypass-cookie", "true");
  return parsed.toString();
}

export function toInt(value: number | undefined) {
  if (!value) {
    return 0;
  }
  return Math.round(value);
}

type ViewportSetterObject = (size: {
  width: number;
  height: number;
}) => Promise<void> | void;

type ViewportSetterNumbers = (
  width: number,
  height: number,
  options?: { deviceScaleFactor?: number }
) => Promise<void> | void;

type ViewportSetter = ViewportSetterObject | ViewportSetterNumbers;

export async function ensureDesktopViewport(page: {
  setViewportSize?: ViewportSetter;
}) {
  const setViewportSize = page.setViewportSize;
  if (typeof setViewportSize !== "function") {
    return;
  }
  try {
    if (setViewportSize.length >= 2) {
      const setViewportSizeNumbers = setViewportSize as ViewportSetterNumbers;
      await setViewportSizeNumbers(1280, 800);
      return;
    }
    const setViewportSizeObject = setViewportSize as ViewportSetterObject;
    await setViewportSizeObject({ width: 1280, height: 800 });
  } catch {
    return;
  }
}

export async function resetBrowserState(
  page: {
    context?: () => { clearCookies?: () => Promise<void> };
    goto?: (
      url: string,
      options?: { waitUntil?: "domcontentloaded" }
    ) => Promise<unknown>;
    evaluate?: <T>(fn: () => T) => Promise<T>;
  },
  baseUrl: string,
  bypassSecret?: string
) {
  try {
    await page.context?.().clearCookies?.();
  } catch {
    // ignore cookie clearing failures
  }

  try {
    await page.goto?.(withVercelBypass(baseUrl, bypassSecret), {
      waitUntil: "domcontentloaded",
    });
  } catch {
    // ignore navigation failures
  }

  try {
    await page.evaluate?.(() => {
      try {
        localStorage.clear();
        sessionStorage.clear();
        if ("caches" in window) {
          caches.keys().then((keys) => {
            for (const key of keys) {
              caches.delete(key);
            }
          });
        }
        if ("indexedDB" in window && "databases" in indexedDB) {
          indexedDB.databases().then((databases) => {
            for (const db of databases) {
              if (db?.name) {
                indexedDB.deleteDatabase(db.name);
              }
            }
          });
        }
      } catch {
        // ignore storage clearing failures
      }
    });
  } catch {
    // ignore eval failures
  }
}

export function finalizeScenario(status: "passed" | "failed") {
  const exitCode = status === "passed" ? 0 : 1;

  if (status === "passed" && process.exitCode && process.exitCode !== 0) {
    console.log(`Normalizing exit code ${process.exitCode} to 0.`);
  }

  // Force exit after a short delay to allow cleanup
  // This prevents hanging due to lingering event loop references from Stagehand/Browserbase
  setTimeout(() => {
    process.exit(exitCode);
  }, 500);
}
