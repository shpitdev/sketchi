import { captureRequestError } from "@sentry/nextjs";

export async function register(): Promise<void> {
  // Next.js sets NEXT_RUNTIME to "edge" for Edge Runtime and "nodejs" for Node.js runtime.
  // Default to Node.js when the env var isn't present (tests or non-Next execution).
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
    return;
  }

  await import("./sentry.server.config");
}

// Next.js App Router hook for capturing server request errors.
export const onRequestError = captureRequestError;
