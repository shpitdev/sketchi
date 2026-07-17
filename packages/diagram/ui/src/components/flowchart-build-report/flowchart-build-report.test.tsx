import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  acceptedFlowchartBuild,
  rejectedFlowchartBuild,
} from "./flowchart-build-report.fixtures";
import { FlowchartBuildReport } from "./flowchart-build-report";

describe("FlowchartBuildReport", () => {
  it("shows canonical acceptance and artifact persistence once", () => {
    render(
      <FlowchartBuildReport attempt={1} result={acceptedFlowchartBuild} />,
    );

    expect(screen.getByText("Canonical artifact accepted")).toBeTruthy();
    expect(
      screen.getByText(
        "Saved as one canonical artifact. Scene and drawing exports are ready.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("5 nodes")).toBeTruthy();
    expect(screen.getByText("5 edges")).toBeTruthy();
  });

  it("shows structured issue codes, refs, messages, and repair hints", () => {
    render(
      <FlowchartBuildReport attempt={2} result={rejectedFlowchartBuild} />,
    );

    expect(screen.getByText("Repair the flowchart")).toBeTruthy();
    expect(screen.getByText("Attempt 2 of 3")).toBeTruthy();
    expect(screen.getByText("underbranched_decision")).toBeTruthy();
    expect(screen.getByText("review")).toBeTruthy();
    expect(
      screen.getByText("Add another labeled branch from this decision."),
    ).toBeTruthy();
  });
});
