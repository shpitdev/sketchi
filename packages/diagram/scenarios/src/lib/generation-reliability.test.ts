import { describe, expect, it } from "vitest";

import { getGenerationScenario } from "./generation-registry";
import { generationReliabilityScenarios } from "./generation-reliability";
import { toDiagramGenerationPrompt } from "./prompt";

describe("generation reliability scenario registry", () => {
  it("keeps the production regression prompts and explicit outcome labels", () => {
    expect(
      getGenerationScenario("reliability-expense-resubmission-loop").prompt,
    ).toContain(
      "Employee expense approval workflow with at least 6 nodes, 7 edges, and 2 decisions",
    );
    expect(
      getGenerationScenario("reliability-expense-resubmission-loop").prompt,
    ).toContain('edge labeled "rejected"');
    expect(
      getGenerationScenario("reliability-expense-resubmission-loop").prompt,
    ).toContain(
      "back to the expense submission process, never to the start node",
    );
    expect(getGenerationScenario("reliability-wedding-richness").prompt).toBe(
      "Planning a wedding",
    );
  });

  it("keeps self-loop policy out of organic scenarios", () => {
    const returns = getGenerationScenario(
      "reliability-ecommerce-return-18-step",
    );
    const manuscript = getGenerationScenario(
      "reliability-manuscript-interacting-loops",
    );

    expect(returns.prompt).not.toContain("self-loop");
    expect(manuscript.prompt).not.toContain("self-loop");
    expect(manuscript.prompt).toContain("a separate resubmission process");
    expect(manuscript.assertions).toMatchObject({
      requiredCyclePaths: [
        {
          branchLabels: ["revision requested"],
          branchSourceNodeLabels: expect.arrayContaining(["reviews complete"]),
          cycleNodeLabelGroups: expect.arrayContaining([
            expect.arrayContaining(["author revision"]),
            expect.arrayContaining(["resubmission"]),
          ]),
        },
        {
          branchLabels: ["plagiarism flagged"],
          branchSourceNodeLabels: expect.arrayContaining(["plagiarism flag"]),
          cycleNodeLabelGroups: expect.arrayContaining([
            expect.arrayContaining(["ethics investigation"]),
            expect.arrayContaining(["editorial triage"]),
          ]),
        },
      ],
      requiredTerminalPaths: [
        {
          branchLabels: ["desk reject"],
          branchSourceNodeLabels: expect.arrayContaining(["editorial triage"]),
        },
        {
          branchLabels: ["accepted"],
          branchSourceNodeLabels: expect.arrayContaining(["editorial triage"]),
        },
      ],
    });
  });

  it("registers both large diagram types for eval-harness generation", () => {
    expect(generationReliabilityScenarios.length).toBeGreaterThanOrEqual(7);
    expect(
      toDiagramGenerationPrompt(
        getGenerationScenario("reliability-curriculum-depth-four"),
      ),
    ).toMatchObject({
      id: "reliability-curriculum-depth-four",
      requestedType: "mindmap",
    });
    expect(
      toDiagramGenerationPrompt(
        getGenerationScenario("reliability-release-train-brutal"),
      ).requestedType,
    ).toBe("flowchart");
  });
});
