import { type FlowchartScenario, flowchartScenarios } from "./scenarios.js";
import { type SequenceScenario, sequenceScenarios } from "./sequence-scenarios.js";

/** A maintained scenario of any canonical family, discriminated by `diagramType`. */
export type DiagramScenario = FlowchartScenario | SequenceScenario;

export const diagramScenarios: readonly DiagramScenario[] = [
	...flowchartScenarios,
	...sequenceScenarios,
];

export function getDiagramScenario(id: string): DiagramScenario {
	const scenario = diagramScenarios.find((candidate) => candidate.id === id);
	if (!scenario) throw new Error(`Unknown scenario "${id}".`);
	return scenario;
}
