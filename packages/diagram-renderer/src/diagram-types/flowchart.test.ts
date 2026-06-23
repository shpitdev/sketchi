import { describe, expect, it } from "vitest";

import {
  flowchartFixture,
  pharmaBatchDispositionFlowchart,
} from "@sketchi/diagram-core";

import { renderIntermediateDiagram } from "../scene";

describe("Flowchart renderer contract", () => {
  it("renders the generated fixture into deterministic scene elements", () => {
    const scene = renderIntermediateDiagram(flowchartFixture);

    expect(scene.diagramId).toBe("onboarding-flow");
    expect(
      scene.elements.filter((element) => element.type === "node"),
    ).toHaveLength(flowchartFixture.nodes.length);
    expect(
      scene.elements.filter((element) => element.type === "arrow"),
    ).toHaveLength(flowchartFixture.edges.length);
  });

  it("routes downward non-decision edges vertically before crossing ranks", () => {
    const scene = renderIntermediateDiagram(pharmaBatchDispositionFlowchart);
    const packagingArrow = scene.elements.find(
      (element) =>
        element.type === "arrow" && element.edgeId === "review-packaging",
    );

    expect(packagingArrow).toMatchObject({
      type: "arrow",
      points: expect.arrayContaining([
        expect.objectContaining({ x: expect.any(Number) }),
      ]),
    });

    if (packagingArrow?.type !== "arrow") {
      throw new Error("Expected review-packaging arrow.");
    }

    const start = packagingArrow.points[0];
    const end = packagingArrow.points[packagingArrow.points.length - 1];

    if (!start || !end) {
      throw new Error("Expected an orthogonal review-packaging route.");
    }

    for (let index = 0; index < packagingArrow.points.length - 1; index += 1) {
      const previous = packagingArrow.points[index];
      const current = packagingArrow.points[index + 1];

      if (!previous || !current) {
        throw new Error("Expected contiguous route points.");
      }

      expect(previous.x === current.x || previous.y === current.y).toBe(true);
    }

    expect(end.y).toBeGreaterThan(start.y);
  });
});
