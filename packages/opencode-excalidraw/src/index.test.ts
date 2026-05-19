import { describe, expect, test } from "bun:test";

import SketchiPlugin from "./index";

const VALID_GRADE_JSON = JSON.stringify({
  diagramType: {
    expected: "architecture",
    actual: "architecture",
    matches: true,
    notes: [],
  },
  arrowDirectionality: { score: 4, issues: [] },
  layout: { score: 4, issues: [] },
  visualQuality: { score: 4, issues: [] },
  accuracy: { score: 4, issues: [] },
  completeness: { score: 4, issues: [] },
  overallScore: 4,
  notes: [],
});

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitFor(
  condition: () => boolean,
  timeoutMs = 1000
): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("Timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function createPluginInput(client: unknown = {}) {
  const cwd = process.cwd();

  return {
    client: client as never,
    project: {
      id: "test-project",
      name: "test-project",
      root: cwd,
    } as never,
    directory: cwd,
    worktree: cwd,
    serverUrl: new URL("http://localhost:0"),
    $: {} as never,
  };
}

function createToolContext(messageID: string) {
  const cwd = process.cwd();
  return {
    sessionID: "session-1",
    messageID,
    agent: "build",
    directory: cwd,
    worktree: cwd,
    abort: new AbortController().signal,
    metadata: () => undefined,
    ask: async () => undefined,
  };
}

describe("SketchiPlugin", () => {
  test("injects sketchi-diagram routing system hints for diagram requests", async () => {
    const plugin = await SketchiPlugin(createPluginInput());
    const chatMessageHook = plugin["chat.message"];

    expect(typeof chatMessageHook).toBe("function");

    const output = {
      message: { system: undefined } as { system?: string },
      parts: [{ type: "text", text: "Please create an excalidraw diagram." }],
    };

    await chatMessageHook?.(
      {
        sessionID: "session-1",
        messageID: "message-1",
      },
      output as never
    );

    const combined = (output.message.system ?? "").toLowerCase();
    expect(combined).toContain("sketchi-diagram subagent");
    expect(combined).toContain("delegate to sketchi-diagram");
    expect(combined).toContain("instead of writing mermaid");
  });

  test("does not inject sketchi-diagram routing hints for unrelated requests", async () => {
    const plugin = await SketchiPlugin(createPluginInput());
    const chatMessageHook = plugin["chat.message"];

    expect(typeof chatMessageHook).toBe("function");

    const output = {
      message: { system: undefined } as { system?: string },
      parts: [{ type: "text", text: "What tools are available for git?" }],
    };

    await chatMessageHook?.(
      {
        sessionID: "session-1",
        messageID: "message-2",
      },
      output as never
    );

    expect(output.message.system).toBeUndefined();
  });

  test("registers sketchi-diagram subagent via config hook", async () => {
    const plugin = await SketchiPlugin(createPluginInput());
    const configHook = plugin.config;
    expect(typeof configHook).toBe("function");

    const config = {
      agent: {
        build: { description: "default build agent" },
        plan: { description: "default plan agent" },
      },
    };

    await configHook?.(config as never);

    expect(config.agent.build?.description).toBe("default build agent");
    expect(config.agent.plan?.description).toBe("default plan agent");

    const sketchiDiagram = (config.agent as Record<string, unknown>)[
      "sketchi-diagram"
    ] as Record<string, unknown> | undefined;

    expect(sketchiDiagram?.mode).toBe("subagent");
    expect(sketchiDiagram?.hidden).toBe(false);
    expect((sketchiDiagram?.description as string).toLowerCase()).toContain(
      "prefer this over mermaid"
    );
    expect(config.provider?.sketchi?.models?.auth?.id).toBe("auth");
  });

  test("tool descriptions steer away from Mermaid", async () => {
    const plugin = await SketchiPlugin(createPluginInput());

    const fromPromptDescription = plugin.tool?.diagram_from_prompt?.description;
    const tweakDescription = plugin.tool?.diagram_tweak?.description;

    expect(fromPromptDescription?.toLowerCase()).toContain("mermaid");
    expect(tweakDescription?.toLowerCase()).toContain("mermaid");
  });

  test("exposes Sketchi OAuth device-flow auth", async () => {
    const plugin = await SketchiPlugin(createPluginInput());

    expect(plugin.auth?.provider).toBe("sketchi");
    expect(plugin.auth?.methods).toHaveLength(1);

    const method = plugin.auth?.methods[0];
    expect(method?.type).toBe("oauth");
    expect(method?.label.toLowerCase()).toContain("device flow");
  });

  test("canonicalizes sketchi.app API base to www for auth device start", async () => {
    const originalFetch = globalThis.fetch;
    const originalApiBase = process.env.SKETCHI_API_URL;
    const requestedUrls: string[] = [];

    globalThis.fetch = ((input) => {
      let url: string;
      if (typeof input === "string") {
        url = input;
      } else if (input instanceof URL) {
        url = input.toString();
      } else {
        url = input.url;
      }
      requestedUrls.push(url);
      return new Response(
        JSON.stringify({
          deviceCode: "device-code",
          userCode: "ABCD-EFGH",
          interval: 5,
          expiresIn: 600,
          verificationUrl: "https://www.sketchi.app/device",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      );
    }) as typeof fetch;

    process.env.SKETCHI_API_URL = "https://sketchi.app/";

    try {
      const plugin = await SketchiPlugin(createPluginInput());
      const method = plugin.auth?.methods?.[0];
      expect(method?.type).toBe("oauth");

      const authStart = await method?.authorize();
      expect(authStart?.url).toBe("https://www.sketchi.app/device");
      expect(requestedUrls[0]).toBe(
        "https://www.sketchi.app/api/auth/device/start"
      );
    } finally {
      globalThis.fetch = originalFetch;
      if (originalApiBase === undefined) {
        process.env.SKETCHI_API_URL = undefined;
      } else {
        process.env.SKETCHI_API_URL = originalApiBase;
      }
    }
  });

  test("device-flow callback returns the rotated refresh token", async () => {
    const originalFetch = globalThis.fetch;
    const originalSetTimeout = globalThis.setTimeout;
    const requestedUrls: string[] = [];

    globalThis.fetch = ((input) => {
      let url: string;
      if (typeof input === "string") {
        url = input;
      } else if (input instanceof URL) {
        url = input.toString();
      } else {
        url = input.url;
      }

      requestedUrls.push(url);

      if (url.endsWith("/api/auth/device/start")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              deviceCode: "device-code",
              userCode: "ABCD-EFGH",
              interval: 1,
              expiresIn: 600,
              verificationUrl: "https://www.sketchi.app/device",
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            }
          )
        );
      }

      return Promise.resolve(
        new Response(
          JSON.stringify({
            status: "success",
            accessToken: "fresh-access-token",
            refreshToken: "fresh-refresh-token",
            accessTokenExpiresAt: Date.now() + 60_000,
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      );
    }) as typeof fetch;

    globalThis.setTimeout = ((handler: TimerHandler) => {
      if (typeof handler === "function") {
        handler();
      }
      return 0 as never;
    }) as typeof setTimeout;

    try {
      const plugin = await SketchiPlugin(createPluginInput());
      const method = plugin.auth?.methods?.[0];
      expect(method?.type).toBe("oauth");

      const authStart = await method?.authorize();
      const authResult = await authStart?.callback();

      expect(authResult).toEqual({
        type: "success",
        provider: "sketchi",
        access: "fresh-access-token",
        refresh: "fresh-refresh-token",
        expires: authResult?.expires,
      });
      expect(requestedUrls).toEqual([
        "https://www.sketchi.app/api/auth/device/start",
        "https://www.sketchi.app/api/auth/device/token",
      ]);
    } finally {
      globalThis.fetch = originalFetch;
      globalThis.setTimeout = originalSetTimeout;
    }
  });

  test("diagram_grade blocks concurrent calls for the same message", async () => {
    const deferred = createDeferred<{
      data: { parts: Array<{ type: string; text: string }> };
    }>();
    const promptCalls: unknown[] = [];

    const plugin = await SketchiPlugin(
      createPluginInput({
        session: {
          prompt: (input: unknown) => {
            promptCalls.push(input);
            return deferred.promise;
          },
        },
      })
    );

    const gradeTool = plugin.tool?.diagram_grade;
    expect(gradeTool).toBeDefined();
    if (!gradeTool) {
      throw new Error("diagram_grade tool missing");
    }

    const context = createToolContext("message-grade-concurrent");
    const firstCall = gradeTool.execute(
      { prompt: "grade first", pngPath: "/tmp/first.png" },
      context as never
    );

    await waitFor(() => promptCalls.length === 1);

    await expect(
      gradeTool.execute(
        { prompt: "grade second", pngPath: "/tmp/second.png" },
        context as never
      )
    ).rejects.toThrow("one image per message");

    expect(promptCalls.length).toBe(1);

    deferred.resolve({
      data: {
        parts: [{ type: "text", text: VALID_GRADE_JSON }],
      },
    });

    await expect(firstCall).resolves.toContain('"overallScore": 4');
  });

  test("diagram_grade allows only one call per message even sequentially", async () => {
    const promptCalls: unknown[] = [];

    const plugin = await SketchiPlugin(
      createPluginInput({
        session: {
          prompt: (input: unknown) => {
            promptCalls.push(input);
            return {
              data: {
                parts: [{ type: "text", text: VALID_GRADE_JSON }],
              },
            };
          },
        },
      })
    );

    const gradeTool = plugin.tool?.diagram_grade;
    expect(gradeTool).toBeDefined();
    if (!gradeTool) {
      throw new Error("diagram_grade tool missing");
    }

    const context = createToolContext("message-grade-sequential");
    await gradeTool.execute(
      { prompt: "grade first", pngPath: "/tmp/first.png" },
      context as never
    );

    await expect(
      gradeTool.execute(
        { prompt: "grade second", pngPath: "/tmp/second.png" },
        context as never
      )
    ).rejects.toThrow("one image per message");

    expect(promptCalls.length).toBe(1);
  });

  test("diagram tools fail fast when stored Sketchi oauth is expired and refresh fails", async () => {
    const originalFetch = globalThis.fetch;
    const authSetCalls: unknown[] = [];

    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          status: "invalid_grant",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      )) as typeof fetch;

    try {
      const plugin = await SketchiPlugin(
        createPluginInput({
          auth: {
            set: (input: unknown) => {
              authSetCalls.push(input);
              return Promise.resolve();
            },
          },
        })
      );

      await plugin.auth?.loader?.(
        async () => ({
          type: "oauth",
          access: "expired-access",
          refresh: "legacy-refresh",
          expires: Date.now() - 1,
        }),
        {} as never
      );

      const fromPrompt = plugin.tool?.diagram_from_prompt;
      expect(fromPrompt).toBeDefined();
      if (!fromPrompt) {
        throw new Error("diagram_from_prompt tool missing");
      }

      await expect(
        fromPrompt.execute(
          { prompt: "Create a simple flowchart." },
          createToolContext("message-expired-sketchi-auth") as never
        )
      ).rejects.toThrow("opencode auth login --provider sketchi");

      expect(authSetCalls).toHaveLength(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
