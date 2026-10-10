import { Schema } from "effect";
import {
  ApplyDiagramPatchRequestSchema,
  ApplyDiagramPatchResultSchema,
  BuildFlowchartRequestSchema,
  BuildFlowchartResultSchema,
  BuildMindmapRequestSchema,
  BuildMindmapResultSchema,
  BuildSequenceDiagramRequestSchema,
  BuildSequenceDiagramResultSchema,
  CreateCanvasRequestSchema,
  CreateCanvasResultSchema,
  GetArtifactRequestSchema,
  GetArtifactResultSchema,
  SearchIconsRequestSchema,
  SearchIconsResultSchema,
  toCodeModeJsonSchema,
} from "@sketchi/diagram-agent";

export const codeModeContracts = {
  buildFlowchart: {
    input: BuildFlowchartRequestSchema,
    output: BuildFlowchartResultSchema,
  },
  buildMindmap: {
    input: BuildMindmapRequestSchema,
    output: BuildMindmapResultSchema,
  },
  buildSequenceDiagram: {
    input: BuildSequenceDiagramRequestSchema,
    output: BuildSequenceDiagramResultSchema,
  },
  createCanvas: {
    input: CreateCanvasRequestSchema,
    output: CreateCanvasResultSchema,
  },
  getArtifact: {
    input: GetArtifactRequestSchema,
    output: GetArtifactResultSchema,
  },
  applyDiagramPatch: {
    input: ApplyDiagramPatchRequestSchema,
    output: ApplyDiagramPatchResultSchema,
  },
  searchIcons: {
    input: SearchIconsRequestSchema,
    output: SearchIconsResultSchema,
  },
};

const record = Schema.decodeUnknownSync(
  Schema.Record(Schema.String, Schema.Unknown),
);

/** JSON constraints remain enforced by the host; declarations describe their structural types. */
export function jsonSchemaType(value: unknown, prefix: string): string {
  if (value === true) return "unknown";
  if (value === false) return "never";
  const schema = record(value);
  if (typeof schema.$ref === "string") {
    if (!schema.$ref.startsWith("#/$defs/"))
      throw new Error(`Unsupported reference: ${schema.$ref}`);
    return `${prefix}_${schema.$ref.slice("#/$defs/".length)}`;
  }
  if ("const" in schema) return JSON.stringify(schema.const);
  if (Array.isArray(schema.enum))
    return schema.enum.map((entry) => JSON.stringify(entry)).join(" | ");
  for (const keyword of ["anyOf", "oneOf", "allOf"]) {
    const members = schema[keyword];
    if (Array.isArray(members)) {
      return `(${members.map((member) => jsonSchemaType(member, prefix)).join(keyword === "allOf" ? " & " : " | ")})`;
    }
  }
  switch (schema.type) {
    case "string":
      return "string";
    case "integer":
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "null":
      return "null";
    case "array": {
      if (Array.isArray(schema.prefixItems)) {
        const tuple = schema.prefixItems.map((item) =>
          jsonSchemaType(item, prefix),
        );
        if (schema.items !== false)
          tuple.push(`...Array<${jsonSchemaType(schema.items ?? {}, prefix)}>`);
        return `[${tuple.join(", ")}]`;
      }
      return `Array<${jsonSchemaType(schema.items ?? {}, prefix)}>`;
    }
    case "object": {
      const required = Array.isArray(schema.required) ? schema.required : [];
      const fields = Object.entries(record(schema.properties ?? {})).map(
        ([name, property]) =>
          `${JSON.stringify(name)}${required.includes(name) ? "" : "?"}: ${jsonSchemaType(property, prefix)};`,
      );
      if (schema.additionalProperties !== false) {
        fields.push(
          `[key: string]: ${jsonSchemaType(schema.additionalProperties ?? {}, prefix)};`,
        );
      }
      return `{ ${fields.join(" ")} }`;
    }
    case undefined:
      if (
        Object.keys(schema).every((key) =>
          ["$schema", "$defs", "title", "description", "default"].includes(key),
        )
      )
        return "unknown";
      // Fail the drift check rather than silently advertising an unsupported shape.
      throw new Error(
        `Unsupported Code Mode JSON Schema: ${JSON.stringify(schema)}`,
      );
    default:
      throw new Error(
        `Unsupported Code Mode JSON Schema type: ${String(schema.type)}`,
      );
  }
}

export function generateCodeModeTypes(): string {
  const signatures: string[] = [];
  const declarations: string[] = [];
  for (const [operation, contracts] of Object.entries(codeModeContracts)) {
    const name = operation.charAt(0).toUpperCase() + operation.slice(1);
    signatures.push(
      `  ${operation}(input: ${name}Request): Promise<${name}Result>;`,
    );
    // Project inputs before the JSON Schema helper normalizes to the type side.
    for (const [suffix, contract] of [
      ["Request", Schema.toEncoded(contracts.input)],
      ["Result", Schema.toType(contracts.output)],
    ] as const) {
      const alias = `${name}${suffix}`;
      const schema = toCodeModeJsonSchema(contract);
      declarations.push(`type ${alias} = ${jsonSchemaType(schema, alias)};`);
      for (const [ref, definition] of Object.entries(
        record(schema.$defs ?? {}),
      )) {
        declarations.push(
          `type ${alias}_${ref} = ${jsonSchemaType(definition, alias)};`,
        );
      }
    }
  }
  return `// Generated from the package Code Mode schemas. Do not edit by hand.\ndeclare const sketchi: {\n${signatures.join("\n")}\n};\n\n${declarations.join("\n\n")}\n`;
}
