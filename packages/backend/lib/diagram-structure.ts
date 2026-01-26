import { z } from "zod";

export const ShapeTypeSchema = z.enum(["rectangle", "ellipse", "diamond"]);
export type ShapeType = z.infer<typeof ShapeTypeSchema>;

export const LabelSchema = z.object({
  text: z.string().describe("Text to display inside the shape"),
});
export type Label = z.infer<typeof LabelSchema>;

export const ShapeElementSchema = z.object({
  type: ShapeTypeSchema,
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
