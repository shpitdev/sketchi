import { Schema } from "effect";

import { PublishedBuildIssue } from "../build/result";
import { ApplyDiagramPatchRequest } from "../canvas/patch-contract";
import { DIAGRAM_TYPES } from "../family";
import { PublishedCoverageIssue } from "../families/flowchart/issues";

/**
 * Room for a pasted roster, DDL schema or task list of the largest diagrams the family limits
 * allow: 25 tables of DDL with their usual columns run past 8,000 bytes.
 */
export const MAX_GENERATE_REQUEST_BYTES = 64 * 1024;
export const MAX_GENERATE_PROMPT_LENGTH = 20000;

/** The stored document a revision starts from; its spec is validated before generation. */
export const GenerateBase = Schema.Struct({
	type: Schema.Literals(DIAGRAM_TYPES),
	spec: Schema.Unknown,
});

export const GenerateRequest = Schema.Struct({
	prompt: Schema.String,
	type: Schema.optional(Schema.Literals(DIAGRAM_TYPES)),
	model: Schema.optional(Schema.String),
	base: Schema.optional(GenerateBase),
});
export interface GenerateRequest extends Schema.Schema.Type<typeof GenerateRequest> {}

const Present = Schema.Unknown.check(Schema.makeFilter((value) => value !== undefined));

/** A warning installed CLIs decode before storing a diagram: only published codes. */
export const GenerateWarning = Schema.Union([PublishedBuildIssue, PublishedCoverageIssue]);
export type GenerateWarning = typeof GenerateWarning.Type;

/**
 * One completed generation. The scene and Excalidraw file are carried as built; callers decode
 * them with their drawing owners before storing them.
 */
export const GenerateAccepted = Schema.Struct({
	ok: Schema.Literal(true),
	status: Schema.Literal("generated"),
	issues: Schema.Array(GenerateWarning),
	diagram: Schema.Struct({
		document: Schema.Struct({ type: Schema.Literals(DIAGRAM_TYPES), spec: Present }),
		scene: Present,
		excalidraw: Present,
		/** Colors and shapes the request asked for, as patch operations for the caller to apply. */
		patch: Schema.optionalKey(
			Schema.Struct({ operations: ApplyDiagramPatchRequest.fields.operations }),
		),
		/** A flowchart revision's edits, which made the document from the base the caller sent. */
		edits: Schema.optionalKey(Schema.Array(Schema.Unknown)),
	}),
	generation: Schema.Struct({
		attempts: Schema.optionalKey(Schema.Number),
		durationMs: Schema.optionalKey(Schema.Number),
		model: Schema.NonEmptyString,
		provider: Schema.NonEmptyString,
		usage: Schema.optionalKey(
			Schema.Struct({
				inputTokens: Schema.optionalKey(Schema.Number),
				outputTokens: Schema.optionalKey(Schema.Number),
			}),
		),
	}),
});
export interface GenerateAccepted extends Schema.Schema.Type<typeof GenerateAccepted> {}

export const GenerateIssue = Schema.Struct({
	code: Schema.String,
	severity: Schema.Literal("error"),
	stage: Schema.Literals(["input", "generation", "build"]),
	message: Schema.String,
	hint: Schema.String,
});
export interface GenerateIssue extends Schema.Schema.Type<typeof GenerateIssue> {}

export const GenerateRejected = Schema.Struct({
	ok: Schema.Literal(false),
	status: Schema.Literals([
		"invalid_input",
		"unsupported_model",
		"provider_failed",
		"generation_timeout",
		"limit_exceeded",
		"malformed_output",
		"invalid_generated_document",
		"quality_failed",
		"render_failed",
		"export_failed",
		"storage_failed",
	]),
	issues: Schema.Array(GenerateIssue),
});
export interface GenerateRejected extends Schema.Schema.Type<typeof GenerateRejected> {}

export type GenerateResult = GenerateAccepted | GenerateRejected;
