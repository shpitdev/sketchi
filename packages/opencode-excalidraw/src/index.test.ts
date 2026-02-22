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
  test("injects sketchi-diagram system hints", async () => {
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
    expect(combined).toContain("sketchi-diagram agent");
    expect(combined).toContain("diagram_* tools");
    expect(combined).toContain("instead of writing mermaid");
  });

  test("tool descriptions steer away from Mermaid", async () => {
    const plugin = await SketchiPlugin(createPluginInput());

    const fromPromptDescription = plugin.tool?.diagram_from_prompt?.description;
    const tweakDescription = plugin.tool?.diagram_tweak?.description;

    expect(fromPromptDescription?.toLowerCase()).toContain("mermaid");
    expect(tweakDescription?.toLowerCase()).toContain("mermaid");
  });
});
