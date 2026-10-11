import { Schema } from "effect";

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
import type { DiagramTypeValue } from "./types.js";

/** One diagram of any canonical family, discriminated by `type`. */
export type CanonicalDiagram = FlowchartDiagram | MindmapDiagram | SequenceDiagram;

// A family added to DIAGRAM_TYPES without a contract here fails to compile.
const familySchemas = {
	flowchart: FlowchartDiagramSchema,
	mindmap: MindmapDiagramSchema,
	sequence: SequenceDiagramSchema,
} satisfies Record<DiagramTypeValue, Schema.Top>;

export const CanonicalDiagramSchema = Schema.Union([
	familySchemas.flowchart,
	familySchemas.mindmap,
	familySchemas.sequence,
]);

/** Apply the family's semantic validation to an already decoded diagram. */
export function validateCanonicalDiagram(diagram: CanonicalDiagram): CanonicalDiagram {
	switch (diagram.type) {
		case "flowchart":
			return validateFlowchartDiagram(diagram);
		case "mindmap":
			return validateMindmapDiagram(diagram);
		case "sequence":
			return validateSequenceDiagram(diagram);
	}
}

export function parseCanonicalDiagram(input: unknown): CanonicalDiagram {
	return validateCanonicalDiagram(
		Schema.decodeUnknownSync(CanonicalDiagramSchema, { errors: "all" })(input),
	);
}
