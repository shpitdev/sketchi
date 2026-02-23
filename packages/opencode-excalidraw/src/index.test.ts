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
  test("injects sketchi-diagram routing system hints", async () => {
    const plugin = await SketchiPlugin(createPluginInput());
    const transform = plugin["experimental.chat.system.transform"];

    expect(typeof transform).toBe("function");

    const output = { system: [] as string[] };
    await transform?.(
      {
        sessionID: "session-1",
        model: {
          providerID: "provider",
          modelID: "model",
        } as never,
      },
      output
    );

    const combined = output.system.join("\n").toLowerCase();
    expect(combined).toContain("sketchi-diagram subagent");
    expect(combined).toContain("delegate to sketchi-diagram");
    expect(combined).toContain("instead of writing mermaid");
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
