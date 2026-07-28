import { describe, expect, it } from "vitest";

import { parseIntermediateDiagram } from "../intermediate";
import {
  mindmapFixture,
  mindmapDiagramType,
  parseMindmapDiagram,
} from "./mindmap";

describe("Mindmap diagram type", () => {
  it("has a typed fixture that satisfies the intermediate diagram contract", () => {
    expect(mindmapFixture.type).toBe(mindmapDiagramType);
    expect(parseIntermediateDiagram(mindmapFixture)).toEqual(mindmapFixture);
    expect(mindmapFixture.nodes.map((node) => node.label)).toEqual([
      "Public mindmaps",
      "Semantic input",
      "Nested topics",
      "Stable ordering",
      "Artifact output",
      "Scene",
      "Excalidraw",
    ]);
  });

  it("rejects topics with multiple parents", () => {
    expect(() =>
      parseMindmapDiagram({
        ...mindmapFixture,
        edges: [
          ...mindmapFixture.edges,
          {
            id: "duplicate-parent",
            source: "topic-0-1",
            target: "topic-0-0-0",
            metadata: { depth: 2, siblingIndex: 0 },
          },
        ],
      }),
    ).toThrow(/exactly one parent/);
  });

  it("rejects inconsistent child ordering metadata", () => {
    expect(() =>
      parseMindmapDiagram({
        ...mindmapFixture,
        nodes: mindmapFixture.nodes.map((node) =>
          node.id === "topic-0-1"
            ? { ...node, metadata: { ...node.metadata, siblingIndex: 4 } }
            : node,
        ),
      }),
    ).toThrow(/metadata must match|contiguous sibling ordering/);
  });
});
