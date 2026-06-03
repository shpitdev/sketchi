import { describe, expect, test } from "vitest";
import { generatedDiagramCatalog } from "./diagram-catalog";
import { DIAGRAM_TYPES } from "./diagram-types";
import { validateIntermediateDiagram } from "./intermediate";

describe("generated diagram catalog", () => {
  test("contains registered valid diagrams with Studio metadata", () => {
    const ids = new Set<string>();

    for (const item of generatedDiagramCatalog) {
      ids.add(item.id);

      expect(DIAGRAM_TYPES).toContain(item.diagram.graphOptions.diagramType);
      expect(item.description).not.toHaveLength(0);
      expect(item.label).not.toHaveLength(0);
      expect(item.prompt).not.toHaveLength(0);
      expect(validateIntermediateDiagram(item.diagram).ok).toBe(true);
    }

    expect(ids.size).toBe(generatedDiagramCatalog.length);
  });
});
