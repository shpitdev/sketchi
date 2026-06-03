import { flowchartFixture } from "@sketchi/diagram-core";
import { describe, expect, test } from "vitest";
import { renderIntermediateDiagram } from "./index";

describe("renderIntermediateDiagram", () => {
  test("renders one shape and one label per node", () => {
    const scene = renderIntermediateDiagram(flowchartFixture);

    expect(scene.stats.nodeCount).toBe(4);
    expect(scene.stats.edgeCount).toBe(3);
    expect(
      scene.elements.filter((element) => element.type === "rectangle")
    ).toHaveLength(4);
    expect(
      scene.elements.filter((element) => element.type === "text")
    ).toHaveLength(4);
    expect(
      scene.elements.filter((element) => element.type === "arrow")
    ).toHaveLength(3);
  });

  test("is deterministic for identical input", () => {
    const first = renderIntermediateDiagram(flowchartFixture);
    const second = renderIntermediateDiagram(flowchartFixture);

    expect(second).toEqual(first);
  });
});
