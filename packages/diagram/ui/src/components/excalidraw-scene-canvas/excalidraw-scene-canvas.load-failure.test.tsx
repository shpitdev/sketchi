import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@excalidraw/excalidraw", () => {
  throw new Error("chunk failed to load");
});

import { ExcalidrawSceneCanvas } from "./excalidraw-scene-canvas";

describe("ExcalidrawSceneCanvas load failure", () => {
  it("reports an unavailable canvas instead of crashing the page", async () => {
    render(
      <ExcalidrawSceneCanvas
        scene={{ appState: {}, elements: [] }}
        title="Unavailable canvas"
      />,
    );

    expect(screen.getByText("Loading canvas")).toBeTruthy();
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Canvas unavailable",
    );
    expect(screen.getByLabelText("Unavailable canvas")).toBeTruthy();
  });
});
