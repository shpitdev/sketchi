import { architectureFixture, flowchartFixture } from "@sketchi/diagram-core";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DiagramCatalog, type DiagramCatalogItem } from "./diagram-catalog";

const catalogItems: DiagramCatalogItem[] = [
  {
    description: "System boundaries",
    diagram: architectureFixture,
    id: "architecture",
    label: "Architecture",
    prompt: "Show system boundaries.",
  },
  {
    description: "User onboarding",
    diagram: flowchartFixture,
    id: "flowchart",
    label: "Flowchart",
    prompt: "Show onboarding.",
  },
];
const FLOWCHART_BUTTON_NAME = /Flowchart/;

describe("DiagramCatalog", () => {
  it("renders a virtualized selectable diagram list", () => {
    const onSelect = vi.fn();

    render(
      <DiagramCatalog
        items={catalogItems}
        onSelect={onSelect}
        selectedId="architecture"
      />
    );

    fireEvent.click(
      screen.getByRole("button", { name: FLOWCHART_BUTTON_NAME })
    );

    expect(onSelect).toHaveBeenCalledWith("flowchart");
  });
});
