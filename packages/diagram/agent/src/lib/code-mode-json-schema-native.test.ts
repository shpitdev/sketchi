import { describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";

const annotationKeys = new Set(["const", "minItems", "minLength"]);

function jsonSchema(schema: Schema.Constraint) {
  return Schema.toJsonSchemaDocument(Schema.toType(schema), {
    includeAnnotationKey: (key) => annotationKeys.has(key),
  }).schema;
}

describe("Effect beta.99 native JSON Schema primitives", () => {
  it("uses exact property optionality without a null schema", () => {
    const schema = Schema.Struct({ value: Schema.optionalKey(Schema.String) });

    expect(jsonSchema(schema)).toEqual({
      type: "object",
      properties: { value: { type: "string" } },
      additionalProperties: false,
    });
    expect(Schema.decodeUnknownSync(schema)({})).toEqual({});
    expect(() =>
      Schema.decodeUnknownSync(schema)({ value: undefined }),
    ).toThrow("Expected string, got undefined");
  });

  it("emits parameterized string and literal constraints without allOf", () => {
    const minimumLength = 1;
    const nonEmpty = Schema.String.annotate({
      minLength: minimumLength,
    }).check(Schema.makeFilter((value) => value.length >= minimumLength));
    const literalValue = "node";
    const literal = Schema.Literal(literalValue).pipe(
      Schema.decodeTo(
        Schema.String.annotate({ const: literalValue }).pipe(
          Schema.refine(
            (value): value is typeof literalValue => value === literalValue,
          ),
        ),
      ),
    );

    expect(jsonSchema(nonEmpty)).toEqual({ type: "string", minLength: 1 });
    expect(jsonSchema(literal)).toEqual({ type: "string", const: "node" });
  });

  it("emits oneOf from the native union mode", () => {
    const schema = Schema.Union([Schema.String, Schema.Boolean], {
      mode: "oneOf",
    });

    expect(jsonSchema(schema)).toEqual({
      oneOf: [{ type: "string" }, { type: "boolean" }],
    });
  });

  it("emits array and default annotations structurally", () => {
    const minimumItems = 1;
    const array = Schema.Array(Schema.String)
      .annotate({ minItems: minimumItems })
      .check(Schema.makeFilter((value) => value.length >= minimumItems));
    const defaultValue = "x";
    const defaulted = Schema.String.annotate({
      default: defaultValue,
    }).pipe(Schema.withDecodingDefault(Effect.succeed(defaultValue)));

    expect(jsonSchema(array)).toEqual({
      type: "array",
      items: { type: "string" },
      minItems: 1,
    });
    expect(jsonSchema(defaulted)).toEqual({
      type: "string",
      default: "x",
    });
  });

  it("records default-key input behavior for both beta.99 helpers", () => {
    const defaultValue = "x";
    const defaultKey = Schema.Struct({
      value: Schema.String.annotate({ default: defaultValue }).pipe(
        Schema.withDecodingDefaultKey(Effect.succeed(defaultValue)),
      ),
    });
    const defaultValueOrUndefined = Schema.Struct({
      value: Schema.String.annotate({ default: defaultValue }).pipe(
        Schema.withDecodingDefault(Effect.succeed(defaultValue)),
      ),
    });

    expect(jsonSchema(defaultKey)).toEqual(jsonSchema(defaultValueOrUndefined));
    expect(Schema.decodeUnknownSync(defaultKey)({})).toEqual({ value: "x" });
    expect(() =>
      Schema.decodeUnknownSync(defaultKey)({ value: undefined }),
    ).toThrow("Expected string, got undefined");
    expect(
      Schema.decodeUnknownSync(defaultValueOrUndefined)({ value: undefined }),
    ).toEqual({ value: "x" });
  });

  it("uses one explicit recursive identifier without aliases", () => {
    interface Topic {
      readonly label: string;
      readonly children?: ReadonlyArray<Topic> | undefined;
    }

    const TopicReference: Schema.Codec<Topic> = Schema.suspend(
      () => TopicSchema,
    ).annotate({ identifier: "__schema0" });
    const TopicSchema: Schema.Codec<Topic> = Schema.Struct({
      label: Schema.String,
      children: Schema.optionalKey(Schema.Array(TopicReference)),
    });
    const schema = Schema.Struct({ root: TopicReference });

    expect(Schema.toJsonSchemaDocument(Schema.toType(schema))).toEqual({
      dialect: "draft-2020-12",
      schema: {
        type: "object",
        properties: { root: { $ref: "#/$defs/__schema0" } },
        required: ["root"],
        additionalProperties: false,
      },
      definitions: {
        __schema0: {
          type: "object",
          properties: {
            label: { type: "string" },
            children: {
              type: "array",
              items: { $ref: "#/$defs/__schema0" },
            },
          },
          required: ["label"],
          additionalProperties: false,
        },
      },
    });
  });
});
