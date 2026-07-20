import "@tanstack/react-start/server-only";

import type {
  StandardJSONSchemaV1,
  StandardSchemaV1,
} from "@standard-schema/spec";
import { Schema } from "effect";

import { toCodeModeJsonSchema } from "@sketchi/diagram-agent";

export type PlaygroundStandardSchema<
  S extends Schema.ConstraintDecoder<unknown>,
> = S &
  StandardSchemaV1<S["Encoded"], S["Type"]> &
  StandardJSONSchemaV1<S["Encoded"], S["Type"]>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toDraft07(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(toDraft07);
  }
  if (!isRecord(value)) {
    return typeof value === "string"
      ? value.replaceAll("#/$defs/", "#/definitions/")
      : value;
  }

  const converted = Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "$schema")
      .map(([key, entry]) => [
        key === "$defs" ? "definitions" : key,
        toDraft07(entry),
      ]),
  );
  const clauses = converted.allOf;
  if (!Array.isArray(clauses) || !clauses.every(isRecord)) {
    return converted;
  }

  const base = Object.fromEntries(
    Object.entries(converted).filter(([key]) => key !== "allOf"),
  );
  const merged = { ...base };
  for (const clause of clauses) {
    for (const [key, entry] of Object.entries(clause)) {
      if (key in merged) {
        return converted;
      }
      merged[key] = entry;
    }
  }
  return merged;
}

function standardJsonSchema(
  schema: Schema.Constraint,
  target: StandardJSONSchemaV1.Target,
): Record<string, unknown> {
  const generated = toCodeModeJsonSchema(schema);
  if (target === "draft-2020-12") {
    return generated;
  }
  if (target === "draft-07") {
    const converted = toDraft07(generated);
    if (!isRecord(converted)) {
      throw new Error("Effect generated an invalid JSON Schema document.");
    }
    return {
      ...converted,
      $schema: "http://json-schema.org/draft-07/schema#",
    };
  }
  throw new Error(`Unsupported target: ${target}`);
}

/**
 * The single Playground framework boundary for Effect schemas. Validation and
 * JSON Schema generation stay attached to the same Effect contract so AI SDK
 * and other Standard Schema consumers cannot acquire a second authority.
 */
export function toPlaygroundStandardSchema<
  S extends Schema.ConstraintDecoder<unknown>,
>(schema: S): PlaygroundStandardSchema<S> {
  const standard = Schema.toStandardSchemaV1(
    Schema.toStandardJSONSchemaV1(schema),
    {
      parseOptions: { errors: "all" },
    },
  );
  Object.assign(standard["~standard"], {
    jsonSchema: {
      input: (options: StandardJSONSchemaV1.Options) =>
        standardJsonSchema(schema, options.target),
      output: (options: StandardJSONSchemaV1.Options) =>
        standardJsonSchema(Schema.toType(schema), options.target),
    },
  });
  return standard;
}
