import { describe, expect, it } from "vitest";

import { mindmapFixture } from "@sketchi/diagram-core";

import { renderIntermediateDiagram } from "../scene";

function expectHorizontalHierarchyRoutes(direction: "LR" | "RL"): void {
  const scene = renderIntermediateDiagram({
    ...mindmapFixture,
    layout: { ...mindmapFixture.layout, direction },
  });
  const nodes = scene.elements.filter((element) => element.type === "node");
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  const arrows = scene.elements.filter((element) => element.type === "arrow");

  for (const arrow of arrows) {
    const source = byId.get(arrow.sourceNodeId);
    const target = byId.get(arrow.targetNodeId);
    const start = arrow.points[0];
    const end = arrow.points.at(-1);
    if (!source || !target || !start || !end) {
      throw new Error(`Missing route geometry for ${arrow.edgeId}.`);
    }

    if (direction === "LR") {
      expect(start.x).toBe(source.x + source.width);
      expect(end.x).toBe(target.x);
      expect(
        arrow.points.every((point) => point.x >= start.x && point.x <= end.x),
      ).toBe(true);
    } else {
      expect(start.x).toBe(source.x);
      expect(end.x).toBe(target.x + target.width);
      expect(
        arrow.points.every((point) => point.x <= start.x && point.x >= end.x),
      ).toBe(true);
    }

    for (let index = 0; index < arrow.points.length - 1; index += 1) {
      const segmentStart = arrow.points[index];
      const segmentEnd = arrow.points[index + 1];
      if (!segmentStart || !segmentEnd) continue;
      for (let step = 1; step < 20; step += 1) {
        const ratio = step / 20;
        const point = {
          x: segmentStart.x + (segmentEnd.x - segmentStart.x) * ratio,
          y: segmentStart.y + (segmentEnd.y - segmentStart.y) * ratio,
        };
        expect(
          nodes.some(
            (node) =>
              node.nodeId !== arrow.sourceNodeId &&
              node.nodeId !== arrow.targetNodeId &&
              point.x > node.x &&
              point.x < node.x + node.width &&
              point.y > node.y &&
              point.y < node.y + node.height,
          ),
        ).toBe(false);
      }
    }
  }
}

describe("Mindmap renderer contract", () => {
  it("renders the generated fixture into deterministic scene elements", () => {
    const scene = renderIntermediateDiagram(mindmapFixture);

    expect(scene.diagramId).toBe("public-mindmap-capability");
    expect(
      scene.elements.filter((element) => element.type === "node"),
    ).toHaveLength(mindmapFixture.nodes.length);
    expect(
      scene.elements.filter((element) => element.type === "arrow"),
    ).toHaveLength(mindmapFixture.edges.length);
    const nodes = scene.elements.filter((element) => element.type === "node");
    const byId = new Map(nodes.map((node) => [node.nodeId, node]));
    expect(byId.get("topic-0")?.x).toBeLessThan(byId.get("topic-0-0")?.x ?? 0);
    expect(byId.get("topic-0-0")?.x).toBeLessThan(
      byId.get("topic-0-0-0")?.x ?? 0,
    );
    expect(byId.get("topic-0-0-0")?.y ?? 0).toBeLessThan(
      byId.get("topic-0-0-1")?.y ?? 0,
    );
  });

  it("uses forward horizontal ports without exterior loops in LR layout", () => {
    expectHorizontalHierarchyRoutes("LR");
  });

  it("uses forward horizontal ports without backtracking in RL layout", () => {
    expectHorizontalHierarchyRoutes("RL");
  });
});
