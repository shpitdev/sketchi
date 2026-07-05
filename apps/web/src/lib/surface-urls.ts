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
  studio: "studio.sketchi.app",
} as const;

export const LOCAL_WEB_SURFACE_URLS: WebSurfaceUrls = {
  icons: "http://localhost:6203",
  playground: "http://localhost:6310",
};

const WORKERS_DEV_ACCOUNT = "dimethyl";

const WORKERS_DEV_WORKERS = {
  icons: "sketchi-icons",
  // apps/studio currently carries the public Playground chat surface.
  // apps/playground is the internal eval harness and is not a public link target.
  playground: "sketchi-studio",
} satisfies Record<keyof WebSurfaceUrls, string>;

function workersDevUrl(workerName: string): string {
  return `https://${workerName}.${WORKERS_DEV_ACCOUNT}.workers.dev`;
}

export const DEFAULT_WEB_SURFACE_URLS: WebSurfaceUrls = {
  icons: workersDevUrl(WORKERS_DEV_WORKERS.icons),
  playground: workersDevUrl(WORKERS_DEV_WORKERS.playground),
};

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

export function resolveWebSurfaceUrls(env: WebSurfaceEnv = {}): WebSurfaceUrls {
  return {
    icons: cleanHttpUrl(env.SKETCHI_ICONS_URL, DEFAULT_WEB_SURFACE_URLS.icons),
    playground: cleanHttpUrl(
      env.SKETCHI_PLAYGROUND_URL,
      DEFAULT_WEB_SURFACE_URLS.playground,
    ),
  };
}

export function surfaceLinkLabel(href: string, fallback: string): string {
  try {
    return new URL(href).host;
  } catch {
    return fallback;
  }
}
