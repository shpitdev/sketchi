import { flowchartFixture, parseFlowchartDiagram } from "@sketchi/diagram-core";
import {
  renderIntermediateDiagram,
  type RenderedDiagramScene,
} from "@sketchi/diagram-renderer";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Like the real editor, this shell initializes only on mount. Do not mock the
// shared canvas adapter: its actual React key must replace the editor.
vi.mock("@excalidraw/excalidraw", async () => {
  const { useState } = await import("react");
  return {
    Excalidraw: ({
      initialData,
    }: {
      initialData?: { elements?: readonly unknown[] };
    }) => {
      const [initialScene] = useState(() => initialData);
      return (
        <div
          data-testid="revision-editor"
          data-scene={JSON.stringify(initialScene)}
        />
      );
    },
  };
});
vi.mock("../json-code-editor/index.js", () => ({
  JsonCodeEditor: ({ label, value }: { label: string; value: string }) => (
    <textarea aria-label={label} readOnly value={value} />
  ),
}));

import { ArtifactCanvas } from "./artifact-canvas";
import { DiagramPreview } from "../diagram-preview/diagram-preview";
import { ScenarioPlayground } from "../scenario-playground/scenario-playground";

const firstScene = renderIntermediateDiagram(flowchartFixture);
const followUpDiagram = parseFlowchartDiagram({
  ...flowchartFixture,
  nodes: [
    ...flowchartFixture.nodes,
    { id: "proof", label: "Verify follow-up", kind: "process" },
  ],
  edges: [
    ...flowchartFixture.edges.filter((edge) => edge.id !== "draft-review"),
    { id: "draft-proof", source: "draft", target: "proof" },
    { id: "proof-review", source: "proof", target: "review" },
  ],
});
const nextScene = renderIntermediateDiagram(followUpDiagram);

describe("source scene revisions", () => {
  it.each([
    [
      "artifact canvas",
      (scene: RenderedDiagramScene) => <ArtifactCanvas scene={scene} />,
    ],
    [
      "diagram preview",
      (scene: RenderedDiagramScene) => <DiagramPreview scene={scene} />,
    ],
  ])(
    "replaces %s when a follow-up changes content but not diagram ID",
    async (_name, preview) => {
      expect(nextScene.diagramId).toBe(firstScene.diagramId);
      const { rerender } = render(preview(firstScene));
      const original = await screen.findByTestId("revision-editor");
      const initialScene = original.getAttribute("data-scene");
      rerender(preview(nextScene));
      const replaced = screen.getByTestId("revision-editor");
      expect(replaced).not.toBe(original);
      expect(replaced.getAttribute("data-scene")).not.toBe(initialScene);
      expect(replaced.getAttribute("data-scene")).toContain("Verify follow-up");
      rerender(preview({ ...nextScene }));
      expect(screen.getByTestId("revision-editor")).toBe(replaced);
    },
  );

  it("passes an explicit artifact revision through the studio preview", async () => {
    const { rerender } = render(
      <DiagramPreview revision="artifact:first" scene={firstScene} />,
    );
    const original = await screen.findByTestId("revision-editor");
    rerender(
      <DiagramPreview revision="artifact:follow-up" scene={nextScene} />,
    );
    expect(screen.getByTestId("revision-editor")).not.toBe(original);
    expect(
      screen.getByTestId("revision-editor").getAttribute("data-scene"),
    ).toContain("Verify follow-up");
  });

  it("replaces the editor in both directions when switching fixture and live modes", async () => {
    render(
      <ScenarioPlayground
        onGenerateScenario={async ({ scenarioId }) => ({
          scenarioId,
          candidates: [
            {
              diagnostics: [],
              diagramValid: true,
              model: "fixture",
              provider: "cloudflare-google-ai-studio",
              text: JSON.stringify(followUpDiagram),
            },
          ],
        })}
      />,
    );
    await screen.findByTestId("revision-editor");
    fireEvent.click(screen.getByRole("tab", { name: "Live generation" }));
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    const live = await screen.findByTestId("revision-editor");
    expect(live.getAttribute("data-scene")).toContain("Verify follow-up");
    fireEvent.click(screen.getByRole("tab", { name: "Fixture conversion" }));
    const fixture = screen.getByTestId("revision-editor");
    expect(fixture).not.toBe(live);
    expect(fixture.getAttribute("data-scene")).not.toContain(
      "Verify follow-up",
    );
    fireEvent.click(screen.getByRole("tab", { name: "Live generation" }));
    const restoredLive = screen.getByTestId("revision-editor");
    expect(restoredLive).not.toBe(fixture);
    expect(restoredLive.getAttribute("data-scene")).toContain(
      "Verify follow-up",
    );
  });
});
