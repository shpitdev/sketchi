import "@tanstack/react-start/server-only";

import {
  ApplyDiagramPatchRequestSchema,
  ApplyDiagramPatchResultSchema,
  BuildFlowchartRequestSchema,
  BuildFlowchartResultSchema,
  BuildMindmapRequestSchema,
  BuildMindmapResultSchema,
  BuildSequenceDiagramRequestSchema,
  BuildSequenceDiagramResultSchema,
  GetArtifactRequestSchema,
  GetArtifactResultSchema,
  CreateCanvasRequestSchema,
  CreateCanvasResultSchema,
} from "@sketchi/diagram-agent";
import type { Schema } from "effect";

import { toPlaygroundStandardSchema } from "../schema/effect-standard-schema.server";

export const CodeModeHttpSchemas = {
  applyDiagramPatch: {
    input: toPlaygroundStandardSchema(ApplyDiagramPatchRequestSchema),
    output: toPlaygroundStandardSchema(ApplyDiagramPatchResultSchema),
  },
  buildFlowchart: {
    input: toPlaygroundStandardSchema(BuildFlowchartRequestSchema),
    output: toPlaygroundStandardSchema(BuildFlowchartResultSchema),
  },
  buildMindmap: {
    input: toPlaygroundStandardSchema(BuildMindmapRequestSchema),
    output: toPlaygroundStandardSchema(BuildMindmapResultSchema),
  },
  buildSequenceDiagram: {
    input: toPlaygroundStandardSchema(BuildSequenceDiagramRequestSchema),
    output: toPlaygroundStandardSchema(BuildSequenceDiagramResultSchema),
  },
  createCanvas: {
    input: toPlaygroundStandardSchema(CreateCanvasRequestSchema),
    output: toPlaygroundStandardSchema(CreateCanvasResultSchema),
  },
  getArtifact: {
    input: toPlaygroundStandardSchema(GetArtifactRequestSchema),
    output: toPlaygroundStandardSchema(GetArtifactResultSchema),
  },
};

/**
 * Decode valid HTTP input through Standard Schema. Invalid input is preserved
 * for the package runtime so its canonical Code Mode issue codes, paths, and
 * repair hints remain the only failure mapping authority.
 */
export async function decodeCodeModeHttpInput<
  S extends Schema.ConstraintDecoder<unknown>,
>(
  schema: ReturnType<typeof toPlaygroundStandardSchema<S>>,
  input: unknown,
): Promise<unknown> {
  const result = await schema["~standard"].validate(input);
  return "issues" in result ? input : result.value;
}
