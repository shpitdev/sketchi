import { DIAGRAM_TYPES, type DiagramTypeValue } from "@sketchi/diagram-core";
import { Result, Schema } from "effect";

/** Generation produces every canonical family natively, and nothing else. */
export const DiagramGenerationTypeSchema = Schema.Literals(DIAGRAM_TYPES);
export type DiagramGenerationType = DiagramTypeValue;

/** The sole provider response shape. Diagram parsing happens after this envelope decodes. */
export class GeneratedDiagramResponse extends Schema.Class<GeneratedDiagramResponse>(
	"GeneratedDiagramResponse",
)({
	diagram: Schema.optionalKey(Schema.Unknown),
	title: Schema.optionalKey(Schema.String),
}) {}

export const GeneratedDiagramTitleSchema = Schema.String.pipe(
	Schema.check(Schema.isMinLength(1)),
	Schema.check(Schema.isMaxLength(60)),
);

const FALLBACK_TITLES: Readonly<Record<DiagramGenerationType, string>> = {
	flowchart: "Generated flowchart",
	mindmap: "Generated mindmap",
	sequence: "Generated sequence diagram",
	timeline: "Generated timeline",
	chart: "Generated chart",
	"state-machine": "Generated state machine",
	gantt: "Generated Gantt chart",
	er: "Generated ER diagram",
	class: "Generated class diagram",
	"org-chart": "Generated org chart",
	venn: "Generated Venn diagram",
	journey: "Generated journey map",
	sankey: "Generated Sankey diagram",
	wireframe: "Generated wireframe",
	quadrant: "Generated quadrant chart",
};

function titleFromId(id: string): string | undefined {
	const value = id.replace(/[-_]+/gu, " ").replace(/\s+/gu, " ").trim();
	if (value.length === 0 || value.length > 60) return undefined;
	return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Keep model titles bounded; invalid titles fall back without copying prompt text. */
export function modelTitleOrFallback(
	title: string | undefined,
	id: string,
	nativeKind: DiagramGenerationType,
): string {
	const candidate = title?.replace(/\s+/gu, " ").trim();
	const decoded = Schema.decodeUnknownResult(GeneratedDiagramTitleSchema)(candidate);
	if (Result.isSuccess(decoded)) return decoded.success;
	return titleFromId(id) ?? FALLBACK_TITLES[nativeKind];
}
