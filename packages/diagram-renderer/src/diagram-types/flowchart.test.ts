import { flowchartFixture } from "@sketchi/diagram-core";
import { describe, expect, it } from "vitest";

import { renderIntermediateDiagram } from "../scene";

describe("Flowchart renderer contract", () => {
  it("renders the generated fixture into deterministic scene elements", () => {
    const scene = renderIntermediateDiagram(flowchartFixture);

    expect(scene.appState.diagramType).toBe("flowchart");
    expect(scene.stats.nodeCount).toBe(flowchartFixture.nodes.length);
    expect(scene.stats.edgeCount).toBe(flowchartFixture.edges.length);
    expect(
      scene.elements.filter((element) => element.type === "rectangle")
    ).toHaveLength(flowchartFixture.nodes.length);
    expect(
      scene.elements.filter((element) => element.type === "arrow")
    ).toHaveLength(flowchartFixture.edges.length);
  });
});
