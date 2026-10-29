import { type ChartScenario, chartScenarios } from "./chart-scenarios.js";
import { type MindmapScenario, mindmapScenarios } from "./mindmap-scenarios.js";
import { type TimelineScenario, timelineScenarios } from "./timeline-scenarios.js";
import { type FlowchartScenario, flowchartScenarios } from "./scenarios.js";
import { type SequenceScenario, sequenceScenarios } from "./sequence-scenarios.js";
import { type StateMachineScenario, stateMachineScenarios } from "./state-machine-scenarios.js";
import { type GanttScenario, ganttScenarios } from "./gantt-scenarios.js";
import { type ErScenario, erScenarios } from "./er-scenarios.js";
import { type ClassScenario, classScenarios } from "./class-scenarios.js";
import { type OrgChartScenario, orgChartScenarios } from "./org-chart-scenarios.js";
import { type VennScenario, vennScenarios } from "./venn-scenarios.js";
import { type JourneyScenario, journeyScenarios } from "./journey-scenarios.js";
import { type SankeyScenario, sankeyScenarios } from "./sankey-scenarios.js";
import { type WireframeScenario, wireframeScenarios } from "./wireframe-scenarios.js";
import { type QuadrantScenario, quadrantScenarios } from "./quadrant-scenarios.js";

/** A maintained scenario of any canonical family, discriminated by `diagramType`. */
export type DiagramScenario =
	| FlowchartScenario
	| SequenceScenario
	| TimelineScenario
	| ChartScenario
	| StateMachineScenario
	| MindmapScenario
	| GanttScenario
	| ErScenario
	| ClassScenario
	| OrgChartScenario
	| VennScenario
	| JourneyScenario
	| SankeyScenario
	| WireframeScenario
	| QuadrantScenario;

export const diagramScenarios: readonly DiagramScenario[] = [
	...flowchartScenarios,
	...sequenceScenarios,
	...timelineScenarios,
	...chartScenarios,
	...stateMachineScenarios,
	...mindmapScenarios,
	...ganttScenarios,
	...erScenarios,
	...classScenarios,
	...orgChartScenarios,
	...vennScenarios,
	...journeyScenarios,
	...sankeyScenarios,
	...wireframeScenarios,
	...quadrantScenarios,
];

export function getDiagramScenario(id: string): DiagramScenario {
	const scenario = diagramScenarios.find((candidate) => candidate.id === id);
	if (!scenario) throw new Error(`Unknown scenario "${id}".`);
	return scenario;
}
