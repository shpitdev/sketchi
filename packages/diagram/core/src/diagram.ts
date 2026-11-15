import {
	MindmapInputError,
	parseMindmap,
	validateMindmap,
	Mindmap,
} from "@sketchi/diagrams/mindmap";
import { DiagramValidationError } from "./intermediate.js";
import { Result, Schema } from "effect";

import { ChartValidationError, ChartDiagram, validateChartDiagram } from "./types/chart.js";
import {
	FlowchartValidationError,
	FlowchartDiagram,
	validateFlowchartDiagram,
} from "./types/flowchart.js";

import {
	SequenceValidationError,
	SequenceDiagram,
	validateSequenceDiagram,
} from "./types/sequence.js";
import {
	TimelineValidationError,
	TimelineDiagram,
	validateTimelineDiagram,
} from "./types/timeline.js";
import {
	StateMachineValidationError,
	StateMachineDiagram,
	validateStateMachineDiagram,
} from "./types/state-machine.js";
import { GanttValidationError, GanttDiagram, validateGanttDiagram } from "./types/gantt.js";
import { ErValidationError, ErDiagram, validateErDiagram } from "./types/er.js";
import { ClassValidationError, ClassDiagram, validateClassDiagram } from "./types/class.js";
import {
	OrgChartValidationError,
	OrgChartDiagram,
	validateOrgChartDiagram,
} from "./types/org-chart.js";
import { VennValidationError, VennDiagram, validateVennDiagram } from "./types/venn.js";
import { JourneyValidationError, JourneyDiagram, validateJourneyDiagram } from "./types/journey.js";
import { SankeyValidationError, SankeyDiagram, validateSankeyDiagram } from "./types/sankey.js";
import {
	WireframeValidationError,
	WireframeDiagram,
	validateWireframeDiagram,
} from "./types/wireframe.js";
import {
	QuadrantValidationError,
	QuadrantDiagram,
	validateQuadrantDiagram,
} from "./types/quadrant.js";
import { type DiagramTypeValue } from "./types.js";

// A family added to DIAGRAM_TYPES without a contract here fails to compile.
const familySchemas = {
	flowchart: FlowchartDiagram,
	mindmap: Mindmap,
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
]).pipe(Schema.toTaggedUnion("type"));

export type CanonicalDiagram = typeof CanonicalDiagramSchema.Type;
export const CanonicalValidationErrorSchema = Schema.Union([
	MindmapInputError,
	DiagramValidationError,
	ChartValidationError,
	FlowchartValidationError,
	SequenceValidationError,
	TimelineValidationError,
	StateMachineValidationError,
	GanttValidationError,
	ErValidationError,
	ClassValidationError,
	OrgChartValidationError,
	VennValidationError,
	JourneyValidationError,
	SankeyValidationError,
	WireframeValidationError,
	QuadrantValidationError,
]);
export type CanonicalValidationError = typeof CanonicalValidationErrorSchema.Type;

/** Apply the family's semantic validation to an already decoded diagram. */
export function validateCanonicalDiagram(
	diagram: CanonicalDiagram,
): Result.Result<CanonicalDiagram, CanonicalValidationError> {
	return CanonicalDiagramSchema.match(diagram, {
		flowchart: validateFlowchartDiagram,
		mindmap: validateMindmap,
		sequence: validateSequenceDiagram,
		timeline: validateTimelineDiagram,
		chart: validateChartDiagram,
		"state-machine": validateStateMachineDiagram,
		gantt: validateGanttDiagram,
		er: validateErDiagram,
		class: validateClassDiagram,
		"org-chart": validateOrgChartDiagram,
		venn: validateVennDiagram,
		journey: validateJourneyDiagram,
		sankey: validateSankeyDiagram,
		wireframe: validateWireframeDiagram,
		quadrant: validateQuadrantDiagram,
	});
}
export function parseCanonicalDiagram(
	input: unknown,
): Result.Result<CanonicalDiagram, Schema.SchemaError | CanonicalValidationError> {
	if (typeof input === "object" && input !== null && "type" in input && input.type === "mindmap")
		return parseMindmap(input);
	return Result.flatMap(
		Schema.decodeUnknownResult(CanonicalDiagramSchema, { errors: "all" })(input),
		validateCanonicalDiagram,
	);
}
