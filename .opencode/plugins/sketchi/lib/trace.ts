import { createTraceId } from "@sketchi/shared";

export function createToolTraceId(): string {
  try {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
      return globalThis.crypto.randomUUID();
    }
  } catch {
    // Fall through.
  }

  // Fallback: stable, server-accepted trace id format.
  return createTraceId();
}

