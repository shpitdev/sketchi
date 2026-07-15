import { flowchartFixture } from "@sketchi/diagram-core";
import { convertSceneToExcalidraw } from "@sketchi/diagram-excalidraw";
import { renderIntermediateDiagram } from "@sketchi/diagram-renderer";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DiagramInspector } from "./diagram-inspector";

const scene = convertSceneToExcalidraw(
  renderIntermediateDiagram(flowchartFixture),
);

describe("DiagramInspector", () => {
  it("shows the overview drawn from the diagram", () => {
    render(<DiagramInspector diagram={flowchartFixture} scene={scene} />);

    expect(screen.getByRole("tab", { name: "Typed IR" })).toBeTruthy();
    expect(screen.getByText("Edge routing")).toBeTruthy();
    expect(screen.getByText(flowchartFixture.layout.direction)).toBeTruthy();
  });

  it("reports the converted scene on the scene tab", () => {
    render(<DiagramInspector diagram={flowchartFixture} scene={scene} />);

    fireEvent.click(screen.getByRole("tab", { name: "Scene" }));
    expect(
      screen.getByText(`${scene.elements.length} Excalidraw elements`),
    ).toBeTruthy();
  });
});
