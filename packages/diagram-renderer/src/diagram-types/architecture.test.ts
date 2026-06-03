import { architectureFixture } from "@sketchi/diagram-core";
import { describe, expect, it } from "vitest";

import { renderIntermediateDiagram } from "../scene";

describe("Architecture renderer contract", () => {
  it("renders the generated fixture into deterministic scene elements", () => {
    const scene = renderIntermediateDiagram(architectureFixture);

    expect(scene.appState.diagramType).toBe("architecture");
    expect(scene.stats.nodeCount).toBe(architectureFixture.nodes.length);
    expect(scene.stats.edgeCount).toBe(architectureFixture.edges.length);
    expect(
      scene.elements.filter((element) => element.type === "rectangle")
    ).toHaveLength(architectureFixture.nodes.length);
    expect(
      scene.elements.filter((element) => element.type === "arrow")
    ).toHaveLength(architectureFixture.edges.length);
  });
});
