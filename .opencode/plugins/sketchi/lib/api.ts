export async function fetchJson<T>(
  url: string,
  options: RequestInit,
  abort?: AbortSignal,
  timeoutMs = 60_000
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  if (abort) {
    if (abort.aborted) {
      controller.abort();
    } else {
      abort.addEventListener("abort", () => controller.abort(), { once: true });
    }
  }
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Request failed (${response.status}): ${text}`);
    }
    if (!text) {
      throw new Error("Empty response body");
    }
    return JSON.parse(text) as T;
  } finally {
    clearTimeout(timeout);
  }
}

export async function shareElements(
  apiBase: string,
  input: {
    elements: Record<string, unknown>[];
    appState?: Record<string, unknown>;
  },
  abort?: AbortSignal,
  timeoutMs?: number
): Promise<{ url: string; shareId: string; encryptionKey: string }> {
  return await fetchJson<{ url: string; shareId: string; encryptionKey: string }>(
    `${apiBase}/api/diagrams/share`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        elements: input.elements,
        appState: input.appState ?? {},
      }),
    },
    abort,
    timeoutMs
  );
}