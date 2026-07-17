import { createProjectGraphAsync } from "@nx/devkit";
import { describe, expect, it } from "vitest";

describe("diagram generation project boundaries", () => {
  it("keeps production generation independent from eval scenarios", async () => {
    const graph = await createProjectGraphAsync({ exitOnError: true });
    const generationTargets =
      graph.dependencies["diagram-generation"]?.map(
        (dependency) => dependency.target,
      ) ?? [];
    const scenarioTargets =
      graph.dependencies["diagram-scenarios"]?.map(
        (dependency) => dependency.target,
      ) ?? [];

    expect(generationTargets).not.toContain("diagram-scenarios");
    expect(scenarioTargets).toContain("diagram-generation");
  });
});
