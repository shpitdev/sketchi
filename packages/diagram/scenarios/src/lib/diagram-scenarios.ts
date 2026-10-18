import { type ChartScenario, chartScenarios } from "./chart-scenarios.js";
import { type TimelineScenario, timelineScenarios } from "./timeline-scenarios.js";
import { type FlowchartScenario, flowchartScenarios } from "./scenarios.js";
import { type SequenceScenario, sequenceScenarios } from "./sequence-scenarios.js";
import { type StateMachineScenario, stateMachineScenarios } from "./state-machine-scenarios.js";

/** A maintained scenario of any canonical family, discriminated by `diagramType`. */
export type DiagramScenario =
	| FlowchartScenario
	| SequenceScenario
	| TimelineScenario
	| ChartScenario
	| StateMachineScenario;

export const diagramScenarios: readonly DiagramScenario[] = [
	...flowchartScenarios,
	...sequenceScenarios,
	...timelineScenarios,
	...chartScenarios,
	...stateMachineScenarios,
];

export function getDiagramScenario(id: string): DiagramScenario {
	const scenario = diagramScenarios.find((candidate) => candidate.id === id);
	if (!scenario) throw new Error(`Unknown scenario "${id}".`);
	return scenario;
}
