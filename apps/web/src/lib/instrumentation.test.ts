/**
 * Instrumentation: ensure Next.js App Router loads the correct Sentry config for each runtime.
 *
 * Scenarios:
 * - TS-SENTRY-1 Web: register() loads server config for node runtime.
 * - TS-SENTRY-2 Web: register() loads edge config for edge runtime.
 * - TS-SENTRY-3 Web: onRequestError is wired to Sentry captureRequestError hook.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const loaded = vi.hoisted(() => [] as Array<"server" | "edge">);
const mockCaptureRequestError = vi.hoisted(() => vi.fn());

vi.mock("../../sentry.server.config", () => {
  loaded.push("server");
  return {};
});

vi.mock("../../sentry.edge.config", () => {
  loaded.push("edge");
  return {};
});

vi.mock("@sentry/nextjs", () => ({
  captureRequestError: mockCaptureRequestError,
}));

beforeEach(() => {
  vi.unstubAllEnvs();
  loaded.length = 0;
  mockCaptureRequestError.mockClear();
});

describe("web instrumentation", () => {
  it("TS-SENTRY-1: loads server config for node runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");

    vi.resetModules();
    const { register } = await import("../../instrumentation");

    await register();

    expect(loaded).toEqual(["server"]);
  });

  it("TS-SENTRY-2: loads edge config for edge runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");

    vi.resetModules();
    const { register } = await import("../../instrumentation");

    await register();

    expect(loaded).toEqual(["edge"]);
  });

  it("TS-SENTRY-3: wires onRequestError", async () => {
    vi.resetModules();
    const { onRequestError } = await import("../../instrumentation");
    const { captureRequestError } = await import("@sentry/nextjs");

    expect(onRequestError).toBe(captureRequestError);
  });
});
