import { describe, expect, test } from "vitest";
import type { IntermediateFormat } from "../lib/diagram-intermediate";
import { applyTemplateDefaults } from "../lib/template-autofill";
import { ArchitectureTemplate, FlowchartTemplate } from "../lib/templates";

describe("applyTemplateDefaults", () => {
  test("intermediate with empty graphOptions gets template defaults", () => {
    const intermediate: IntermediateFormat = {
      nodes: [{ id: "a", label: "A" }],
      edges: [],
    };

    const result = applyTemplateDefaults(intermediate, FlowchartTemplate);

    expect(result.graphOptions?.layout?.direction).toBe("TB");
    expect(result.graphOptions?.layout?.nodesep).toBe(80);
    expect(result.graphOptions?.style?.shapeFill).toBe("#a5d8ff");
    expect(result.graphOptions?.style?.shapeStroke).toBe("#1971c2");
  });

  test("intermediate with explicit direction keeps explicit value", () => {
    const intermediate: IntermediateFormat = {
      nodes: [{ id: "a", label: "A" }],
      edges: [],
      graphOptions: {
        layout: { direction: "LR" },
      },
    };

    const result = applyTemplateDefaults(intermediate, FlowchartTemplate);

    expect(result.graphOptions?.layout?.direction).toBe("LR");
    expect(result.graphOptions?.layout?.nodesep).toBe(80);
  });

  test("nodeDefaults.fill maps to graphOptions.style.shapeFill", () => {
    const intermediate: IntermediateFormat = {
      nodes: [{ id: "a", label: "A" }],
      edges: [],
    };

    const result = applyTemplateDefaults(intermediate, ArchitectureTemplate);

    expect(result.graphOptions?.style?.shapeFill).toBe("#d0bfff");
  });

  test("edgeDefaults.stroke maps to graphOptions.style.arrowStroke", () => {
    const intermediate: IntermediateFormat = {
      nodes: [{ id: "a", label: "A" }],
      edges: [],
    };

    const result = applyTemplateDefaults(intermediate, ArchitectureTemplate);

    expect(result.graphOptions?.style?.arrowStroke).toBe("#7950f2");
  });

  test("nodeDefaults.width/height map to node.metadata.width/height", () => {
    const intermediate: IntermediateFormat = {
      nodes: [{ id: "a", label: "A" }],
      edges: [],
    };

    const result = applyTemplateDefaults(intermediate, ArchitectureTemplate);

    expect(result.nodes[0].metadata?.width).toBe(200);
    expect(result.nodes[0].metadata?.height).toBe(100);
  });

  test("kindToShapeMap maps node.kind to node.metadata.shape", () => {
    const intermediate: IntermediateFormat = {
      nodes: [
        { id: "a", label: "A", kind: "decision" },
        { id: "b", label: "B", kind: "start" },
      ],
      edges: [],
    };

    const result = applyTemplateDefaults(intermediate, FlowchartTemplate);

    expect(result.nodes[0].metadata?.shape).toBe("diamond");
    expect(result.nodes[1].metadata?.shape).toBe("ellipse");
  });

  test("unknown diagramType falls back to flowchart template", () => {
    const intermediate: IntermediateFormat = {
      nodes: [{ id: "a", label: "A" }],
      edges: [],
      graphOptions: {
        diagramType: "flowchart",
      },
    };

    const result = applyTemplateDefaults(intermediate);

    expect(result.graphOptions?.style?.shapeFill).toBe("#a5d8ff");
  });

  test("explicit node metadata values are preserved", () => {
    const intermediate: IntermediateFormat = {
      nodes: [
        {
          id: "a",
          label: "A",
          kind: "decision",
          metadata: { shape: "rectangle", width: 300 },
        },
      ],
      edges: [],
    };

    const result = applyTemplateDefaults(intermediate, FlowchartTemplate);

    expect(result.nodes[0].metadata?.shape).toBe("rectangle");
    expect(result.nodes[0].metadata?.width).toBe(300);
    expect(result.nodes[0].metadata?.height).toBe(80);
  });
});
