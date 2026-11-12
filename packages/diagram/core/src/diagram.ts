import { Schema } from "effect";

import { ChartDiagram, validateChartDiagram } from "./types/chart.js";
import { FlowchartDiagram, validateFlowchartDiagram } from "./types/flowchart.js";
import { MindmapDiagram, validateMindmapDiagram } from "./types/mindmap.js";
import { SequenceDiagram, validateSequenceDiagram } from "./types/sequence.js";
import { TimelineDiagram, validateTimelineDiagram } from "./types/timeline.js";
import { StateMachineDiagram, validateStateMachineDiagram } from "./types/state-machine.js";
import { GanttDiagram, validateGanttDiagram } from "./types/gantt.js";
import { ErDiagram, validateErDiagram } from "./types/er.js";
import { ClassDiagram, validateClassDiagram } from "./types/class.js";
import { OrgChartDiagram, validateOrgChartDiagram } from "./types/org-chart.js";
import { VennDiagram, validateVennDiagram } from "./types/venn.js";
import { JourneyDiagram, validateJourneyDiagram } from "./types/journey.js";
import { SankeyDiagram, validateSankeyDiagram } from "./types/sankey.js";
import { WireframeDiagram, validateWireframeDiagram } from "./types/wireframe.js";
import { QuadrantDiagram, validateQuadrantDiagram } from "./types/quadrant.js";
import type { DiagramTypeValue } from "./types.js";

/** One diagram of any canonical family, discriminated by `type`. */
export type CanonicalDiagram =
	| FlowchartDiagram
	| MindmapDiagram
	| SequenceDiagram
	| TimelineDiagram
	| ChartDiagram
	| StateMachineDiagram
	| GanttDiagram
	| ErDiagram
	| ClassDiagram
	| OrgChartDiagram
	| VennDiagram
	| JourneyDiagram
	| SankeyDiagram
	| WireframeDiagram
	| QuadrantDiagram;

// A family added to DIAGRAM_TYPES without a contract here fails to compile.
const familySchemas = {
	flowchart: FlowchartDiagram,
	mindmap: MindmapDiagram,
	sequence: SequenceDiagram,
	timeline: TimelineDiagram,
	chart: ChartDiagram,
	"state-machine": StateMachineDiagram,
	gantt: GanttDiagram,
	er: ErDiagram,
	class: ClassDiagram,
	"org-chart": OrgChartDiagram,
	venn: VennDiagram,
	journey: JourneyDiagram,
	sankey: SankeyDiagram,
	wireframe: WireframeDiagram,
	quadrant: QuadrantDiagram,
} satisfies Record<DiagramTypeValue, Schema.Top>;

export const CanonicalDiagramSchema = Schema.Union([
	familySchemas.flowchart,
	familySchemas.mindmap,
	familySchemas.sequence,
	familySchemas.timeline,
	familySchemas.chart,
	familySchemas["state-machine"],
	familySchemas.gantt,
	familySchemas.er,
	familySchemas.class,
	familySchemas["org-chart"],
	familySchemas.venn,
	familySchemas.journey,
	familySchemas.sankey,
	familySchemas.wireframe,
	familySchemas.quadrant,
]);

/** Apply the family's semantic validation to an already decoded diagram. */
export function validateCanonicalDiagram(diagram: CanonicalDiagram): CanonicalDiagram {
	switch (diagram.type) {
		case "flowchart":
			return validateFlowchartDiagram(diagram);
		case "mindmap":
			return validateMindmapDiagram(diagram);
		case "timeline":
			return validateTimelineDiagram(diagram);
		case "sequence":
			return validateSequenceDiagram(diagram);
		case "chart":
			return validateChartDiagram(diagram);
		case "state-machine":
			return validateStateMachineDiagram(diagram);
		case "gantt":
			return validateGanttDiagram(diagram);
		case "er":
			return validateErDiagram(diagram);
		case "class":
			return validateClassDiagram(diagram);
		case "org-chart":
			return validateOrgChartDiagram(diagram);
		case "venn":
			return validateVennDiagram(diagram);
		case "journey":
			return validateJourneyDiagram(diagram);
		case "sankey":
			return validateSankeyDiagram(diagram);
		case "wireframe":
			return validateWireframeDiagram(diagram);
		case "quadrant":
			return validateQuadrantDiagram(diagram);
	}
}

export function parseCanonicalDiagram(input: unknown): CanonicalDiagram {
	return validateCanonicalDiagram(
		Schema.decodeUnknownSync(CanonicalDiagramSchema, { errors: "all" })(input),
	);
}
