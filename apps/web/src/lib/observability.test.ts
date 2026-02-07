/**
 * Observability: stdout JSON message + Sentry message + tags.
 *
 * Scenarios:
 * - TS-OBS-3 Web: stdout JSON includes `message` and `severity`.
 * - TS-OBS-4 Web: Sentry tags are attached.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockCaptureMessage = vi.fn();
const mockFlush = vi.fn().mockResolvedValue(true);

const mockSetLevel = vi.fn();
const mockSetTag = vi.fn();
const mockSetContext = vi.fn();

const originalConsoleLog = console.log;
const mockConsoleLog = vi.fn();

vi.mock("@sentry/nextjs", () => ({
  captureMessage: mockCaptureMessage,
  flush: mockFlush,
  withScope: vi.fn((cb: (scope: unknown) => void) => {
    const scope = {
      setLevel: mockSetLevel,
      setTag: mockSetTag,
      setContext: mockSetContext,
    };
    cb(scope);
    return scope;
  }),
}));

beforeEach(() => {
  vi.stubEnv("SENTRY_LOG_SAMPLE_RATE", "1");
  vi.resetModules();

  console.log = mockConsoleLog;

  mockCaptureMessage.mockClear();
  mockFlush.mockClear();
  mockSetLevel.mockClear();
  mockSetTag.mockClear();
  mockSetContext.mockClear();

  mockConsoleLog.mockClear();
});

afterEach(() => {
  console.log = originalConsoleLog;
});

describe("web observability", () => {
  it("TS-OBS-3: writes message and severity to stdout JSON", async () => {
    const { logApiEvent } = await import("./observability");

    await logApiEvent({
      traceId: "trace-test-3",
      op: "request.complete",
      method: "POST",
      path: "/api/diagrams/tweak",
      orpcRoute: "diagrams.tweak",
      responseStatus: 200,
      durationMs: 50,
    });

    expect(mockCaptureMessage).toHaveBeenCalledTimes(1);
    const sentryMessage = mockCaptureMessage.mock.calls[0]?.[0];
    expect(typeof sentryMessage).toBe("string");
    expect(sentryMessage).toContain("web");
    expect(sentryMessage).toContain("request.complete");
    expect(sentryMessage.trim().length).toBeGreaterThan(0);

    expect(mockConsoleLog).toHaveBeenCalledTimes(1);
    const payload = mockConsoleLog.mock.calls[0]?.[0];
    expect(typeof payload).toBe("string");

    const parsed = JSON.parse(payload as string) as Record<string, unknown>;
    expect(parsed.traceId).toBe("trace-test-3");
    expect(parsed.op).toBe("request.complete");
    expect(parsed.severity).toBe("info");
    expect(parsed.message).toBe(sentryMessage);
  });

  it("TS-OBS-4: attaches tags", async () => {
    const { logApiEvent } = await import("./observability");

    await logApiEvent({
      traceId: "trace-test-4",
      op: "request.complete",
      method: "POST",
      path: "/api/diagrams/tweak",
      orpcRoute: "diagrams.tweak",
      responseStatus: 200,
      durationMs: 50,
    });

    expect(mockSetTag).toHaveBeenCalledWith("traceId", "trace-test-4");
    expect(mockSetTag).toHaveBeenCalledWith("op", "request.complete");
    expect(mockSetTag).toHaveBeenCalledWith("orpc.route", "diagrams.tweak");
    expect(mockSetTag).toHaveBeenCalledWith("http.method", "POST");
    expect(mockSetTag).toHaveBeenCalledWith("http.status_code", "200");
  });
});
