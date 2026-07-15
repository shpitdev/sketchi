import { describe, expect, it } from "vitest";

import {
  DiagramValidationError,
  flowchartFixture,
  parseIntermediateDiagram,
} from "./index";

describe("parseIntermediateDiagram", () => {
  it("accepts a valid diagram fixture", () => {
    expect(parseIntermediateDiagram(flowchartFixture)).toMatchObject({
      id: "onboarding-flow",
      nodes: expect.arrayContaining([
        expect.objectContaining({ id: "prompt" }),
      ]),
    });
  });

  it("rejects duplicate node ids", () => {
    expect(() =>
      parseIntermediateDiagram({
        ...flowchartFixture,
        nodes: [
          ...flowchartFixture.nodes,
          { id: "prompt", label: "Duplicate" },
        ],
      }),
    ).toThrow(DiagramValidationError);
  });

  it("rejects edges that reference missing nodes", () => {
    expect(() =>
      parseIntermediateDiagram({
        ...flowchartFixture,
        edges: [
          ...flowchartFixture.edges,
          {
            id: "missing-edge",
            source: "prompt",
            target: "missing",
            label: "bad",
          },
        ],
      }),
    ).toThrow('Edge "missing-edge" references missing target node "missing".');
  });
});
