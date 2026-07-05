import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PipelineFlow } from "./pipeline-flow";

describe("PipelineFlow", () => {
  it("renders the default ordered pipeline stages", () => {
    render(<PipelineFlow />);

    const list = screen.getByRole("list", {
      name: "Diagram generation pipeline",
    });
    expect(list).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Typed IR" })).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Canvas artifact" }),
    ).toBeTruthy();
    expect(screen.getAllByText("diagram-core").length).toBeGreaterThan(0);
  });

  it("renders custom stages when provided", () => {
    render(<PipelineFlow stages={[{ name: "Solo", pkg: "demo-pkg" }]} />);

    expect(screen.getByRole("heading", { name: "Solo" })).toBeTruthy();
    expect(screen.getByText("demo-pkg")).toBeTruthy();
  });
});
