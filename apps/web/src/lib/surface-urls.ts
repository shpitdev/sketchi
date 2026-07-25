export interface WebSurfaceUrls {
  icons: string;
  playground: string;
}

export interface WebSurfaceEnv {
  SKETCHI_ICONS_URL?: string;
  SKETCHI_PLAYGROUND_URL?: string;
}

export const PRODUCT_SURFACE_HOSTS = {
  docs: "sketchi.app/docs",
  icons: "icons.sketchi.app",
  playground: "playground.sketchi.app",
} as const;

export const LOCAL_WEB_SURFACE_URLS: WebSurfaceUrls = {
  icons: "http://localhost:6203",
  playground: "http://localhost:6310",
};

// Worker hostnames are an implementation detail and must never reach a user.
// The defaults are the public product hosts; a PR preview is the one place a
// Worker hostname is the correct link target, and it only ever arrives through
// the SKETCHI_*_URL vars the preview workflow injects into the PR Worker.
export const DEFAULT_WEB_SURFACE_URLS: WebSurfaceUrls = {
  icons: `https://${PRODUCT_SURFACE_HOSTS.icons}`,
  playground: `https://${PRODUCT_SURFACE_HOSTS.playground}`,
};

// sketchi-allow-workers-dev: rejection pattern for the internal eval Worker,
// which is never a public link target. This value is matched, never rendered.
const INTERNAL_EVAL_WORKER_HOST =
  /^sketchi-playground(?:-pr(?:-[a-z0-9-]+)?)?\.dimethyl\.workers\.dev$/i;

function cleanHttpUrl(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }

  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString().replace(/\/$/, "")
      : fallback;
  } catch {
    return fallback;
  }
}

function cleanPublicPlaygroundUrl(value: unknown): string {
  const fallback = DEFAULT_WEB_SURFACE_URLS.playground;
  const url = cleanHttpUrl(value, fallback);
  const hostname = new URL(url).hostname.replace(/\.+$/, "");

  return INTERNAL_EVAL_WORKER_HOST.test(hostname) ? fallback : url;
}

export function resolveWebSurfaceUrls(env: WebSurfaceEnv = {}): WebSurfaceUrls {
  return {
    icons: cleanHttpUrl(env.SKETCHI_ICONS_URL, DEFAULT_WEB_SURFACE_URLS.icons),
    playground: cleanPublicPlaygroundUrl(env.SKETCHI_PLAYGROUND_URL),
  };
}

export function surfaceLinkLabel(href: string, fallback: string): string {
  try {
    return new URL(href).host;
  } catch {
    return fallback;
  }
}
