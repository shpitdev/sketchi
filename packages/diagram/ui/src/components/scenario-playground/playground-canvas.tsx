import type { FlowchartScenario, ScenarioEvaluation } from "@sketchi/diagram-scenarios";
import { ExcalidrawSceneCanvas } from "../excalidraw-scene-canvas/index.js";
import type { PlaygroundActions, PlaygroundState } from "./playground-store.js";

export function PlaygroundCanvas({
	actions,
	activeResult,
	selectedScenario,
	state,
}: {
	actions: PlaygroundActions;
	activeResult: ScenarioEvaluation | undefined;
	selectedScenario: FlowchartScenario | undefined;
	state: PlaygroundState;
}) {
	const mainPanelLabel = state.mode === "llm" ? "Live candidate" : "Fixture conversion";
	return (
		<main className="sketchi-scenario-playground__main">
			<div className="sketchi-scenario-playground__canvas-header">
				<h2>{selectedScenario?.title ?? "Scenario"}</h2>
				<span>{mainPanelLabel}</span>
			</div>
			{activeResult ? (
				<ExcalidrawSceneCanvas
					onSceneChange={actions.setScene}
					revision={`${state.mode}:${state.canvasRevision}`}
					scene={activeResult.excalidrawScene}
					title={activeResult.diagram.title}
				/>
			) : (
				<div className="sketchi-scenario-playground__empty-canvas">
					{state.mode === "llm" ? "No live candidate yet" : "No generated diagram"}
				</div>
			)}
		</main>
	);
}
