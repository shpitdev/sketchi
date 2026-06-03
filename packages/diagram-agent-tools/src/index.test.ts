import { describe, expect, test } from "vitest";

import {
  DIAGRAM_AGENT_GRADE_LIMIT_HINT,
  DIAGRAM_AGENT_MERMAID_GUARDRAIL,
  DIAGRAM_AGENT_TOOL_DESCRIPTIONS,
  DIAGRAM_AGENT_TOOL_INPUT_SCHEMAS,
  DIAGRAM_AGENT_TOOL_NAMES,
  DIAGRAM_AGENT_TOOL_SELECTION_HINT,
  getDiagramAgentToolDescriptor,
  getDiagramAgentToolDescriptors,
  getDiagramAgentToolNames,
} from "./index";

describe("diagram agent tool catalog", () => {
  test("keeps a stable tool order for host adapters", () => {
    expect(getDiagramAgentToolNames()).toEqual([
      "diagram_from_prompt",
      "diagram_tweak",
      "diagram_restructure",
      "diagram_to_png",
      "diagram_grade",
    ]);
  });

  test("has a JSON-serializable MCP-shaped descriptor for every tool", () => {
    const descriptors = getDiagramAgentToolDescriptors();

    expect(descriptors).toHaveLength(DIAGRAM_AGENT_TOOL_NAMES.length);

    for (const descriptor of descriptors) {
      expect(descriptor.description.length).toBeGreaterThan(80);
      expect(descriptor.inputSchema.type).toBe("object");
      expect(JSON.parse(JSON.stringify(descriptor))).toEqual(descriptor);
    }
  });

  test("embeds routing and Mermaid guardrails in reusable prompt text", () => {
    const guidance = [
      DIAGRAM_AGENT_TOOL_SELECTION_HINT,
      DIAGRAM_AGENT_MERMAID_GUARDRAIL,
      DIAGRAM_AGENT_GRADE_LIMIT_HINT,
    ]
      .join("\n")
      .toLowerCase();

    expect(guidance).toContain("diagram_from_prompt");
    expect(guidance).toContain("diagram_tweak");
    expect(guidance).toContain("diagram_restructure");
    expect(guidance).toContain("diagram_to_png");
    expect(guidance).toContain("diagram_grade");
    expect(guidance).toContain("instead of writing mermaid");
    expect(guidance).toContain("one diagram_grade call per assistant message");
  });

  test("keeps descriptors, descriptions, and input schemas aligned", () => {
    for (const toolName of DIAGRAM_AGENT_TOOL_NAMES) {
      const descriptor = getDiagramAgentToolDescriptor(toolName);

      expect(descriptor.description).toBe(
        DIAGRAM_AGENT_TOOL_DESCRIPTIONS[toolName]
      );
      expect(descriptor.inputSchema).toBe(
        DIAGRAM_AGENT_TOOL_INPUT_SCHEMAS[toolName]
      );
    }
  });
});
