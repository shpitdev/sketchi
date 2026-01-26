import { z } from "zod";

export const ShapeType = z.enum(["rectangle", "ellipse", "diamond"]);
export type ShapeType = z.infer<typeof ShapeType>;

export const LabelSchema = z.object({
  text: z.string().describe("Text to display inside the shape"),
});

export const ShapeElementSchema = z.object({
  type: ShapeType,
  id: z.string().describe("Unique identifier for the shape"),
  label: LabelSchema.optional().describe("Text label inside shape"),
  backgroundColor: z.string().optional().describe("Fill color like #a5d8ff"),
  width: z.number().optional().describe("Width in pixels"),
  height: z.number().optional().describe("Height in pixels"),
});
export type ShapeElement = z.infer<typeof ShapeElementSchema>;

export const ArrowElementSchema = z.object({
  id: z.string().describe("Unique identifier for the arrow"),
  fromId: z.string().describe("ID of the shape where arrow starts"),
  toId: z.string().describe("ID of the shape where arrow ends"),
  label: LabelSchema.optional().describe("Optional label on the arrow"),
});
export type ArrowElement = z.infer<typeof ArrowElementSchema>;

export const DiagramSchema = z.object({
  shapes: z.array(ShapeElementSchema).describe("Array of shape elements"),
  arrows: z.array(ArrowElementSchema).describe("Array of arrow connections"),
});
export type Diagram = z.infer<typeof DiagramSchema>;

export const ChartType = z.enum([
  "flowchart",
  "mindmap",
  "orgchart",
  "sequence",
  "class",
  "er",
  "gantt",
  "timeline",
  "tree",
  "network",
  "architecture",
  "dataflow",
  "state",
  "swimlane",
  "concept",
  "fishbone",
  "swot",
  "pyramid",
  "funnel",
  "venn",
  "matrix",
  "infographic",
]);
export type ChartType = z.infer<typeof ChartType>;

export const LayoutDirection = z.enum(["TB", "LR", "BT", "RL"]);
export type LayoutDirection = z.infer<typeof LayoutDirection>;

export const IntermediateFormatSchema = z.object({
  chartType: ChartType.describe("The type of diagram to generate"),
  components: z
    .array(
      z.object({
        id: z.string().describe("Unique component identifier"),
        label: z.string().describe("Display label for the component"),
        shape: ShapeType.optional().describe("Shape type override"),
        color: z.string().optional().describe("Background color"),
        group: z.string().optional().describe("Grouping identifier"),
      })
    )
    .describe("List of components/nodes in the diagram"),
  relationships: z
    .array(
      z.object({
        from: z.string().describe("Source component ID"),
        to: z.string().describe("Target component ID"),
        label: z.string().optional().describe("Relationship label"),
        style: z
          .enum(["solid", "dashed", "dotted"])
          .optional()
          .describe("Line style"),
      })
    )
    .describe("List of connections between components"),
  layout: z
    .object({
      direction: LayoutDirection.optional().describe("Layout direction"),
      spacing: z.number().optional().describe("Spacing between elements"),
    })
    .optional()
    .describe("Layout preferences"),
});
export type IntermediateFormat = z.infer<typeof IntermediateFormatSchema>;

export function convertIntermediateToDiagram(
  intermediate: IntermediateFormat
): Diagram {
  const shapes: ShapeElement[] = intermediate.components.map((c) => ({
    type: c.shape ?? "rectangle",
    id: c.id,
    label: { text: c.label },
    backgroundColor: c.color,
  }));

  const arrows: ArrowElement[] = intermediate.relationships.map((r, idx) => ({
    id: `arrow_${idx}`,
    fromId: r.from,
    toId: r.to,
    label: r.label ? { text: r.label } : undefined,
  }));

  return { shapes, arrows };
}
