export interface WebSurfaceUrls {
  excalidraw: string;
  icons: string;
  playground: string;
}

export interface WebSurfaceEnv {
  SKETCHI_EXCALIDRAW_URL?: string;
  SKETCHI_ICONS_URL?: string;
  SKETCHI_PLAYGROUND_URL?: string;
}

export const DEFAULT_WEB_SURFACE_URLS: WebSurfaceUrls = {
  excalidraw: "https://sketchi-excalidraw.dimethyl.workers.dev",
  icons: "https://sketchi-icons.dimethyl.workers.dev",
  playground: "https://sketchi-playground.dimethyl.workers.dev",
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
    excalidraw: cleanHttpUrl(
      env.SKETCHI_EXCALIDRAW_URL,
      DEFAULT_WEB_SURFACE_URLS.excalidraw,
    ),
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
