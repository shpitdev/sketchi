import { flowchartFixture } from "@sketchi/diagram-core";
import { flowchartScenarios, getScenario } from "@sketchi/diagram-scenarios";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../excalidraw-scene-canvas/index.js", () => ({
  ExcalidrawSceneCanvas: ({
    onChange,
  }: {
    onChange?: (
      elements: readonly Record<string, unknown>[],
      appState: Record<string, unknown>,
    ) => void;
  }) => (
    <button
      type="button"
      onClick={() =>
        onChange?.(
          [
            {
              height: 72,
              id: "node:draft",
              type: "rectangle",
              width: 184,
              x: 123,
              y: 456,
            },
          ],
          {
            scrollX: 1,
            scrollY: 2,
            selectedElementIds: { "node:draft": true },
            viewBackgroundColor: "#ffffff",
            zoom: { value: 0.62 },
          },
        )
      }
    >
      Mock visual edit
    </button>
  ),
}));

vi.mock("../json-code-editor/index.js", () => ({
  JsonCodeEditor: ({
    label,
    onChange,
    readOnly,
    value,
  }: {
    label: string;
    onChange?: (value: string) => void;
    readOnly?: boolean;
    value: string;
  }) => (
    <label>
      {label}
      <textarea
        aria-label={label}
        readOnly={readOnly}
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
      />
    </label>
  ),
}));

import {
  ScenarioPlayground,
  type ScenarioGenerationRequest,
  type ScenarioGenerationResult,
} from "./scenario-playground";

describe("ScenarioPlayground", () => {
  it("renders maintained scenarios and their checks", () => {
    render(<ScenarioPlayground />);

    expect(
      screen.getByRole("heading", { name: "Sketchi scenario harness" }),
    ).toBeTruthy();
    expect(screen.getByText("Eval Harness")).toBeTruthy();
    expect(screen.getByText("Expected at least 5 nodes.")).toBeTruthy();
    expect(screen.getByLabelText("Fixture IR")).toBeTruthy();
  });

  it("reports invalid generated candidate output", async () => {
    const onGenerateScenario = vi.fn(async () => ({
      candidates: [
        {
          diagnostics: ["Model output did not contain a JSON object."],
          diagramValid: false,
          model: "google/gemini-3.1-flash-lite",
          provider: "cloudflare-google-ai-studio" as const,
          text: "not json",
        },
      ],
      scenarioId: "sketchi-onboarding-decision-flow",
    }));

    render(<ScenarioPlayground onGenerateScenario={onGenerateScenario} />);
    fireEvent.click(screen.getByRole("tab", { name: "Live generation" }));
    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    await waitFor(() => expect(onGenerateScenario).toHaveBeenCalledTimes(1));
    expect(
      screen.getAllByText("Model output did not contain a JSON object.").length,
    ).toBeGreaterThan(0);
  });

  it("shows a running status while API generation is pending", async () => {
    const scenario = getScenario("sketchi-onboarding-decision-flow");
    let resolveGeneration:
      | ((result: ScenarioGenerationResult) => void)
      | undefined;
    const onGenerateScenario = vi.fn(
      () =>
        new Promise<ScenarioGenerationResult>((resolve) => {
          resolveGeneration = resolve;
        }),
    );

    render(<ScenarioPlayground onGenerateScenario={onGenerateScenario} />);
    fireEvent.click(screen.getByRole("tab", { name: "Live generation" }));
    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    expect(screen.getAllByText("Running").length).toBeGreaterThan(0);
    expect(screen.queryByText("Needs attention")).toBeNull();

    resolveGeneration?.({
      candidates: [
        {
          diagnostics: [],
          diagramValid: true,
          model: "google/gemini-3.1-flash-lite",
          provider: "cloudflare-google-ai-studio",
          text: JSON.stringify(scenario.expectedDiagram, null, 2),
        },
      ],
      scenarioId: scenario.id,
    });

    await waitFor(() => expect(screen.getByText("Passing")).toBeTruthy());
  });

  it("shows system and user prompt parts separately", () => {
    render(<ScenarioPlayground />);

    fireEvent.click(screen.getByRole("tab", { name: "Live generation" }));
    fireEvent.click(screen.getByRole("tab", { name: "Messages" }));

    expect(
      screen.getAllByRole("heading", { name: "System instructions" }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("heading", { name: "User request" }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByLabelText("System instructions prompt")[0]?.textContent,
    ).toContain("Flowchart IR rules:");
    expect(
      screen.getAllByLabelText("User request prompt")[0]?.textContent,
    ).toContain("Scenario:");
  });

  it("focuses a live scenario from the suite without selecting it for the batch", () => {
    render(<ScenarioPlayground />);

    fireEvent.click(screen.getByRole("tab", { name: "Live generation" }));
    fireEvent.click(
      screen.getByRole("button", { name: /Pharma batch disposition/ }),
    );

    expect(
      screen.getAllByRole("heading", {
        name: "Pharma batch disposition",
      }).length,
    ).toBeGreaterThan(0);
    expect(
      (
        screen.getByLabelText(
          "Include Pharma batch disposition",
        ) as HTMLInputElement
      ).checked,
    ).toBe(false);
  });

  it("mirrors Excalidraw visual edits into the JSON inspector", async () => {
    render(<ScenarioPlayground />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Mock visual edit" }),
    );
    fireEvent.click(screen.getByRole("tab", { name: "Excalidraw JSON" }));

    const excalidrawJson = screen.getByLabelText(
      "Excalidraw JSON",
    ) as HTMLTextAreaElement;

    expect(excalidrawJson.value).toContain('"node:draft": true');
    expect(excalidrawJson.value).toContain('"x": 123');
  });

  it("updates the open Excalidraw JSON inspector after visual edits", async () => {
    render(<ScenarioPlayground />);

    fireEvent.click(screen.getByRole("tab", { name: "Excalidraw JSON" }));

    const excalidrawJson = screen.getByLabelText(
      "Excalidraw JSON",
    ) as HTMLTextAreaElement;

    expect(excalidrawJson.value).not.toContain('"node:draft": true');

    fireEvent.click(
      await screen.findByRole("button", { name: "Mock visual edit" }),
    );

    expect(excalidrawJson.value).toContain('"node:draft": true');
    expect(excalidrawJson.value).toContain('"x": 123');
  });

  it("loads a generated candidate into the deterministic IR editor", async () => {
    const generatedDiagram = {
      ...flowchartFixture,
      title: "Generated onboarding flow",
    };
    const onGenerateScenario = vi.fn(async () => ({
      candidates: [
        {
          diagnostics: [],
          diagramValid: true,
          model: "google/gemini-3.1-flash-lite",
          provider: "cloudflare-google-ai-studio" as const,
          text: JSON.stringify(generatedDiagram, null, 2),
        },
      ],
      scenarioId: "sketchi-onboarding-decision-flow",
    }));

    render(<ScenarioPlayground onGenerateScenario={onGenerateScenario} />);
    fireEvent.click(screen.getByRole("tab", { name: "Live generation" }));
    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    await waitFor(() => expect(onGenerateScenario).toHaveBeenCalledTimes(1));
    expect(onGenerateScenario).toHaveBeenCalledWith({
      cacheMode: "default",
      providers: ["cloudflare-google-ai-studio"],
      scenarioId: "sketchi-onboarding-decision-flow",
    });
    expect(
      (screen.getByLabelText("Candidate IR") as HTMLTextAreaElement).value,
    ).toContain("Generated onboarding flow");
    expect(
      screen.getByLabelText("Sketchi onboarding decision flow result")
        .textContent,
    ).toContain("Passed deterministic checks");
  });

  it("runs the full prompt suite against generated candidates", async () => {
    const onGenerateScenario = vi.fn(
      async ({ scenarioId }: ScenarioGenerationRequest) => {
        const scenario = getScenario(scenarioId);

        return {
          candidates: [
            {
              diagnostics: [],
              diagramValid: true,
              durationMs: 25,
              model: "google/gemini-3.1-flash-lite",
              provider: "cloudflare-google-ai-studio" as const,
              text: JSON.stringify(scenario.expectedDiagram, null, 2),
              usage: { totalTokens: 300 },
            },
          ],
          scenarioId,
        };
      },
    );

    render(<ScenarioPlayground onGenerateScenario={onGenerateScenario} />);
    fireEvent.click(screen.getByRole("tab", { name: "Live generation" }));
    fireEvent.click(screen.getByText("Batch controls"));
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    fireEvent.click(screen.getByRole("button", { name: "Run selected" }));

    await waitFor(() =>
      expect(onGenerateScenario).toHaveBeenCalledTimes(
        flowchartScenarios.length,
      ),
    );
    expect(
      screen.getByText(
        `${flowchartScenarios.length} / ${flowchartScenarios.length} passed`,
      ),
    ).toBeTruthy();
  });

  it("uses the fresh cache mode for selected LLM suite runs", async () => {
    const onGenerateScenario = vi.fn(
      async ({ scenarioId }: ScenarioGenerationRequest) => {
        const scenario = getScenario(scenarioId);

        return {
          candidates: [
            {
              cacheMode: "fresh" as const,
              diagnostics: [],
              diagramValid: true,
              durationMs: 25,
              model: "google/gemini-3.1-flash-lite",
              provider: "cloudflare-google-ai-studio" as const,
              text: JSON.stringify(scenario.expectedDiagram, null, 2),
            },
          ],
          scenarioId,
        };
      },
    );

    render(<ScenarioPlayground onGenerateScenario={onGenerateScenario} />);
    fireEvent.click(screen.getByRole("tab", { name: "Live generation" }));
    fireEvent.click(screen.getByText("Run settings"));
    fireEvent.click(screen.getByLabelText("Fresh"));
    fireEvent.click(screen.getByRole("button", { name: "Run selected" }));

    await waitFor(() => expect(onGenerateScenario).toHaveBeenCalledTimes(1));
    expect(onGenerateScenario).toHaveBeenCalledWith(
      expect.objectContaining({ cacheMode: "fresh" }),
    );
    expect(screen.getByText("Fresh run")).toBeTruthy();
  });
});
