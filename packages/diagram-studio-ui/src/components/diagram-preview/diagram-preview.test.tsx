import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../excalidraw-scene-canvas/index.js", () => ({
  ExcalidrawSceneCanvas: ({
    scene,
    title,
  }: {
    scene: { elements: unknown[] };
    title: string;
  }) => (
    <div aria-label={title} data-testid="excalidraw-scene-canvas">
      {scene.elements.length} Excalidraw elements
    </div>
  ),
}));

import { flowchartFixture } from "@sketchi/diagram-core";
import { renderIntermediateDiagram } from "@sketchi/diagram-renderer";

import { DiagramPreview } from "./diagram-preview";

describe("DiagramPreview", () => {
  it("renders the diagram through the shared Excalidraw canvas", () => {
    const scene = renderIntermediateDiagram(flowchartFixture);

    render(<DiagramPreview scene={scene} />);

    const canvas = screen.getByTestId("excalidraw-scene-canvas");
    expect(canvas.getAttribute("aria-label")).toBe(
      "Sketchi onboarding decision flow",
    );
    expect(canvas.textContent).toMatch(/Excalidraw elements/);
  });
});
