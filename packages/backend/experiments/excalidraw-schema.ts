import { z } from "zod";

export const LabelSchema = z.object({
  text: z.string().describe("Text to display inside the shape"),
});

export const BindingSchema = z.object({
  id: z.string().describe("ID of the element to bind to"),
});

export const RectangleSchema = z.object({
  type: z.literal("rectangle"),
  id: z.string().describe("Unique identifier"),
  width: z.number().optional().default(150).describe("Width in pixels"),
  height: z.number().optional().default(60).describe("Height in pixels"),
  label: LabelSchema.optional().describe("Text label inside shape"),
  backgroundColor: z.string().optional().describe("Fill color like #a5d8ff"),
});

export const EllipseSchema = z.object({
  type: z.literal("ellipse"),
  id: z.string(),
  width: z.number().optional().default(100),
  height: z.number().optional().default(100),
  label: LabelSchema.optional(),
  backgroundColor: z.string().optional(),
});

export const DiamondSchema = z.object({
  type: z.literal("diamond"),
  id: z.string(),
  width: z.number().optional().default(100),
  height: z.number().optional().default(100),
  label: LabelSchema.optional(),
  backgroundColor: z.string().optional(),
});

export const ArrowSchema = z.object({
  type: z.literal("arrow"),
  id: z.string().describe("Unique identifier"),
  start: BindingSchema.describe("Element where arrow starts"),
  end: BindingSchema.describe("Element where arrow ends"),
  label: LabelSchema.optional().describe("Label on the arrow"),
});

export const SkeletonElementSchema = z.discriminatedUnion("type", [
  RectangleSchema,
  EllipseSchema,
  DiamondSchema,
  ArrowSchema,
]);

export const DiagramSchema = z.object({
  elements: z
    .array(SkeletonElementSchema)
    .describe("Array of diagram elements - shapes and arrows"),
});

export type SkeletonElement = z.infer<typeof SkeletonElementSchema>;
export type Diagram = z.infer<typeof DiagramSchema>;
