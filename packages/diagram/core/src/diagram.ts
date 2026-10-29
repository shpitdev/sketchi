import { Schema } from "effect";

import { type ChartDiagram, ChartDiagramSchema, validateChartDiagram } from "./types/chart.js";
import {
	type FlowchartDiagram,
	FlowchartDiagramSchema,
	validateFlowchartDiagram,
} from "./types/flowchart.js";
import {
	type MindmapDiagram,
	MindmapDiagramSchema,
	validateMindmapDiagram,
} from "./types/mindmap.js";
import {
	type SequenceDiagram,
	SequenceDiagramSchema,
	validateSequenceDiagram,
} from "./types/sequence.js";
import {
	type TimelineDiagram,
	TimelineDiagramSchema,
	validateTimelineDiagram,
} from "./types/timeline.js";
import {
	type StateMachineDiagram,
	StateMachineDiagramSchema,
	validateStateMachineDiagram,
} from "./types/state-machine.js";
import { type GanttDiagram, GanttDiagramSchema, validateGanttDiagram } from "./types/gantt.js";
import { type ErDiagram, ErDiagramSchema, validateErDiagram } from "./types/er.js";
import { type ClassDiagram, ClassDiagramSchema, validateClassDiagram } from "./types/class.js";
import {
	type OrgChartDiagram,
	OrgChartDiagramSchema,
	validateOrgChartDiagram,
} from "./types/org-chart.js";
import { type VennDiagram, VennDiagramSchema, validateVennDiagram } from "./types/venn.js";
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
	| VennDiagram;

// A family added to DIAGRAM_TYPES without a contract here fails to compile.
const familySchemas = {
	flowchart: FlowchartDiagramSchema,
	mindmap: MindmapDiagramSchema,
	sequence: SequenceDiagramSchema,
	timeline: TimelineDiagramSchema,
	chart: ChartDiagramSchema,
	"state-machine": StateMachineDiagramSchema,
	gantt: GanttDiagramSchema,
	er: ErDiagramSchema,
	class: ClassDiagramSchema,
	"org-chart": OrgChartDiagramSchema,
	venn: VennDiagramSchema,
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
	}
}

export function parseCanonicalDiagram(input: unknown): CanonicalDiagram {
	return validateCanonicalDiagram(
		Schema.decodeUnknownSync(CanonicalDiagramSchema, { errors: "all" })(input),
	);
}
