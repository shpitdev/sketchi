import { describe, expect, it } from "vitest";

import {
  buildScenarioPrompt,
  buildScenarioPromptParts,
  toDiagramGenerationPrompt,
} from "./prompt";
import { getScenario } from "./scenarios";

const scenario = getScenario("pharma-batch-disposition");

describe("scenario prompts", () => {
  it("explicitly adapts maintained scenarios to the generation prompt contract", () => {
    expect(toDiagramGenerationPrompt(scenario)).toEqual({
      id: scenario.id,
      request: scenario.prompt,
      requestedType: "flowchart",
    });
  });

  it("separates system instructions from the user scenario", () => {
    const prompt = buildScenarioPromptParts(scenario);

    expect(prompt.messages).toEqual([
      expect.objectContaining({
        role: "system",
        content: expect.stringContaining("Flowchart IR rules:"),
      }),
      expect.objectContaining({
        role: "user",
        content: expect.stringContaining("Scenario:"),
      }),
    ]);
    expect(prompt.system).not.toContain(scenario.prompt);
    expect(prompt.system).toContain("Every node must have id, label, and kind");
    expect(prompt.user).toContain(scenario.prompt);
    expect(prompt.user).not.toContain("Flowchart IR rules:");
    expect(prompt.user).not.toContain(
      "Every node must have id, label, and kind",
    );
    expect(prompt.user).toContain("caller explicitly requires flowchart");
    expect(prompt.system).toContain(
      "List every measurable scenario requirement",
    );
    expect(prompt.user).toContain('"requestedKind":"flowchart"');
  });

  it("keeps a flattened prompt for stdin-based generator commands", () => {
    const flattened = buildScenarioPrompt(scenario);

    expect(flattened).toContain("System message:");
    expect(flattened).toContain("User message:");
    expect(flattened).toContain(
      "Return only compact, minified JSON on one line.",
    );
    expect(flattened).toContain(scenario.prompt);
  });
});
