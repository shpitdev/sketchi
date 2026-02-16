function createFallbackTraceId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createToolTraceId(): string {
  try {
    if (
      globalThis.crypto &&
      typeof globalThis.crypto.randomUUID === "function"
    ) {
      return globalThis.crypto.randomUUID();
    }
  } catch {
    // Fall through.
  }

  return createFallbackTraceId();
}
