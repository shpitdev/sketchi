import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../artifact-canvas/index.js", () => ({
  ArtifactCanvas: ({
    mode,
    scene,
  }: {
    mode: string;
    scene: { title: string };
  }) => (
    <div data-mode={mode} data-testid="artifact-canvas">
      {scene.title}
    </div>
  ),
}));

import { flowchartFixture } from "@sketchi/diagram-core";
import { renderIntermediateDiagram } from "@sketchi/diagram-renderer";

import { DiagramPreview } from "./diagram-preview";

describe("DiagramPreview", () => {
  it("renders the diagram through the shared artifact canvas", () => {
    const scene = renderIntermediateDiagram(flowchartFixture);

    render(<DiagramPreview scene={scene} />);

    const canvas = screen.getByTestId("artifact-canvas");
    expect(canvas.getAttribute("data-mode")).toBe("view");
    expect(canvas.textContent).toBe("Sketchi onboarding decision flow");
  });
});
