import { CANONICAL_DOCUMENT_TYPES } from "@sketchi/diagram-agent";
import { listAlternatives, SUPPORTED_GENERATION_MODELS } from "@sketchi/diagram-generation";
import { Schema } from "effect";

export const GenerateRequestSchema = Schema.Struct({
	cacheMode: Schema.optional(Schema.Literals(["default", "fresh"])),
	prompt: Schema.String,
	type: Schema.optional(Schema.Literals(CANONICAL_DOCUMENT_TYPES)),
	model: Schema.optional(Schema.String),
});

export const decodeGenerateRequest = Schema.decodeUnknownResult(GenerateRequestSchema, {
	errors: "all",
});

const nativeTypeList = listAlternatives(CANONICAL_DOCUMENT_TYPES);

export const GENERATE_REQUEST_COPY = {
	invalidInput: `The generate request must include a string prompt and an optional type of ${nativeTypeList}.`,
	unsupportedModel: `The requested model is not supported. Supported models: ${listAlternatives(SUPPORTED_GENERATION_MODELS)}.`,
	requestSupportedModel: "Omit the model to use the default, or name a supported model.",
} as const;
