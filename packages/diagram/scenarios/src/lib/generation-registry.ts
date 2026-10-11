import {
	generationReliabilityScenarios,
	type GenerationReliabilityScenario,
} from "./generation-reliability.js";
import { type DiagramScenario, diagramScenarios } from "./diagram-scenarios.js";

export type RegisteredGenerationScenario = DiagramScenario | GenerationReliabilityScenario;

export const generationScenarioRegistry: readonly RegisteredGenerationScenario[] = [
	...diagramScenarios,
	...generationReliabilityScenarios,
];

export function getGenerationScenario(id: string): RegisteredGenerationScenario {
	const scenario = generationScenarioRegistry.find((candidate) => candidate.id === id);
	if (!scenario) throw new Error(`Unknown scenario "${id}".`);
	return scenario;
}
