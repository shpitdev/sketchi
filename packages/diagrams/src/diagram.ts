import {
	MindmapInputError,
	parseMindmap,
	validateMindmap,
	Mindmap,
} from "./families/mindmap/index.js";
import { DiagramValidationError } from "./graph/intermediate.js";
import { Result, Schema } from "effect";

import {
	ChartValidationError,
	ChartDiagram,
	validateChartDiagram,
} from "./families/chart/document.js";
import {
	FlowchartValidationError,
	FlowchartDiagram,
	validateFlowchartDiagram,
} from "./families/flowchart/diagram.js";

import {
	SequenceValidationError,
	SequenceDiagram,
	validateSequenceDiagram,
} from "./families/sequence/document.js";
import {
	TimelineValidationError,
	TimelineDiagram,
	validateTimelineDiagram,
} from "./families/timeline/document.js";
import {
	StateMachineValidationError,
	StateMachineDiagram,
	validateStateMachineDiagram,
} from "./families/state-machine/document.js";
import {
	GanttValidationError,
	GanttDiagram,
	validateGanttDiagram,
} from "./families/gantt/document.js";
import { ErValidationError, ErDiagram, validateErDiagram } from "./families/er/document.js";
import {
	ClassValidationError,
	ClassDiagram,
	validateClassDiagram,
} from "./families/class/document.js";
import {
	OrgChartValidationError,
	OrgChartDiagram,
	validateOrgChartDiagram,
} from "./families/org-chart/document.js";
import { VennValidationError, VennDiagram, validateVennDiagram } from "./families/venn/document.js";
import {
	JourneyValidationError,
	JourneyDiagram,
	validateJourneyDiagram,
} from "./families/journey/document.js";
import {
	SankeyValidationError,
	SankeyDiagram,
	validateSankeyDiagram,
} from "./families/sankey/document.js";
import {
	WireframeValidationError,
	WireframeDiagram,
	validateWireframeDiagram,
} from "./families/wireframe/document.js";
import {
	QuadrantValidationError,
	QuadrantDiagram,
	validateQuadrantDiagram,
} from "./families/quadrant/document.js";
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
