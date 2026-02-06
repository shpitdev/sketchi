/**
 * Sentry config: ensure our config files actually call `init()` when loaded.
 *
 * Scenarios:
 * - TS-SENTRY-4 Web: server config calls init when imported.
 * - TS-SENTRY-5 Web: edge config calls init when imported.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockInit = vi.hoisted(() => vi.fn());

vi.mock("@sentry/nextjs", () => ({
  init: mockInit,
}));

const exampleDsn = "https://examplePublicKey@o0.ingest.sentry.io/0";

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", exampleDsn);
  mockInit.mockClear();
});

describe("web sentry configs", () => {
  it("TS-SENTRY-4: server config calls init when imported", async () => {
    vi.resetModules();
    await import("../../sentry.server.config");

    expect(mockInit).toHaveBeenCalledTimes(1);
    expect(mockInit).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: exampleDsn,
        enabled: true,
      })
    );
  });

  it("TS-SENTRY-5: edge config calls init when imported", async () => {
    vi.resetModules();
    await import("../../sentry.edge.config");

    expect(mockInit).toHaveBeenCalledTimes(1);
    expect(mockInit).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: exampleDsn,
        enabled: true,
      })
    );
  });
});
