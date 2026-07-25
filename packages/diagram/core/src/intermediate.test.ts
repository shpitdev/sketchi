import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  DiagramValidationError,
  SKETCHI_DIAGRAM_PALETTE,
  SKETCHI_DIAGRAM_STYLE,
  flowchartFixture,
  parseIntermediateDiagram,
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
