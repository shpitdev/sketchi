import type { ExcalidrawProps } from "@excalidraw/excalidraw/types";
import type {
  DiagramGenerationCacheMode,
  DiagramGenerationCandidateSummary,
  DiagramGenerationProviderId,
} from "@sketchi/diagram-generation";
import type {
  ExcalidrawElement,
  ExcalidrawScene,
} from "@sketchi/diagram-excalidraw";
import {
  buildScenarioPromptParts,
  evaluateScenarioFixture,
  evaluateScenarioOutput,
  flowchartScenarios,
  type DiagramScenario,
  type ScenarioEvaluation,
} from "@sketchi/diagram-scenarios";
import { Store, useStore } from "@tanstack/react-store";
import { useCallback, useMemo } from "react";

import { ExcalidrawSceneCanvas } from "../excalidraw-scene-canvas/index.js";
import { GenerationRunPanel } from "../generation-run-panel/index.js";
import { JsonCodeEditor } from "../json-code-editor/index.js";
import { PromptMessageViewer } from "../prompt-message-viewer/index.js";
import {
  ScenarioSuitePanel,
  type ScenarioSuitePanelResult,
} from "../scenario-suite-panel/index.js";

export interface ScenarioGenerationRequest {
  cacheMode: DiagramGenerationCacheMode;
  providers: readonly DiagramGenerationProviderId[];
  scenarioId: string;
}

export interface ScenarioGenerationResult {
  candidates: readonly DiagramGenerationCandidateSummary[];
  scenarioId: string;
}

export interface ScenarioPlaygroundProps {
  initialScenarioId?: string;
  onGenerateScenario?: (
    request: ScenarioGenerationRequest,
  ) => Promise<ScenarioGenerationResult>;
  scenarios?: readonly DiagramScenario[];
}

interface EvaluationState {
  error?: string;
  result?: ScenarioEvaluation;
}

type InspectorPanel = "ir" | "prompt" | "excalidraw";
type PlaygroundMode = "deterministic" | "llm";

interface PlaygroundState {
  cacheMode: DiagramGenerationCacheMode;
  candidateText: string;
  canvasRevision: number;
  editedExcalidrawScene: ExcalidrawScene | undefined;
  editedExcalidrawSceneSignature: string | undefined;
  generationCandidates: readonly DiagramGenerationCandidateSummary[];
  generationError: string | undefined;
  generationStatus: "idle" | "running" | "complete" | "error";
  inspectorPanel: InspectorPanel;
  mode: PlaygroundMode;
  scenarioId: string;
  selectedSuiteScenarioIds: readonly string[];
  suiteError: string | undefined;
  suiteResults: readonly ScenarioSuitePanelResult[];
  suiteStatus: "idle" | "running" | "complete" | "error";
}

function evaluateCandidate(
  scenario: DiagramScenario,
  candidateText: string,
): EvaluationState {
  if (candidateText.trim().length === 0) {
    return {};
  }

  try {
    return {
      result: evaluateScenarioOutput(scenario, candidateText),
    };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Candidate evaluation failed",
    };
  }
}

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

const defaultGenerationProviders: readonly DiagramGenerationProviderId[] = [
  "cloudflare-google-ai-studio",
];

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

function pickExcalidrawAppState(appState: Record<string, unknown>) {
  return {
    scrollX: appState.scrollX,
    scrollY: appState.scrollY,
    selectedElementIds: appState.selectedElementIds,
    viewBackgroundColor: appState.viewBackgroundColor,
    zoom: appState.zoom,
  };
}

function sceneFromExcalidrawChange(
  elements: readonly unknown[],
  appState: Record<string, unknown>,
): ExcalidrawScene {
  return {
    appState: pickExcalidrawAppState(appState),
    elements: elements as ExcalidrawElement[],
  };
}

function sceneChangeSignature(
  elements: readonly unknown[],
  appState: Record<string, unknown>,
): string {
  return JSON.stringify({
    appState: pickExcalidrawAppState(appState),
    elements,
  });
}

function pickCandidateText(
  candidates: readonly DiagramGenerationCandidateSummary[],
): string | undefined {
  const validCandidate = candidates.find(
    (generationCandidate) =>
      !generationCandidate.error && generationCandidate.diagramValid,
  );

  return (
    validCandidate?.text ?? candidates.find((candidate) => candidate.text)?.text
  );
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

function suiteRunResult(
  result: Omit<ScenarioSuitePanelResult, "durationMs"> & {
    durationMs: number | undefined;
  },
): ScenarioSuitePanelResult {
  const { durationMs, ...requiredResult } = result;

  return durationMs === undefined
    ? requiredResult
    : { ...requiredResult, durationMs };
}

function summarizeSuiteRun(
  scenario: DiagramScenario,
  candidates: readonly DiagramGenerationCandidateSummary[],
): ScenarioSuitePanelResult {
  const firstCandidate = candidates[0];
  const candidateText = pickCandidateText(candidates);

  if (!candidateText) {
    return suiteRunResult({
      durationMs: firstCandidate?.durationMs,
      message: firstCandidate?.error ?? "No generated candidate returned.",
      scenarioId: scenario.id,
      status: "fail",
      title: scenario.title,
    });
  }

  const evaluation = evaluateCandidate(scenario, candidateText);
  const failedChecks =
    evaluation.result?.checks.filter((check) => !check.passed) ?? [];

  return suiteRunResult({
    durationMs: firstCandidate?.durationMs,
    message: evaluation.error
      ? evaluation.error
      : evaluation.result?.ok
        ? "Passed deterministic checks"
        : failedChecks.map((check) => check.message).join(" "),
    scenarioId: scenario.id,
    status: evaluation.result?.ok ? "pass" : "fail",
    title: scenario.title,
  });
}

function toggleId(ids: readonly string[], id: string): string[] {
  return ids.includes(id)
    ? ids.filter((existingId) => existingId !== id)
    : [...ids, id];
}

export function ScenarioPlayground({
  initialScenarioId,
  onGenerateScenario,
  scenarios = flowchartScenarios,
}: ScenarioPlaygroundProps) {
  const store = useMemo(
    () => new Store(createInitialState(scenarios, initialScenarioId)),
    [initialScenarioId, scenarios],
  );
  const state = useStore(store, (current) => current);
  const selectedScenario =
    scenarios.find((scenario) => scenario.id === state.scenarioId) ??
    scenarios[0];

  const fixtureEvaluation = useMemo(
    () =>
      selectedScenario ? evaluateScenarioFixture(selectedScenario) : undefined,
    [selectedScenario],
  );
  const candidateEvaluation = useMemo(
    () =>
      selectedScenario
        ? evaluateCandidate(selectedScenario, state.candidateText)
        : undefined,
    [selectedScenario, state.candidateText],
  );
  const promptParts = selectedScenario
    ? buildScenarioPromptParts(selectedScenario)
    : undefined;
  const activeEvaluation: EvaluationState =
    state.mode === "llm"
      ? (candidateEvaluation ?? {})
      : fixtureEvaluation
        ? { result: fixtureEvaluation }
        : {};
  const activeResult = activeEvaluation?.result;
  const checks = activeResult?.checks ?? [];
  const displayedScene =
    state.editedExcalidrawScene ?? activeResult?.excalidrawScene;
  const mainPanelLabel =
    state.mode === "llm" ? "Live candidate" : "Fixture conversion";
  const statusOk =
    state.mode === "llm"
      ? Boolean(candidateEvaluation?.result?.ok) && !candidateEvaluation?.error
      : Boolean(fixtureEvaluation?.ok);
  const hasCandidateText = state.candidateText.trim().length > 0;
  const statusLabel =
    state.mode === "llm" && state.generationStatus === "running"
      ? "Running"
      : state.mode === "llm" &&
          !hasCandidateText &&
          state.generationStatus === "idle"
        ? "Ready"
        : statusOk
          ? "Passing"
          : "Needs attention";
  const statusClass =
    statusLabel === "Passing"
      ? "sketchi-scenario-playground__status"
      : statusLabel === "Ready" || statusLabel === "Running"
        ? "sketchi-scenario-playground__status sketchi-scenario-playground__status--ready"
        : "sketchi-scenario-playground__status sketchi-scenario-playground__status--failed";
  const inspectorTabs: Array<{ id: InspectorPanel; label: string }> =
    state.mode === "llm"
      ? [
          { id: "ir", label: "Candidate IR" },
          { id: "prompt", label: "Messages" },
          { id: "excalidraw", label: "Excalidraw JSON" },
        ]
      : [
          { id: "ir", label: "Fixture IR" },
          { id: "excalidraw", label: "Excalidraw JSON" },
        ];

  function setMode(mode: PlaygroundMode) {
    store.setState((current) => ({
      ...current,
      inspectorPanel:
        mode === "deterministic"
          ? current.inspectorPanel === "prompt"
            ? "ir"
            : current.inspectorPanel
          : current.candidateText.trim().length > 0
            ? "ir"
            : "prompt",
      mode,
    }));
  }

  function resetScenario(nextScenario: DiagramScenario) {
    store.setState((current) => ({
      ...current,
      candidateText: "",
      canvasRevision: current.canvasRevision + 1,
      editedExcalidrawScene: undefined,
      editedExcalidrawSceneSignature: undefined,
      generationCandidates: [],
      generationError: undefined,
      generationStatus: "idle",
      inspectorPanel: current.mode === "llm" ? "prompt" : "ir",
      scenarioId: nextScenario.id,
    }));
  }

  async function runScenario(
    scenario: DiagramScenario,
    focusCandidate: boolean,
  ) {
    if (!onGenerateScenario) {
      return undefined;
    }

    const generationResult = await onGenerateScenario({
      cacheMode: state.cacheMode,
      providers: defaultGenerationProviders,
      scenarioId: scenario.id,
    });
    const suiteSummary = summarizeSuiteRun(
      scenario,
      generationResult.candidates,
    );

    store.setState((current) => ({
      ...current,
      suiteResults: replaceSuiteResult(current.suiteResults, suiteSummary),
    }));

    if (!focusCandidate) {
      return generationResult;
    }

    const nextCandidateText = pickCandidateText(generationResult.candidates);

    store.setState((current) => ({
      ...current,
      candidateText: nextCandidateText ?? "",
      canvasRevision: current.canvasRevision + 1,
      editedExcalidrawScene: undefined,
      editedExcalidrawSceneSignature: undefined,
      generationCandidates: generationResult.candidates,
      generationError: undefined,
      generationStatus: "complete",
      inspectorPanel: "ir",
      mode: "llm",
    }));

    return generationResult;
  }

  async function runGeneration() {
    if (!selectedScenario || !onGenerateScenario) {
      return;
    }

    store.setState((current) => ({
      ...current,
      generationError: undefined,
      generationStatus: "running",
      mode: "llm",
      suiteError: undefined,
    }));

    try {
      await runScenario(selectedScenario, true);
    } catch (error) {
      store.setState((current) => ({
        ...current,
        generationError:
          error instanceof Error ? error.message : "Generation failed.",
        generationStatus: "error",
      }));
    }
  }

  async function runSelectedSuite() {
    if (!onGenerateScenario) {
      return;
    }

    const selectedScenarios = scenarios.filter((scenario) =>
      state.selectedSuiteScenarioIds.includes(scenario.id),
    );

    if (selectedScenarios.length === 0) {
      return;
    }

    store.setState((current) => ({
      ...current,
      mode: "llm",
      suiteError: undefined,
      suiteStatus: "running",
    }));

    try {
      for (const scenario of selectedScenarios) {
        store.setState((current) => ({
          ...current,
          suiteResults: replaceSuiteResult(current.suiteResults, {
            message: "Running",
            scenarioId: scenario.id,
            status: "running",
            title: scenario.title,
          }),
        }));

        await runScenario(scenario, scenario.id === selectedScenario?.id);
      }

      store.setState((current) => ({
        ...current,
        suiteStatus: "complete",
      }));
    } catch (error) {
      store.setState((current) => ({
        ...current,
        suiteError:
          error instanceof Error ? error.message : "Scenario suite failed.",
        suiteStatus: "error",
      }));
    }
  }

  const handleExcalidrawChange: NonNullable<ExcalidrawProps["onChange"]> =
    useCallback(
      (elements, appState) => {
        const typedAppState = appState as unknown as Record<string, unknown>;
        const signature = sceneChangeSignature(elements, typedAppState);

        store.setState((current) => {
          if (current.editedExcalidrawSceneSignature === signature) {
            return current;
          }

          return {
            ...current,
            editedExcalidrawScene: sceneFromExcalidrawChange(
              elements,
              typedAppState,
            ),
            editedExcalidrawSceneSignature: signature,
          };
        });
      },
      [store],
    );

  return (
    <section className="sketchi-scenario-playground">
      <header className="sketchi-scenario-playground__header">
        <div>
          <p className="sketchi-scenario-playground__eyebrow">Eval Harness</p>
          <h1>Sketchi scenario harness</h1>
        </div>
        <span className={statusClass}>{statusLabel}</span>
      </header>

      <div className="sketchi-scenario-playground__layout">
        <aside className="sketchi-scenario-playground__controls">
          <div
            aria-label="Scenario type"
            className="sketchi-scenario-playground__mode-tabs"
            role="tablist"
          >
            <button
              aria-selected={state.mode === "deterministic"}
              onClick={() => setMode("deterministic")}
              role="tab"
              type="button"
            >
              Fixture conversion
            </button>
            <button
              aria-selected={state.mode === "llm"}
              onClick={() => setMode("llm")}
              role="tab"
              type="button"
            >
              Live generation
            </button>
          </div>

          {state.mode === "deterministic" ? (
            <label className="sketchi-scenario-playground__scenario-selector">
              Scenario
              <select
                value={selectedScenario?.id}
                onChange={(event) => {
                  const nextScenario = scenarios.find(
                    (scenario) => scenario.id === event.target.value,
                  );
                  if (nextScenario) {
                    resetScenario(nextScenario);
                  }
                }}
              >
                {scenarios.map((scenario) => (
                  <option key={scenario.id} value={scenario.id}>
                    {scenario.title}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {selectedScenario ? (
            <section className="sketchi-scenario-playground__scenario-card">
              <h2>{selectedScenario.title}</h2>
              <p>{selectedScenario.description}</p>
              <div>
                <span>{selectedScenario.difficulty}</span>
                <span>
                  {selectedScenario.expectedDiagram.nodes.length} nodes
                </span>
                <span>
                  {selectedScenario.expectedDiagram.edges.length} edges
                </span>
              </div>
            </section>
          ) : null}

          {state.mode === "llm" ? (
            <GenerationRunPanel
              cacheMode={state.cacheMode}
              candidates={state.generationCandidates}
              disabled={!onGenerateScenario}
              {...(state.generationError
                ? { error: state.generationError }
                : {})}
              onCacheModeChange={(cacheMode) =>
                store.setState((current) => ({
                  ...current,
                  cacheMode,
                }))
              }
              onRun={runGeneration}
              running={state.generationStatus === "running"}
            />
          ) : null}

          <section className="sketchi-scenario-playground__checks">
            <h2>
              {state.mode === "llm" ? "Candidate checks" : "Fixture checks"}
            </h2>
            {state.mode === "llm" && !hasCandidateText ? (
              <p className="sketchi-scenario-playground__muted">
                No candidate run yet.
              </p>
            ) : null}
            {activeEvaluation?.error ? (
              <p className="sketchi-scenario-playground__error">
                {activeEvaluation.error}
              </p>
            ) : null}
            <ul>
              {checks.map((check) => (
                <li key={check.id} data-pass={check.passed}>
                  <span>{check.passed ? "Pass" : "Fail"}</span>
                  {check.message}
                </li>
              ))}
            </ul>
          </section>
        </aside>

        <main className="sketchi-scenario-playground__main">
          <div className="sketchi-scenario-playground__canvas-header">
            <h2>{selectedScenario?.title ?? "Scenario"}</h2>
            <span>{mainPanelLabel}</span>
          </div>
          {displayedScene && activeResult ? (
            <ExcalidrawSceneCanvas
              onChange={handleExcalidrawChange}
              revision={state.canvasRevision}
              scene={displayedScene}
              title={activeResult.diagram.title}
            />
          ) : (
            <div className="sketchi-scenario-playground__empty-canvas">
              {state.mode === "llm"
                ? "No live candidate yet"
                : "No generated diagram"}
            </div>
          )}
        </main>

        <aside
          className={[
            "sketchi-scenario-playground__inspector",
            state.mode === "llm"
              ? "sketchi-scenario-playground__inspector--with-suite"
              : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <div
            aria-label="Inspector"
            className="sketchi-scenario-playground__tabs"
            role="tablist"
          >
            {inspectorTabs.map((tab) => (
              <button
                aria-selected={state.inspectorPanel === tab.id}
                key={tab.id}
                onClick={() =>
                  store.setState((current) => ({
                    ...current,
                    inspectorPanel: tab.id,
                  }))
                }
                role="tab"
                type="button"
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="sketchi-scenario-playground__inspector-body">
            {state.inspectorPanel === "ir" &&
            state.mode === "llm" &&
            !hasCandidateText ? (
              <div className="sketchi-scenario-playground__empty-inspector">
                No candidate run yet
              </div>
            ) : null}

            {state.inspectorPanel === "ir" &&
            (state.mode !== "llm" || hasCandidateText) ? (
              <JsonCodeEditor
                id={state.mode === "llm" ? "candidate-ir" : "fixture-ir"}
                label={state.mode === "llm" ? "Candidate IR" : "Fixture IR"}
                maxHeight="min(340px, calc(100vh - 420px))"
                minHeight="180px"
                {...(state.mode === "llm"
                  ? {
                      onChange: (value: string) =>
                        store.setState((current) => ({
                          ...current,
                          candidateText: value,
                          canvasRevision: current.canvasRevision + 1,
                          editedExcalidrawScene: undefined,
                          editedExcalidrawSceneSignature: undefined,
                        })),
                    }
                  : {})}
                readOnly={state.mode !== "llm"}
                value={
                  state.mode === "llm"
                    ? state.candidateText
                    : formatJson(selectedScenario?.expectedDiagram ?? {})
                }
              />
            ) : null}

            {state.inspectorPanel === "prompt" && state.mode === "llm" ? (
              <PromptMessageViewer
                messages={promptParts?.messages ?? []}
                title="Prompt messages"
              />
            ) : null}

            {state.inspectorPanel === "excalidraw" ? (
              <JsonCodeEditor
                id="excalidraw-json"
                label="Excalidraw JSON"
                maxHeight="min(340px, calc(100vh - 420px))"
                minHeight="180px"
                readOnly
                value={formatJson(displayedScene ?? {})}
              />
            ) : null}
          </div>

          {state.mode === "llm" ? (
            <ScenarioSuitePanel
              batchControlsOpen={state.selectedSuiteScenarioIds.length > 1}
              disabled={!onGenerateScenario}
              {...(selectedScenario
                ? { activeScenarioId: selectedScenario.id }
                : {})}
              {...(state.suiteError ? { error: state.suiteError } : {})}
              onActivateScenario={(scenarioId) => {
                const nextScenario = scenarios.find(
                  (scenario) => scenario.id === scenarioId,
                );

                if (nextScenario) {
                  resetScenario(nextScenario);
                }
              }}
              onClearSelection={() =>
                store.setState((current) => ({
                  ...current,
                  selectedSuiteScenarioIds: [],
                }))
              }
              onRunSelected={runSelectedSuite}
              onSelectAll={() =>
                store.setState((current) => ({
                  ...current,
                  selectedSuiteScenarioIds: scenarios.map(
                    (scenario) => scenario.id,
                  ),
                }))
              }
              onToggleScenario={(scenarioId) =>
                store.setState((current) => ({
                  ...current,
                  selectedSuiteScenarioIds: toggleId(
                    current.selectedSuiteScenarioIds,
                    scenarioId,
                  ),
                }))
              }
              results={state.suiteResults}
              running={state.suiteStatus === "running"}
              scenarios={scenarios.map((scenario) => ({
                difficulty: scenario.difficulty,
                id: scenario.id,
                title: scenario.title,
              }))}
              selectedScenarioIds={state.selectedSuiteScenarioIds}
              title="Eval scenario set"
            />
          ) : null}
        </aside>
      </div>
    </section>
  );
}
