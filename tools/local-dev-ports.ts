const INSPECTOR_PORT_OFFSET = 10_000;

function readPort(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  const value = raw ? Number.parseInt(raw, 10) : fallback;

  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`${name} must be a valid TCP port.`);
  }

  return value;
}

export function localDevPort(fallback: number): number {
  return readPort("PORT", fallback);
}

export function localInspectorPort(fallbackAppPort: number): number {
  const value = localDevPort(fallbackAppPort) + INSPECTOR_PORT_OFFSET;

  if (value > 65_535) {
    throw new Error("Cloudflare inspector port must be a valid TCP port.");
  }

  return value;
}

export function localViteCacheDir(appName: string): string {
  return new URL(`../node_modules/.vite/apps/${appName}`, import.meta.url)
    .pathname;
}
