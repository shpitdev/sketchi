import { describe, expect, test } from "bun:test";

import SketchiPlugin from "./index";

function createPluginInput() {
  const cwd = process.cwd();

  return {
    client: {} as never,
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
      output
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
      output
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

    const sketchiDiagram = config.agent["sketchi-diagram"] as
      | Record<string, unknown>
      | undefined;

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
});
