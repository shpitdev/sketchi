import { z } from "zod";
import {
  type DiagramType,
  DiagramTypeSchema,
  GraphOptionsSchema,
  IntermediateFormatSchema,
} from "./diagram-intermediate";

const diagramTypes = DiagramTypeSchema.options;

const graphOptionsFor = (diagramType: DiagramType) =>
  GraphOptionsSchema.extend({
    diagramType: z.literal(diagramType),
  });

const intermediateSchemaFor = (diagramType: DiagramType) =>
  IntermediateFormatSchema.extend({
    graphOptions: graphOptionsFor(diagramType),
  });

const intermediateEntries = diagramTypes.map(
  (diagramType) =>
    [
      `intermediate/${diagramType}-v1`,
      {
        schema: intermediateSchemaFor(diagramType),
        diagramType,
      },
    ] as const
);

const ExcalidrawElementSkeletonSchema = z.array(
  z.record(z.string(), z.unknown())
);

export const OUTPUT_SCHEMA_REGISTRY = {
  "intermediate/auto-v1": {
    schema: IntermediateFormatSchema,
  },
  "excalidraw/elements-v1": {
    schema: ExcalidrawElementSkeletonSchema,
  },
  ...Object.fromEntries(intermediateEntries),
} as const satisfies Record<
  string,
  {
    schema: z.ZodTypeAny;
    diagramType?: DiagramType;
  }
>;

export type OutputSchemaId = keyof typeof OUTPUT_SCHEMA_REGISTRY;

export function getOutputSchema(id: string) {
  return OUTPUT_SCHEMA_REGISTRY[id as OutputSchemaId];
}
