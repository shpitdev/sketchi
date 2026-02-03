import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const createOpenRouter = vi.fn(() => ({
  chat: vi.fn(() => ({ id: "mock-model" })),
}));

vi.mock("@openrouter/ai-sdk-provider", () => ({
  createOpenRouter,
}));

describe("createOpenRouterChatModel", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = {
      ...originalEnv,
      OPENROUTER_API_KEY: "test-key",
      SKETCHI_APP_URL: "https://example.com",
      VERCEL_ENV: "production",
    };
    createOpenRouter.mockClear();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test("sets headers and metadata for OpenRouter calls", async () => {
    const { createOpenRouterChatModel } = await import("./openrouter");

    createOpenRouterChatModel({
      modelId: "google/gemini-2.5-flash-lite",
      traceId: "trace-123",
      profileId: "general",
      userId: "user-1",
    });

    expect(createOpenRouter).toHaveBeenCalledTimes(1);
    const createArgs = createOpenRouter.mock.calls[0]?.[0] as {
      headers?: Record<string, string>;
      apiKey?: string;
      compatibility?: string;
    };
    expect(createArgs?.apiKey).toBe("test-key");
    expect(createArgs?.compatibility).toBe("strict");
    expect(createArgs?.headers?.["HTTP-Referer"]).toBe("https://example.com");
    expect(createArgs?.headers?.["X-Title"]).toBe("sketchi (prod)");

    const chat = createOpenRouter.mock.results[0]?.value?.chat as ReturnType<
      typeof vi.fn
    >;
    expect(chat).toHaveBeenCalledWith(
      "google/gemini-2.5-flash-lite",
      expect.objectContaining({
        user: "user-1",
        extraBody: expect.objectContaining({
          session_id: "trace-123",
          metadata: expect.objectContaining({
            traceId: "trace-123",
            profileId: "general",
            env: "prod",
            appUrl: "https://example.com",
          }),
        }),
      })
    );
  });
});
