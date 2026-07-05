import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const excalidrawMock = vi.hoisted(() => ({
  scrollToContent: vi.fn(),
}));

vi.mock("@excalidraw/excalidraw", async () => {
  const React = await import("react");

  return {
    Excalidraw: ({
      excalidrawAPI,
    }: {
      excalidrawAPI?: (api: {
        scrollToContent: typeof excalidrawMock.scrollToContent;
      }) => void;
    }) => {
      React.useEffect(() => {
        excalidrawAPI?.({ scrollToContent: excalidrawMock.scrollToContent });
      }, [excalidrawAPI]);

      return <div data-testid="mock-excalidraw">Mock Excalidraw</div>;
    },
  };
});

import { convertSceneToExcalidraw } from "@sketchi/diagram-excalidraw";
import { flowchartFixture } from "@sketchi/diagram-core";
import { renderIntermediateDiagram } from "@sketchi/diagram-renderer";

import { ExcalidrawSceneCanvas } from "./excalidraw-scene-canvas";

describe("ExcalidrawSceneCanvas", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    excalidrawMock.scrollToContent.mockReset();
  });

  it("renders a client-only Excalidraw shell", () => {
    const scene = convertSceneToExcalidraw(
      renderIntermediateDiagram(flowchartFixture),
    );

    render(
      <ExcalidrawSceneCanvas
        scene={scene}
        title="Sketchi onboarding decision flow"
      />,
    );

    expect(
      screen.getByTestId("excalidraw-scene-canvas").getAttribute("aria-label"),
    ).toBe("Sketchi onboarding decision flow");
    expect(screen.getByText("Loading canvas")).toBeTruthy();
  });

  it("fits scene content after Excalidraw loads", async () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const scene = convertSceneToExcalidraw(
      renderIntermediateDiagram(flowchartFixture),
    );

    render(
      <ExcalidrawSceneCanvas
        scene={scene}
        title="Sketchi onboarding decision flow"
      />,
    );

    expect(await screen.findByTestId("mock-excalidraw")).toBeTruthy();
    await waitFor(() => {
      expect(excalidrawMock.scrollToContent).toHaveBeenCalledWith(undefined, {
        animate: false,
        fitToViewport: true,
        viewportZoomFactor: 0.72,
      });
    });
  });
});
