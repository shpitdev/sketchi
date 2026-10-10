import {
  convertSceneToExcalidraw,
  type ExcalidrawScene,
} from "@sketchi/diagram-excalidraw";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEPLOY_PIPELINE_SCENE } from "../playground/deploy-pipeline-sample";

const canvas = vi.hoisted(
  (): { change?: (scene: ExcalidrawScene) => void } => ({}),
);
vi.mock("@sketchi/diagram-ui", () => ({
  ArtifactCanvas: ({
    onSceneChange,
  }: {
    onSceneChange: (scene: ExcalidrawScene) => void;
  }) => {
    canvas.change = onSceneChange;
    return <div>Editable canvas</div>;
  },
}));
import { EditableArtifactStage } from "./editable-artifact-stage";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
describe("editable artifact stage", () => {
  it("has a disabled download without a placeholder link while loading", () => {
    render(
      <EditableArtifactStage
        downloadName="drawing"
        headerLinks={null}
        loadingMessage="Loading diagram..."
        state={{ status: "loading" }}
      />,
    );
    expect(screen.getByRole("button", { name: "Drawing file" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(document.querySelector('a[href="#"]')).toBeNull();
  });
  it("restores the original download when an edit is reverted", () => {
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:unexpected");
    render(
      <EditableArtifactStage
        artifactId="artifact"
        downloadName="drawing"
        headerLinks={null}
        loadingMessage="Loading..."
        state={{ status: "ready", scene: DEPLOY_PIPELINE_SCENE }}
      />,
    );
    const base = convertSceneToExcalidraw(DEPLOY_PIPELINE_SCENE);
    act(() =>
      canvas.change?.({
        ...base,
        elements: base.elements.map((element, index) =>
          index === 0 ? { ...element, version: 2, x: 100 } : element,
        ),
      }),
    );
    expect(screen.getByRole("link", { name: "Download changes" })).toBeTruthy();
    act(() =>
      canvas.change?.({
        ...base,
        appState: {
          ...base.appState,
          scrollX: 100,
          selectedElementIds: { node: true },
        },
      }),
    );
    expect(screen.queryByRole("link", { name: "Download changes" })).toBeNull();
    const original = screen.getByRole("link", { name: "Drawing file" });
    expect(original.getAttribute("href")).toBe(
      "/api/v1/artifacts/artifact?format=excalidraw&raw=true",
    );
    expect(original.classList.contains("studio__icon-action--primary")).toBe(
      false,
    );
    original.addEventListener("click", (event) => event.preventDefault());
    fireEvent.click(original);
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("allocates only on download and exports the latest edit, then releases the URL", async () => {
    vi.useFakeTimers();
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:edited");
    const revokeObjectURL = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => undefined);
    render(
      <EditableArtifactStage
        artifactId="artifact"
        downloadName="drawing"
        headerLinks={null}
        loadingMessage="Loading..."
        state={{ status: "ready", scene: DEPLOY_PIPELINE_SCENE }}
      />,
    );
    const base = convertSceneToExcalidraw(DEPLOY_PIPELINE_SCENE);
    act(() =>
      canvas.change?.({
        ...base,
        appState: {
          ...base.appState,
          scrollX: 100,
          selectedElementIds: { node: true },
        },
      }),
    );
    expect(screen.getByRole("link", { name: "Drawing file" })).toBeTruthy();
    const edited = {
      ...base,
      elements: base.elements.map((element, index) =>
        index === 0 ? { ...element, version: 2, x: 100 } : element,
      ),
    };
    act(() => canvas.change?.(edited));
    act(() =>
      canvas.change?.({
        ...edited,
        elements: edited.elements.map((element, index) =>
          index === 0 ? { ...element, version: 3, x: 200 } : element,
        ),
      }),
    );
    expect(createObjectURL).not.toHaveBeenCalled();
    const link = screen.getByRole("link", { name: "Download changes" });
    fireEvent.click(link);
    expect(link.getAttribute("href")).toBe("blob:edited");
    expect(createObjectURL).toHaveBeenCalledOnce();
    const blob = createObjectURL.mock.calls[0]?.[0];
    expect(blob).toBeInstanceOf(Blob);
    if (!(blob instanceof Blob)) throw new Error("Expected download blob");
    expect(JSON.parse(await blob.text()).elements[0].x).toBe(200);
    act(() => {
      vi.runAllTimers();
    });
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:edited");
    expect(link.getAttribute("href")).toContain("/api/v1/artifacts/artifact");
  });
});
