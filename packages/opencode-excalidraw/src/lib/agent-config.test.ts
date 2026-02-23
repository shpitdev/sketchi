import { describe, expect, test } from "bun:test";

import {
  applySketchiDiagramAgentConfig,
  SKETCHI_DIAGRAM_AGENT_ID,
} from "./agent-config";

function getSketchiDiagramAgent(config: {
  agent?: Record<string, Record<string, unknown> | undefined>;
}): Record<string, unknown> | undefined {
  return config.agent?.[SKETCHI_DIAGRAM_AGENT_ID];
}

describe("applySketchiDiagramAgentConfig", () => {
  test("registers sketchi-diagram without touching existing primary agents", () => {
    const config = {
      agent: {
        build: { description: "build default" },
        plan: { description: "plan default" },
      },
    };

    applySketchiDiagramAgentConfig(config);

    expect(config.agent?.build).toEqual({ description: "build default" });
    expect(config.agent?.plan).toEqual({ description: "plan default" });

    const sketchiDiagram = getSketchiDiagramAgent(config);
    expect(sketchiDiagram).toBeDefined();
    expect(sketchiDiagram?.mode).toBe("subagent");
    expect(sketchiDiagram?.hidden).toBe(false);
    expect(typeof sketchiDiagram?.description).toBe("string");

    const tools = sketchiDiagram?.tools as Record<string, boolean>;
    expect(tools.diagram_from_prompt).toBe(true);
    expect(tools.diagram_tweak).toBe(true);
    expect(tools.diagram_restructure).toBe(true);
    expect(tools.diagram_to_png).toBe(true);
    expect(tools.diagram_grade).toBe(true);
  });

  test("preserves explicit sketchi-diagram overrides", () => {
    const config = {
      agent: {
        [SKETCHI_DIAGRAM_AGENT_ID]: {
          mode: "all",
          hidden: true,
          description: "custom description",
          prompt: "Custom preface",
          tools: {
            diagram_to_png: false,
          },
        },
      },
    };

    applySketchiDiagramAgentConfig(config);

    const sketchiDiagram = getSketchiDiagramAgent(config);
    expect(sketchiDiagram).toBeDefined();
    expect(sketchiDiagram?.mode).toBe("all");
    expect(sketchiDiagram?.hidden).toBe(true);
    expect(sketchiDiagram?.description).toBe("custom description");

    const tools = sketchiDiagram?.tools as Record<string, boolean>;
    expect(tools.diagram_to_png).toBe(false);
    expect(tools.diagram_from_prompt).toBe(true);
    expect(tools.diagram_tweak).toBe(true);
    expect(tools.diagram_restructure).toBe(true);
    expect(tools.diagram_grade).toBe(true);

    const prompt = sketchiDiagram?.prompt as string;
    expect(prompt).toContain("Custom preface");
    expect(prompt.toLowerCase()).toContain("role: sketchi-diagram agent.");
  });
});
