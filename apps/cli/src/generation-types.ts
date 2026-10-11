import { CANONICAL_DOCUMENT_TYPES } from "@sketchi/diagram-agent";

import type { GenerationType } from "./generation.js";

/** How the generate wizard offers each canonical family; exhaustive by type. */
const GENERATION_TYPE_CHOICES = {
	flowchart: { label: "Flowchart", hint: "best for processes and decisions" },
	mindmap: { label: "Mind map", hint: "best for ideas and topics" },
	sequence: { label: "Sequence diagram", hint: "best for ordered participant interactions" },
} as const satisfies Record<GenerationType, { readonly hint: string; readonly label: string }>;

/** Wizard options in registry order, one per canonical family. */
export const GENERATION_TYPE_OPTIONS = CANONICAL_DOCUMENT_TYPES.map((value) => ({
	value,
	...GENERATION_TYPE_CHOICES[value],
}));
