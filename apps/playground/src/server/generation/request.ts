import { DIAGRAM_TYPES } from "@sketchi/diagrams/family";

import { listAlternatives } from "@sketchi/diagrams/generate/messages";
import { Schema } from "effect";

/** The stored document a revision starts from; its spec is validated before generation. */
export const GenerateBaseSchema = Schema.Struct({
	type: Schema.Literals(DIAGRAM_TYPES),
	spec: Schema.Unknown,
});

export const GenerateRequestSchema = Schema.Struct({
	prompt: Schema.String,
	type: Schema.optional(Schema.Literals(DIAGRAM_TYPES)),
	model: Schema.optional(Schema.String),
	base: Schema.optional(GenerateBaseSchema),
});

export const decodeGenerateRequest = Schema.decodeUnknownResult(GenerateRequestSchema, {
	errors: "all",
});

const nativeTypeList = listAlternatives(DIAGRAM_TYPES);

export const GENERATE_REQUEST_COPY = {
	invalidInput: `The generate request must include a string prompt and an optional type of ${nativeTypeList}.`,
	invalidBase: "The base diagram is not a valid Sketchi document.",
	requestValidBase:
		"Send the stored document's type and spec unchanged, or omit base for a new diagram.",
	unsupportedModel: "The requested model is not supported.",
	requestSupportedModel: "Omit the model to use the default.",
} as const;
