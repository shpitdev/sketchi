import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@sketchi/diagram-studio-ui", () => ({
  ExcalidrawSceneCanvas: ({ title }: { title: string }) => (
    <section aria-label={title} data-testid="mock-excalidraw-canvas" />
  ),
}));

import {
  flowchartFixture,
  mindmapFixture,
  pharmaBatchDispositionFlowchart,
} from "@sketchi/diagram-core";

import { ExcalidrawWorkspace } from "./excalidraw-workspace";

describe("ExcalidrawWorkspace", () => {
  it("renders the active scene and switches diagrams", () => {
    render(
      <ExcalidrawWorkspace
        diagrams={[
          pharmaBatchDispositionFlowchart,
          flowchartFixture,
          mindmapFixture,
        ]}
      />,
    );

    expect(
      screen.getByLabelText("Pharma batch disposition flow canvas"),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Public mindmap generation/ }),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: /Sketchi onboarding decision flow/ }),
    );
    expect(
      screen.getByLabelText("Sketchi onboarding decision flow canvas"),
    ).toBeTruthy();
  });

  it("copies the active IR and exposes a scene download", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(<ExcalidrawWorkspace diagrams={[flowchartFixture]} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy IR" }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        expect.stringContaining('"id": "onboarding-flow"'),
      );
    });
    expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();

    const download = screen.getByRole("link", { name: "Download scene" });
    expect(download.getAttribute("download")).toBe(
      "onboarding-flow.excalidraw.json",
    );
    expect(download.getAttribute("href")).toContain("data:application/json");
  });

  it("renders an empty state without diagrams", () => {
    render(<ExcalidrawWorkspace diagrams={[]} />);

    expect(screen.getByText("No diagram selected")).toBeTruthy();
  });
});
