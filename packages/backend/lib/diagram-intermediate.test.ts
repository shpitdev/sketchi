import {
  DIAGRAM_TYPES,
  IntermediateDiagramSchema,
} from "@sketchi/diagram-core";
import { describe, expect, test } from "vitest";

import { IntermediateFormatSchema } from "./diagram-intermediate";

describe("backend intermediate schema boundary", () => {
  test("reuses the canonical diagram-core schema", () => {
    expect(IntermediateFormatSchema).toBe(IntermediateDiagramSchema);
  });

  test("accepts every generated diagram type value from diagram-core", () => {
    for (const diagramType of DIAGRAM_TYPES) {
      const parsed = IntermediateFormatSchema.parse({
        edges: [],
        graphOptions: { diagramType },
        nodes: [{ id: "root", label: "Root" }],
      });

      expect(parsed.graphOptions?.diagramType).toBe(diagramType);
    }
  });
});
