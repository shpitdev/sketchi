import { CANONICAL_DOCUMENT_TYPES, isCanonicalDocumentType } from "@sketchi/diagram-agent";
import {
	listAlternatives,
	SUPPORTED_GENERATION_MODELS,
	UnsupportedDiagramIntentKindSchema,
} from "@sketchi/diagram-generation";
import { Schema } from "effect";

/**
 * Every type a generate request may name: each canonical family, which it
 * generates, plus the kinds it recognizes only to reject as unsupported.
 */
export const GENERATE_REQUEST_TYPES = [
	...CANONICAL_DOCUMENT_TYPES,
	...UnsupportedDiagramIntentKindSchema.literals,
] as const;

export const GenerateRequestSchema = Schema.Struct({
	cacheMode: Schema.optional(Schema.Literals(["default", "fresh"])),
	prompt: Schema.String,
	type: Schema.optional(Schema.Literals(GENERATE_REQUEST_TYPES)),
	model: Schema.optional(Schema.String),
});

export const decodeGenerateRequest = Schema.decodeUnknownResult(GenerateRequestSchema, {
	errors: "all",
});

/** Only canonical families are generated; every other named type is unsupported. */
export const isNativeGenerateType = isCanonicalDocumentType;

const nativeTypeList = listAlternatives(CANONICAL_DOCUMENT_TYPES);

export const GENERATE_REQUEST_COPY = {
	invalidInput: `The generate request must include a string prompt and an optional type of ${nativeTypeList}.`,
	requestSupportedType: `Request a ${nativeTypeList} diagram instead.`,
	unsupportedModel: `The requested model is not supported. Supported models: ${listAlternatives(SUPPORTED_GENERATION_MODELS)}.`,
	requestSupportedModel: "Omit the model to use the default, or name a supported model.",
} as const;
