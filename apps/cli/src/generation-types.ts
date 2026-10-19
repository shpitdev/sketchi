import { CANONICAL_DOCUMENT_TYPES } from "@sketchi/diagram-agent";

import type { GenerationType } from "./generation.js";

/** How the generate wizard offers each canonical family; exhaustive by type. */
const GENERATION_TYPE_CHOICES = {
	timeline: { label: "Timeline", hint: "best for dated milestones and chronologies" },
	chart: { label: "Chart", hint: "best for bar, line and pie charts of numbers" },
	flowchart: { label: "Flowchart", hint: "best for processes and decisions" },
	mindmap: { label: "Mind map", hint: "best for ideas and topics" },
	sequence: { label: "Sequence diagram", hint: "best for ordered participant interactions" },
	"state-machine": { label: "State machine", hint: "best for states, events and lifecycles" },
	gantt: { label: "Gantt chart", hint: "best for scheduled tasks, dependencies and milestones" },
} as const satisfies Record<GenerationType, { readonly hint: string; readonly label: string }>;

/** Wizard options in registry order, one per canonical family. */
export const GENERATION_TYPE_OPTIONS = CANONICAL_DOCUMENT_TYPES.map((value) => ({
	value,
	...GENERATION_TYPE_CHOICES[value],
}));
