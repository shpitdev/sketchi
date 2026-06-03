import { architectureFixture } from "@sketchi/diagram-core";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DiagramSummaryPanel } from "./diagram-summary-panel";

describe("DiagramSummaryPanel", () => {
  it("renders diagram status, prompt, and metrics", () => {
    render(
      <DiagramSummaryPanel
        diagram={architectureFixture}
        prompt="Show the package-first architecture."
        status="rendered"
      />
    );

    expect(screen.getByRole("heading", { name: "Sketchi v2" })).toBeTruthy();
    expect(
      screen.getByText("Show the package-first architecture.")
    ).toBeTruthy();
    expect(screen.getByText("4 nodes")).toBeTruthy();
    expect(screen.getByText("3 edges")).toBeTruthy();
  });
});
