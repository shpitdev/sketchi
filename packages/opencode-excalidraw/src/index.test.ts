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
  });

  test("tool descriptions steer away from Mermaid", async () => {
    const plugin = await SketchiPlugin(createPluginInput());

    const fromPromptDescription = plugin.tool?.diagram_from_prompt?.description;
    const tweakDescription = plugin.tool?.diagram_tweak?.description;

    expect(fromPromptDescription?.toLowerCase()).toContain("mermaid");
    expect(tweakDescription?.toLowerCase()).toContain("mermaid");
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
});
