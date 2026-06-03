import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DiagramStatusStrip } from "./diagram-status-strip";

describe("DiagramStatusStrip", () => {
  it("renders the render status and diagram metrics", () => {
    render(
      <DiagramStatusStrip edgeCount={3} nodeCount={4} status="rendered" />
    );

    expect(screen.getByRole("group", { name: "Diagram status" })).toBeTruthy();
    expect(screen.getByText("rendered").getAttribute("data-status")).toBe(
      "rendered"
    );
    expect(screen.getByText("4 nodes")).toBeTruthy();
    expect(screen.getByText("3 edges")).toBeTruthy();
  });
});
