import { describe, expect, it } from "vitest";

import { parseIntermediateDiagram } from "../intermediate";
import { architectureDiagramType, architectureFixture } from "./architecture";

describe("Architecture diagram type", () => {
  it("has a typed fixture that satisfies the intermediate diagram contract", () => {
    expect(architectureFixture.graphOptions?.diagramType).toBe(
      architectureDiagramType
    );
    expect(parseIntermediateDiagram(architectureFixture)).toEqual(
      architectureFixture
    );
  });
});
