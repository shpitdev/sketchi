import {
  buildScenarioPromptParts,
  type DiagramScenario,
  type ScenarioEvaluation,
} from "@sketchi/diagram-scenarios";
import { JsonCodeEditor } from "../json-code-editor/index.js";
import { PromptMessageViewer } from "../prompt-message-viewer/index.js";
import { ScenarioSuitePanel } from "../scenario-suite-panel/index.js";
import type {
  InspectorPanel,
  PlaygroundActions,
  PlaygroundState,
} from "./playground-store.js";

export function PlaygroundInspector({
  actions,
  activeResult,
  busy,
  canGenerate,
  hasCandidateText,
  runSelectedSuite,
  scenarios,
  selectedScenario,
  state,
}: {
  actions: PlaygroundActions;
  activeResult: ScenarioEvaluation | undefined;
  busy: boolean;
  canGenerate: boolean;
  hasCandidateText: boolean;
  runSelectedSuite: () => Promise<void>;
  scenarios: readonly DiagramScenario[];
  selectedScenario: DiagramScenario | undefined;
  state: PlaygroundState;
}) {
  const promptParts = selectedScenario
    ? buildScenarioPromptParts(selectedScenario)
    : undefined;
  const displayedScene =
    state.editedExcalidrawScene ?? activeResult?.excalidrawScene;
  const formatJson = (value: unknown) => JSON.stringify(value, null, 2);
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

  return (
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
            onClick={() => actions.selectInspector(tab.id)}
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
                  onChange: actions.setCandidateText,
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
          disabled={!canGenerate || busy}
          {...(selectedScenario
            ? { activeScenarioId: selectedScenario.id }
            : {})}
          {...(state.suiteError ? { error: state.suiteError } : {})}
          onActivateScenario={(scenarioId) => {
            const nextScenario = scenarios.find(
              (scenario) => scenario.id === scenarioId,
            );

            if (nextScenario) {
              actions.selectScenario(nextScenario);
            }
          }}
          onClearSelection={() => actions.selectSuiteScenarios([])}
          onRunSelected={runSelectedSuite}
          onSelectAll={() =>
            actions.selectSuiteScenarios(
              scenarios.map((scenario) => scenario.id),
            )
          }
          onToggleScenario={actions.toggleSuiteScenario}
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
  );
}
