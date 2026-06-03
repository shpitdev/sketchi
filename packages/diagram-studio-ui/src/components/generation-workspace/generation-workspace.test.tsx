import { architectureFixture, flowchartFixture } from "@sketchi/diagram-core";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { DiagramCatalogItem } from "../diagram-catalog";
import { GenerationWorkspace } from "./generation-workspace";

const diagrams: DiagramCatalogItem[] = [
  {
    description: "System boundaries",
    diagram: architectureFixture,
    id: "architecture",
    label: "Architecture",
    prompt: "Show the package-first v2 architecture.",
  },
  {
    description: "User onboarding",
    diagram: flowchartFixture,
    id: "flowchart",
    label: "Flowchart",
    prompt: "Create a left-to-right onboarding flow.",
  },
];

describe("GenerationWorkspace", () => {
  it("renders the selected diagram workspace", () => {
    render(
      <GenerationWorkspace
        diagrams={diagrams}
        selectedDiagramId="architecture"
      />
    );

    expect(
      screen.getByText("Show the package-first v2 architecture.")
    ).toBeTruthy();
    expect(screen.getByText("TanStack app")).toBeTruthy();
  });

  it("moves diagram selection with hotkeys", () => {
    render(<GenerationWorkspace diagrams={diagrams} />);

    fireEvent.keyDown(document, { key: "ArrowRight" });

    expect(
      screen.getByText("Create a left-to-right onboarding flow.")
    ).toBeTruthy();
  });

  it("ignores hotkeys typed inside editable controls", () => {
    render(
      <>
        <input aria-label="Prompt" />
        <GenerationWorkspace diagrams={diagrams} />
      </>
    );

    fireEvent.keyDown(screen.getByLabelText("Prompt"), { key: "ArrowRight" });

    expect(
      screen.getByText("Show the package-first v2 architecture.")
    ).toBeTruthy();
  });
});
