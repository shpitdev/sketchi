import type {
  DiagramGenerationCacheMode,
  DiagramGenerationCandidateSummary,
} from "@sketchi/diagram-generation";
import type { ExcalidrawScene } from "@sketchi/diagram-excalidraw";
import type { DiagramScenario } from "@sketchi/diagram-scenarios";
import { Store } from "@tanstack/react-store";
import type { ScenarioSuitePanelResult } from "../scenario-suite-panel/index.js";
import type { ScenarioGenerationResult } from "./scenario-playground.js";

export type InspectorPanel = "ir" | "prompt" | "excalidraw";
export type PlaygroundMode = "deterministic" | "llm";

export interface PlaygroundState {
  cacheMode: DiagramGenerationCacheMode;
  candidateText: string;
  canvasRevision: number;
  editedExcalidrawScene: ExcalidrawScene | undefined;
  editedExcalidrawSceneSignature: string | undefined;
  generationCandidates: readonly DiagramGenerationCandidateSummary[];
  generationError: string | undefined;
  generationRunToken: number;
  generationStatus: "idle" | "running" | "complete" | "error";
  inspectorPanel: InspectorPanel;
  mode: PlaygroundMode;
  scenarioId: string;
  selectedSuiteScenarioIds: readonly string[];
  suiteError: string | undefined;
  suiteResults: readonly ScenarioSuitePanelResult[];
  suiteStatus: "idle" | "running" | "complete" | "error";
}

function createInitialState(
  scenarios: readonly DiagramScenario[],
  initialScenarioId?: string,
): PlaygroundState {
  const selectedScenario =
    scenarios.find((scenario) => scenario.id === initialScenarioId) ??
    scenarios[0];

  return {
    cacheMode: "default",
    candidateText: "",
    canvasRevision: 0,
    editedExcalidrawScene: undefined,
    editedExcalidrawSceneSignature: undefined,
    generationCandidates: [],
    generationError: undefined,
    generationRunToken: 0,
    generationStatus: "idle",
    inspectorPanel: "ir",
    mode: "deterministic",
    scenarioId: selectedScenario?.id ?? "",
    selectedSuiteScenarioIds: selectedScenario ? [selectedScenario.id] : [],
    suiteError: undefined,
    suiteResults: [],
    suiteStatus: "idle",
  };
}

function replaceSuiteResult(
  results: readonly ScenarioSuitePanelResult[],
  nextResult: ScenarioSuitePanelResult,
): ScenarioSuitePanelResult[] {
  const nextResults = results.filter(
    (result) => result.scenarioId !== nextResult.scenarioId,
  );

  return [...nextResults, nextResult];
}

function toggleId(ids: readonly string[], id: string): string[] {
  return ids.includes(id)
    ? ids.filter((existingId) => existingId !== id)
    : [...ids, id];
}

export function createPlaygroundStore(
  scenarios: readonly DiagramScenario[],
  initialScenarioId?: string,
) {
  const store = new Store(createInitialState(scenarios, initialScenarioId));
  const actions = {
    setCacheMode: (cacheMode: DiagramGenerationCacheMode) => {
      store.setState((current) => ({ ...current, cacheMode }));
    },
    selectInspector: (inspectorPanel: InspectorPanel) => {
      store.setState((current) => ({ ...current, inspectorPanel }));
    },
    toggleSuiteScenario: (scenarioId: string) => {
      store.setState((current) => ({
        ...current,
        selectedSuiteScenarioIds: toggleId(
          current.selectedSuiteScenarioIds,
          scenarioId,
        ),
      }));
    },
    selectSuiteScenarios: (selectedSuiteScenarioIds: readonly string[]) => {
      store.setState((current) => ({ ...current, selectedSuiteScenarioIds }));
    },
    setCandidateText: (candidateText: string) => {
      store.setState((current) => ({
        ...current,
        candidateText,
        canvasRevision: current.canvasRevision + 1,
        editedExcalidrawScene: undefined,
        editedExcalidrawSceneSignature: undefined,
      }));
    },
    setScene: (scene: ExcalidrawScene) => {
      const signature = JSON.stringify(scene);
      store.setState((current) =>
        current.editedExcalidrawSceneSignature === signature
          ? current
          : {
              ...current,
              editedExcalidrawScene: scene,
              editedExcalidrawSceneSignature: signature,
            },
      );
    },
    setMode: (mode: PlaygroundMode) => {
      store.setState((current) =>
        current.mode === mode
          ? current
          : {
              ...current,
              editedExcalidrawScene: undefined,
              editedExcalidrawSceneSignature: undefined,
              inspectorPanel:
                mode === "deterministic"
                  ? current.inspectorPanel === "prompt"
                    ? "ir"
                    : current.inspectorPanel
                  : current.candidateText.trim().length > 0
                    ? "ir"
                    : "prompt",
              mode,
            },
      );
    },

    selectScenario: (nextScenario: DiagramScenario) => {
      store.setState((current) => ({
        ...current,
        candidateText: "",
        canvasRevision: current.canvasRevision + 1,
        editedExcalidrawScene: undefined,
        editedExcalidrawSceneSignature: undefined,
        generationCandidates: [],
        generationError: undefined,
        generationRunToken: current.generationRunToken + 1,
        generationStatus:
          current.generationStatus === "running" ? "running" : "idle",
        inspectorPanel: current.mode === "llm" ? "prompt" : "ir",
        scenarioId: nextScenario.id,
      }));
    },

    startGeneration: () => {
      const runToken = store.state.generationRunToken + 1;
      store.setState((current) => ({
        ...current,
        generationRunToken: runToken,
        generationError: undefined,
        generationStatus: "running",
        mode: "llm",
        suiteError: undefined,
      }));
      return runToken;
    },
    failGeneration: (scenarioId: string, runToken: number, error: unknown) => {
      if (
        store.state.scenarioId !== scenarioId ||
        store.state.generationRunToken !== runToken
      )
        return;
      store.setState((current) => ({
        ...current,
        generationError:
          error instanceof Error ? error.message : "Generation failed.",
        generationStatus: "error",
      }));
    },
    finishGeneration: () => {
      store.setState((current) =>
        current.generationStatus === "running"
          ? { ...current, generationStatus: "idle" }
          : current,
      );
    },
    updateSuiteResult: (result: ScenarioSuitePanelResult) => {
      store.setState((current) => ({
        ...current,
        suiteResults: replaceSuiteResult(current.suiteResults, result),
      }));
    },
    applyRunResult: (
      scenarioId: string,
      result: ScenarioGenerationResult,
      runToken: number,
      focusCandidate: boolean,
      candidateText: string,
    ) => {
      if (
        !focusCandidate ||
        store.state.scenarioId !== scenarioId ||
        store.state.generationRunToken !== runToken
      )
        return;
      store.setState((current) => ({
        ...current,
        candidateText,
        canvasRevision: current.canvasRevision + 1,
        editedExcalidrawScene: undefined,
        editedExcalidrawSceneSignature: undefined,
        generationCandidates: result.candidates,
        generationError: undefined,
        generationStatus: "complete",
        inspectorPanel: "ir",
        mode: "llm",
      }));
    },
    startSuite: () => {
      store.setState((current) => ({
        ...current,
        mode: "llm",
        suiteError: undefined,
        suiteStatus: "running",
      }));
    },
    completeSuite: () => {
      store.setState((current) => ({ ...current, suiteStatus: "complete" }));
    },
    failSuite: (error: unknown) => {
      store.setState((current) => ({
        ...current,
        suiteError:
          error instanceof Error ? error.message : "Scenario suite failed.",
        suiteStatus: "error",
      }));
    },
  };
  return { store, actions };
}

export type PlaygroundActions = ReturnType<
  typeof createPlaygroundStore
>["actions"];
