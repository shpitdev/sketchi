import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FeatureGrid } from "./feature-grid";

describe("FeatureGrid", () => {
  it("renders the three product benefits", () => {
    render(<FeatureGrid />);

    expect(
      screen.getByRole("heading", { name: "Built on Excalidraw." }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Individual shapes and connectors" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "1,400+ logos, already drawn" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Edit and export your diagrams" }),
    ).toBeTruthy();
  });

  /**
   * The titles say the whole thing. A supporting sentence per card was padding
   * dressed as polish, so the band carries its weight through layout instead.
   */
  it("adds no restating sentence under a title", () => {
    const { container } = render(<FeatureGrid />);

    expect(container.querySelector(".feature-card p")).toBeNull();
  });
});
