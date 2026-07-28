export const DIAGRAM_TYPES = [
  "flowchart",
  "mindmap",
] as const;

export type DiagramTypeValue = (typeof DIAGRAM_TYPES)[number];
