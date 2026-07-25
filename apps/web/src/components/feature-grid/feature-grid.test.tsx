import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FeatureGrid } from "./feature-grid";

describe("FeatureGrid", () => {
  it("renders the three product benefits", () => {
    render(<FeatureGrid />);

    expect(
      screen.getByRole("heading", { name: "Real objects, not screenshots" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "1,400+ logos, already drawn" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Yours to edit and export" }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Every shape, connector, and label stays editable after generation.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Find the tools in your stack without drawing their marks by hand.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Open the scene in Excalidraw, then export it when you are ready.",
      ),
    ).toBeTruthy();
  });
});
