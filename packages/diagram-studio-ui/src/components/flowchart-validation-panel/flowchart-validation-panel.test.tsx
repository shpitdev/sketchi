import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FlowchartValidationPanel } from "./flowchart-validation-panel";

describe("FlowchartValidationPanel", () => {
  it("renders structural and real-scene validation status", () => {
    render(
      <FlowchartValidationPanel
        edgeCount={5}
        intermediateMessage="Validated flowchart IR"
        nodeCount={6}
        realSceneIssueCount={0}
        realSceneMessage="All arrows are bound"
      />
    );

    expect(screen.getByText("6 nodes")).toBeTruthy();
    expect(screen.getByText("5 edges")).toBeTruthy();
    expect(screen.getByText("Validated flowchart IR")).toBeTruthy();
    expect(screen.getByText("Real scene valid")).toBeTruthy();
    expect(screen.getByText("All arrows are bound")).toBeTruthy();
  });
});
