import { describe, expect, test } from "vitest";
import {
  DIAGRAM_TYPES,
  flowchartFixture,
  IntermediateDiagramSchema,
  IntermediateFormatSchema,
  parseIntermediateDiagram,
  validateIntermediateDiagram,
} from "./index";

describe("intermediate diagram contract", () => {
  test("accepts the canonical onboarding fixture", () => {
    const parsed = parseIntermediateDiagram(flowchartFixture);

    expect(parsed.nodes).toHaveLength(4);
    expect(validateIntermediateDiagram(parsed)).toEqual({
      issues: [],
      ok: true,
    });
  });

  test("keeps IntermediateFormat aliases on the canonical schema", () => {
    expect(IntermediateFormatSchema).toBe(IntermediateDiagramSchema);
  });

  test("accepts the full generated diagram type registry", () => {
    for (const diagramType of DIAGRAM_TYPES) {
      const parsed = IntermediateFormatSchema.parse({
        edges: [],
        graphOptions: { diagramType },
        nodes: [{ id: "root", label: "Root" }],
      });

      expect(parsed.graphOptions?.diagramType).toBe(diagramType);
    }
  });

  test("rejects duplicate node ids", () => {
    const result = validateIntermediateDiagram({
      edges: [],
      nodes: [
        { id: "same", label: "First" },
        { id: "same", label: "Second" },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe("duplicate-node-id");
  });

  test("rejects missing edge references", () => {
    expect(() =>
      parseIntermediateDiagram({
        edges: [{ fromId: "known", toId: "missing" }],
        nodes: [{ id: "known", label: "Known" }],
      })
    ).toThrow("missing toId");
  });
});
