import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../excalidraw-scene-canvas/index.js", () => ({
  ExcalidrawSceneCanvas: ({
    onChange,
    title,
    viewModeEnabled,
    zenModeEnabled,
  }: {
    onChange?: (elements: unknown[], appState: Record<string, unknown>) => void;
    title: string;
    viewModeEnabled: boolean;
    zenModeEnabled: boolean;
  }) => (
    <button
      data-testid="artifact-canvas-shell"
      data-view-mode={String(viewModeEnabled)}
      data-zen-mode={String(zenModeEnabled)}
      onClick={() =>
        onChange?.([{ id: "edited-node", type: "rectangle" }], {
          scrollX: 12,
          scrollY: 24,
          selectedElementIds: { "edited-node": true },
          viewBackgroundColor: "#fffdf8",
          zoom: { value: 0.8 },
        })
      }
      type="button"
    >
      {title}
    </button>
  ),
}));

import { flowchartFixture } from "@sketchi/diagram-core";
import { renderIntermediateDiagram } from "@sketchi/diagram-renderer";

import { ArtifactCanvas } from "./artifact-canvas";

describe("ArtifactCanvas", () => {
  it("renders generated artifacts in review mode by default", () => {
    const scene = renderIntermediateDiagram(flowchartFixture);

    render(<ArtifactCanvas scene={scene} />);

    const shell = screen.getByTestId("artifact-canvas-shell");
    expect(shell.getAttribute("data-view-mode")).toBe("true");
    expect(shell.getAttribute("data-zen-mode")).toBe("true");
    expect(shell.textContent).toBe("Sketchi onboarding decision flow");
  });

  it("enables editing and emits edited scene data in edit mode", () => {
    const scene = renderIntermediateDiagram(flowchartFixture);
    const onSceneChange = vi.fn();

    render(
      <ArtifactCanvas
        mode="edit"
        onSceneChange={onSceneChange}
        scene={scene}
        title="Editable artifact"
      />,
    );

    const shell = screen.getByTestId("artifact-canvas-shell");
    expect(shell.getAttribute("data-view-mode")).toBe("false");
    expect(shell.getAttribute("data-zen-mode")).toBe("false");
    shell.click();

    expect(onSceneChange).toHaveBeenCalledWith({
      appState: {
        scrollX: 12,
        scrollY: 24,
        selectedElementIds: { "edited-node": true },
        viewBackgroundColor: "#fffdf8",
        zoom: { value: 0.8 },
      },
      elements: [{ id: "edited-node", type: "rectangle" }],
    });
  });
});
