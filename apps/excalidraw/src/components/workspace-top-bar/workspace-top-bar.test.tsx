import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WorkspaceTopBar } from "./workspace-top-bar";

describe("WorkspaceTopBar", () => {
  it("renders the active diagram, type, and no-auth status", () => {
    render(
      <WorkspaceTopBar
        diagramType="flowchart"
        status="ready"
        title="Pharma batch disposition flow"
      />,
    );

    expect(screen.getByText("Sketchi workspace")).toBeTruthy();
    expect(screen.getByText("Pharma batch disposition flow")).toBeTruthy();
    expect(screen.getByText("flowchart")).toBeTruthy();
    expect(screen.getByText("Ready")).toBeTruthy();
    expect(screen.getByText(/No sign-in/)).toBeTruthy();
  });

  it("reflects the empty status", () => {
    render(<WorkspaceTopBar status="empty" title="No diagram" />);

    expect(screen.getByText("No diagram")).toBeTruthy();
  });
});
