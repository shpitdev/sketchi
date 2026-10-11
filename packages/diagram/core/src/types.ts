/**
 * Every canonical diagram family. A family listed here must complete each
 * pipeline stage in docs/diagram-families.md; type-structure.test.ts and the
 * family pipeline test fail when one is missing.
 */
export const DIAGRAM_TYPES = ["flowchart", "mindmap", "sequence"] as const;

export type DiagramTypeValue = (typeof DIAGRAM_TYPES)[number];

/** Families expressed as the node/edge `IntermediateDiagram` graph. */
export const GRAPH_DIAGRAM_TYPES = [
	"flowchart",
	"mindmap",
] as const satisfies readonly DiagramTypeValue[];
