import type { FlowchartScenario } from "@sketchi/diagram-scenarios";
import { GenerationRunPanel } from "../generation-run-panel/index.js";
import type { EvaluationState } from "./scenario-playground.js";
import type { PlaygroundActions, PlaygroundState } from "./playground-store.js";

interface PlaygroundControlsProps {
	actions: PlaygroundActions;
	activeEvaluation: EvaluationState;
	busy: boolean;
	canGenerate: boolean;
	hasCandidateText: boolean;
	runGeneration: () => Promise<void>;
	scenarios: readonly FlowchartScenario[];
	selectedScenario: FlowchartScenario | undefined;
	state: PlaygroundState;
}

export function PlaygroundControls({
	actions,
	activeEvaluation,
	busy,
	canGenerate,
	hasCandidateText,
	runGeneration,
	scenarios,
	selectedScenario,
	state,
}: PlaygroundControlsProps) {
	const checks = activeEvaluation.result?.checks ?? [];
	return (
		<aside className="sketchi-scenario-playground__controls">
			<div
				aria-label="Scenario type"
				className="sketchi-scenario-playground__mode-tabs"
				role="tablist"
			>
				<button
					aria-selected={state.mode === "deterministic"}
					onClick={() => actions.setMode("deterministic")}
					role="tab"
					type="button"
				>
					Fixture conversion
				</button>
				<button
					aria-selected={state.mode === "llm"}
					onClick={() => actions.setMode("llm")}
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
							const nextScenario = scenarios.find((scenario) => scenario.id === event.target.value);
							if (nextScenario) {
								actions.selectScenario(nextScenario);
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
						<span>{selectedScenario.expectedDiagram.nodes.length} nodes</span>
						<span>{selectedScenario.expectedDiagram.edges.length} edges</span>
					</div>
				</section>
			) : null}

			{state.mode === "llm" ? (
				<GenerationRunPanel
					cacheMode={state.cacheMode}
					candidates={state.generationCandidates}
					disabled={!canGenerate || busy}
					{...(state.generationError ? { error: state.generationError } : {})}
					onCacheModeChange={actions.setCacheMode}
					onRun={() => void runGeneration()}
					running={state.generationStatus === "running"}
				/>
			) : null}

			<section className="sketchi-scenario-playground__checks">
				<h2>{state.mode === "llm" ? "Candidate checks" : "Fixture checks"}</h2>
				{state.mode === "llm" && !hasCandidateText ? (
					<p className="sketchi-scenario-playground__muted">No candidate run yet.</p>
				) : null}
				{activeEvaluation?.error ? (
					<p className="sketchi-scenario-playground__error">{activeEvaluation.error}</p>
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
	);
}
