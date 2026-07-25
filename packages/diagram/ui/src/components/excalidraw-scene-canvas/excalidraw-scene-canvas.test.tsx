import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const excalidrawMock = vi.hoisted(() => ({
  props: vi.fn(),
  scrollToContent: vi.fn(),
}));

vi.mock("@excalidraw/excalidraw", async () => {
  const React = await import("react");

  return {
    Excalidraw: (props: {
      excalidrawAPI?: (api: {
        scrollToContent: typeof excalidrawMock.scrollToContent;
      }) => void;
      gridModeEnabled?: boolean;
      initialData?: { appState?: Record<string, unknown> };
    }) => {
      excalidrawMock.props(props);
      React.useEffect(() => {
        props.excalidrawAPI?.({
          scrollToContent: excalidrawMock.scrollToContent,
        });
      }, [props.excalidrawAPI]);

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
    excalidrawMock.props.mockReset();
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
    expect(
      screen
        .getByTestId("excalidraw-scene-canvas")
        .getAttribute("data-view-mode"),
    ).toBe("false");
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
        viewportZoomFactor: 1,
      });
    });
    expect(excalidrawMock.props).toHaveBeenLastCalledWith(
      expect.objectContaining({ gridModeEnabled: false }),
    );
  });

  it("uses the Sketchi card color when a scene has no background", async () => {
    render(
      <ExcalidrawSceneCanvas
        scene={{ appState: {}, elements: [] }}
        title="Empty Sketchi canvas"
      />,
    );

    expect(await screen.findByTestId("mock-excalidraw")).toBeTruthy();
    expect(excalidrawMock.props).toHaveBeenLastCalledWith(
      expect.objectContaining({
        initialData: expect.objectContaining({
          appState: expect.objectContaining({
            viewBackgroundColor: "#fffdf8",
          }),
        }),
      }),
    );
  });
});
