import { describe, expect, it } from "vitest";

import { createFixtureGenerationClient } from "./fixture-client";
import { toDiagramGenerationPrompt } from "./prompt";
import { getScenario } from "./scenarios";

describe("scenario fixture generation client", () => {
  it("returns the maintained expected diagram for an adapted scenario", async () => {
    const scenario = getScenario("sketchi-onboarding-decision-flow");
    const candidate = await createFixtureGenerationClient().generate({
      model: "fixture",
      prompt: toDiagramGenerationPrompt(scenario),
    });

    expect(candidate.error).toBeUndefined();
    expect(candidate.diagram).toEqual(scenario.expectedDiagram);
  });
});
