import { z } from "zod";
import { DiagramTypeSchema } from "../diagram-intermediate";

const PromptDiagramTypeSchema = DiagramTypeSchema.or(z.literal("auto"));

const VariableSchema = z
  .object({
    name: z.string().min(1),
    type: z.string().min(1),
    required: z.boolean().default(false),
    description: z.string().optional(),
  })
  .strict();

export const PromptFrontmatterSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    version: z.number().int().positive(),
    role: z.enum(["system", "user", "assistant"]),
    purpose: z.string().min(1),
    tags: z.array(z.string()).optional(),
    diagramType: PromptDiagramTypeSchema.optional(),
    outputSchemaId: z.string().min(1),
    variables: z.array(VariableSchema).optional(),
    variantOf: z.string().optional(),
  })
  .strict();

export type PromptFrontmatter = z.infer<typeof PromptFrontmatterSchema>;
export type PromptVariable = z.infer<typeof VariableSchema>;
