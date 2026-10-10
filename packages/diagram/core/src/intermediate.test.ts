import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  DiagramValidationError,
  DiagramNodeSchema,
  FlowchartDiagramSchema,
  IntermediateDiagramSchema,
  MindmapDiagramSchema,
  SKETCHI_DIAGRAM_PALETTE,
  SKETCHI_DIAGRAM_STYLE,
  flowchartFixture,
  mindmapFixture,
  parseFlowchartDiagram,
  parseIntermediateDiagram,
  parseMindmapDiagram,
} from "./index";

const themeCss = readFileSync(
  new URL("../../ui/src/theme.css", import.meta.url),
  "utf8",
);

function themeToken(name: string): string {
  const value = new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "iu").exec(
    themeCss,
  )?.[1];
  if (!value) {
    throw new Error(
      `Missing canonical --${name} token in diagram-ui/theme.css`,
    );
  }
  return value.toLowerCase();
}

describe("parseIntermediateDiagram", () => {
  it("does not attach parser facades to diagram schemas or subclasses", () => {
    for (const schema of [
      DiagramNodeSchema,
      IntermediateDiagramSchema,
      FlowchartDiagramSchema,
      MindmapDiagramSchema,
    ]) {
      expect("parse" in schema).toBe(false);
      expect("safeParse" in schema).toBe(false);
    }
  });

  it("keeps the runtime palette synchronized with diagram-ui/theme.css", () => {
    expect(SKETCHI_DIAGRAM_PALETTE).toEqual({
      paper: themeToken("paper"),
      card: themeToken("card"),
      ink: themeToken("ink"),
      accent: themeToken("accent"),
    });
  });

  it("accepts a valid diagram fixture", () => {
    expect(parseIntermediateDiagram(flowchartFixture)).toMatchObject({
      id: "onboarding-flow",
      nodes: expect.arrayContaining([
        expect.objectContaining({ id: "prompt" }),
      ]),
    });
  });

  it("applies the Sketchi diagram style when generation omits styling", () => {
    expect(
      parseIntermediateDiagram({
        id: "brand-defaults",
        title: "Brand defaults",
        nodes: [{ id: "only", label: "Only node" }],
      }).style,
    ).toEqual(SKETCHI_DIAGRAM_STYLE);
  });

  it("carries an optional icon reference on every diagram node family", () => {
    const diagram = parseIntermediateDiagram({
      id: "logos",
      title: "Logos",
      nodes: [
        { id: "build", label: "Docker build", icon: { slug: "docker" } },
        { id: "plain", label: "Plain step" },
      ],
    });
    expect(diagram.nodes[0]?.icon).toEqual({ slug: "docker" });
    expect(diagram.nodes[1]?.icon).toBeUndefined();
    expect(
      parseFlowchartDiagram({
        ...flowchartFixture,
        nodes: flowchartFixture.nodes.map((node, index) =>
          index === 0 ? { ...node, icon: { slug: "github" } } : node,
        ),
      }).nodes[0]?.icon,
    ).toEqual({ slug: "github" });
    expect(
      parseMindmapDiagram({
        ...mindmapFixture,
        nodes: mindmapFixture.nodes.map((node, index) =>
          index === 0 ? { ...node, icon: { slug: "cloudflare" } } : node,
        ),
      }).nodes[0]?.icon,
    ).toEqual({ slug: "cloudflare" });
  });

  it("rejects icon slugs that are not catalog-shaped", () => {
    for (const slug of [
      "Docker",
      "docker logo",
      "",
      "-docker",
      "a".repeat(65),
    ]) {
      expect(() =>
        parseIntermediateDiagram({
          id: "logos",
          title: "Logos",
          nodes: [{ id: "build", label: "Build", icon: { slug } }],
        }),
      ).toThrow('at ["nodes"][0]["icon"]["slug"]');
    }
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
