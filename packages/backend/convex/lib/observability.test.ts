/**
 * Observability: stdout JSON message + Sentry message + tags.
 *
 * Scenarios:
 * - TS-OBS-1 Convex: stdout JSON includes `message` and `severity`.
 * - TS-OBS-2 Convex: Sentry tags are attached.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockCaptureMessage = vi.fn();

const mockSetLevel = vi.fn();
const mockSetTag = vi.fn();
const mockSetContext = vi.fn();

const originalConsoleLog = console.log;
const mockConsoleLog = vi.fn();

vi.mock("@sentry/node", () => ({
  captureMessage: mockCaptureMessage,
  withScope: vi.fn((cb: (scope: unknown) => void) => {
    const scope = {
      setLevel: mockSetLevel,
      setTag: mockSetTag,
      setContext: mockSetContext,
    };
    cb(scope);
    return scope;
  }),
  init: vi.fn(),
  flush: vi.fn(),
  startSpan: vi.fn(),
}));

beforeEach(() => {
  vi.stubEnv("SENTRY_CONVEX_ENABLED", "1");
  vi.stubEnv("SENTRY_DSN", "https://example.invalid/123");
  vi.stubEnv("SENTRY_LOG_SAMPLE_RATE", "1");
  vi.resetModules();

  console.log = mockConsoleLog;

  mockCaptureMessage.mockClear();
  mockSetLevel.mockClear();
  mockSetTag.mockClear();
  mockSetContext.mockClear();

  mockConsoleLog.mockClear();
});

afterEach(() => {
  console.log = originalConsoleLog;
});

describe("convex observability", () => {
  it("TS-OBS-1: writes message and severity to stdout JSON", async () => {
    const { logEvent } = await import("./observability");

    await logEvent({
      traceId: "trace-test-1",
      op: "action.complete",
      stage: "convex.action",
      status: "success",
      durationMs: 123,
    });

    expect(mockCaptureMessage).toHaveBeenCalledTimes(1);
    const sentryMessage = mockCaptureMessage.mock.calls[0]?.[0];
    expect(typeof sentryMessage).toBe("string");
    expect(sentryMessage).toContain("convex");
    expect(sentryMessage).toContain("action.complete");
    expect(sentryMessage.trim().length).toBeGreaterThan(0);

    expect(mockConsoleLog).toHaveBeenCalledTimes(1);
    const payload = mockConsoleLog.mock.calls[0]?.[0];
    expect(typeof payload).toBe("string");

    const parsed = JSON.parse(payload as string) as Record<string, unknown>;
    expect(parsed.traceId).toBe("trace-test-1");
    expect(parsed.op).toBe("action.complete");
    expect(parsed.severity).toBe("info");
    expect(parsed.message).toBe(sentryMessage);
  });

  it("TS-OBS-2: attaches tags and includes key logger attributes", async () => {
    const { logEvent } = await import("./observability");

    await logEvent({
      traceId: "trace-test-2",
      op: "action.complete",
      stage: "convex.action",
      status: "success",
      actionName: "diagrams:tweakDiagram",
    });

    expect(mockSetTag).toHaveBeenCalledWith("traceId", "trace-test-2");
    expect(mockSetTag).toHaveBeenCalledWith("op", "action.complete");
    expect(mockSetTag).toHaveBeenCalledWith("stage", "convex.action");
    expect(mockSetTag).toHaveBeenCalledWith("status", "success");
    expect(mockSetTag).toHaveBeenCalledWith("action", "diagrams:tweakDiagram");

    expect(mockConsoleLog).toHaveBeenCalledTimes(1);
  });
});
