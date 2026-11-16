import { contractMissingKeyCodeAnnotation } from "../input.js";

import { Effect, Schema, SchemaAST, SchemaGetter, SchemaIssue } from "effect";

const codeModeJsonSchemaAnnotationKeys = new Set([
	"x-sketchi-default",
	"x-sketchi-one-of",
	"const",
	"exclusiveMaximum",
	"exclusiveMinimum",
	"maximum",
	"maxLength",
	"maxItems",
	"minimum",
	"minItems",
	"minLength",
	"pattern",
]);

const contractDefaultAnnotation = "x-sketchi-default";
export const contractOneOfAnnotation = "x-sketchi-one-of";

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Effect 4 preserves soundness by downgrading `oneOf` to `anyOf` whenever a
 * branch contains a JSON Schema approximation. Our tagged scene and patch
 * unions remain mutually exclusive because every branch has a distinct
 * discriminator, so retain their established public contract. Effect also
 * renders property annotations on class-backed defaults through `allOf`; fold
 * those metadata-only annotations back into the property schema.
 */
function normalizeCodeModeJsonSchema(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(normalizeCodeModeJsonSchema);
	}
	if (!isRecord(value)) return value;

	const normalized = Object.fromEntries(
		Object.entries(value).map(([key, nested]) => [key, normalizeCodeModeJsonSchema(nested)]),
	);

	const forceOneOf = normalized[contractOneOfAnnotation] === true;
	delete normalized[contractOneOfAnnotation];
	if (forceOneOf && Array.isArray(normalized["anyOf"])) {
		normalized["oneOf"] = normalized["anyOf"];
		delete normalized["anyOf"];
	}

	const allOf = normalized["allOf"];
	if (Array.isArray(allOf)) {
		const remaining: unknown[] = [];
		for (const clause of allOf) {
			if (isRecord(clause) && Object.hasOwn(clause, contractDefaultAnnotation)) {
				normalized["default"] = clause[contractDefaultAnnotation];
			} else {
				remaining.push(clause);
			}
		}
		if (remaining.length === 0) delete normalized["allOf"];
		else normalized["allOf"] = remaining;
	}

	return normalized;
}

export function toCodeModeJsonSchema(schema: Schema.Constraint): Record<string, unknown> {
	const document = Schema.toJsonSchemaDocument(Schema.toType(schema), {
		includeAnnotationKey: (key) => codeModeJsonSchemaAnnotationKeys.has(key),
		onExcessProperty: "error",
	});
	return normalizeCodeModeJsonSchema({
		$schema: "https://json-schema.org/draft/2020-12/schema",
		...document.schema,
		...(Object.keys(document.definitions).length === 0 ? {} : { $defs: document.definitions }),
	}) as Record<string, unknown>;
}

export function nonEmptyString() {
	const minimumLength = 1;
	return Schema.String.check(
		Schema.isMinLength(minimumLength, {
			message: "Too small: expected string to have >=1 characters",
		}),
	);
}

export function nonEmptyArray<S extends Schema.Constraint>(schema: S) {
	const minimumLength = 1;
	return Schema.Array(schema)
		.pipe(Schema.mutable)
		.check(
			Schema.isMinLength(minimumLength, {
				message: "Too small: expected array to have >=1 items",
			}),
		);
}

export function optionalContract<S extends Schema.Constraint>(schema: S): Schema.optionalKey<S> {
	return Schema.optionalKey(schema);
}

export function requiredString<S extends Schema.Top>(schema: S): S["Rebuild"] {
	return schema.pipe(
		Schema.annotateKey({
			[contractMissingKeyCodeAnnotation]: "invalid_type",
			messageMissingKey: "Invalid input: expected string, received undefined",
		}),
	);
}

export function requiredObject<S extends Schema.Top>(schema: S): S["Rebuild"] {
	return schema.pipe(
		Schema.annotateKey({
			[contractMissingKeyCodeAnnotation]: "invalid_type",
			messageMissingKey: "Invalid input: expected object, received undefined",
		}),
	);
}

export function requiredArray<S extends Schema.Top>(schema: S): S["Rebuild"] {
	return schema.pipe(
		Schema.annotateKey({
			[contractMissingKeyCodeAnnotation]: "invalid_type",
			messageMissingKey: "Invalid input: expected array, received undefined",
		}),
	);
}

export function literals<
	const Values extends readonly [SchemaAST.LiteralValue, ...SchemaAST.LiteralValue[]],
>(values: Values) {
	return Schema.Literals(values).annotate({
		message: `Invalid option: expected one of ${values
			.map((value) => JSON.stringify(value))
			.join("|")}`,
	});
}

export function stringLiteral<const Value extends string>(value: Value) {
	return literalDeclaration<string, Value>(value, Schema.String);
}

export function booleanLiteral<const Value extends boolean>(value: Value) {
	return literalDeclaration<boolean, Value>(value, Schema.Boolean);
}

function literalDeclaration<
	Primitive extends string | number | boolean,
	const Value extends Primitive,
>(value: Value, primitive: Schema.Codec<Primitive>) {
	const declaration = Schema.declareConstructor<Value>()(
		[],
		() => (input, ast, options) =>
			input === value
				? Effect.succeed(value)
				: Effect.fail(new SchemaIssue.InvalidType(ast, input, options)),
		{
			message: `Invalid literal value, expected ${JSON.stringify(value)}`,
			toCodecJson: () =>
				Schema.link<Value>()(primitive.annotate({ const: value }), {
					decode: SchemaGetter.transform(() => value),
					encode: SchemaGetter.transform((input) => input as Primitive),
				}),
		},
	);
	return Schema.Literal(value).pipe(Schema.decodeTo(declaration));
}

export const NonEmptyString = nonEmptyString();
export const RequiredNonEmptyString = requiredString(NonEmptyString);
export const FiniteNumber = Schema.Finite;
const hexColorPattern = /^#[0-9a-fA-F]{6}$/u;
function hexColor(defaultValue?: string) {
	return Schema.String.annotate(defaultValue === undefined ? {} : { default: defaultValue }).check(
		Schema.isPattern(hexColorPattern, {
			message: `Invalid string: must match pattern /${hexColorPattern.source}/`,
		}),
	);
}
export const HexColor = hexColor();
