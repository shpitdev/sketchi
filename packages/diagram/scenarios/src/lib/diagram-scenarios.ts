import { type ChartScenario, chartScenarios } from "./chart-scenarios";
import { type MindmapScenario, mindmapScenarios } from "./mindmap-scenarios";
import { type TimelineScenario, timelineScenarios } from "./timeline-scenarios";
import { type FlowchartScenario, flowchartScenarios } from "./scenarios";
import { type SequenceScenario, sequenceScenarios } from "./sequence-scenarios";
import { type StateMachineScenario, stateMachineScenarios } from "./state-machine-scenarios";
import { type GanttScenario, ganttScenarios } from "./gantt-scenarios";
import { type ErScenario, erScenarios } from "./er-scenarios";
import { type ClassScenario, classScenarios } from "./class-scenarios";
import { type OrgChartScenario, orgChartScenarios } from "./org-chart-scenarios";
import { type VennScenario, vennScenarios } from "./venn-scenarios";
import { type JourneyScenario, journeyScenarios } from "./journey-scenarios";
import { type SankeyScenario, sankeyScenarios } from "./sankey-scenarios";
import { type WireframeScenario, wireframeScenarios } from "./wireframe-scenarios";
import { type QuadrantScenario, quadrantScenarios } from "./quadrant-scenarios";

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
