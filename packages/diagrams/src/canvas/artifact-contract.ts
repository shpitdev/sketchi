import { CodeModeIssue } from "../build/result.js";

import { ArtifactFormatSchema, ArtifactProvenance } from "@sketchi/drawing/artifacts";
import { Schema } from "effect";

import {
	booleanLiteral,
	literals,
	optionalContract,
	RequiredNonEmptyString,
} from "../build/code-mode/schema.js";

export const GetArtifactRequest = Schema.Struct({
	artifactId: RequiredNonEmptyString,
	format: optionalContract(ArtifactFormatSchema),
	inline: optionalContract(Schema.Boolean),
}).annotate({ identifier: undefined });

export interface GetArtifactRequest extends Schema.Schema.Type<typeof GetArtifactRequest> {}

export const GetArtifactAccepted = Schema.Struct({
	ok: booleanLiteral(true),
	artifactId: Schema.String,
	diagramId: Schema.String,
	format: ArtifactFormatSchema,
	mimeType: Schema.String,
	url: optionalContract(Schema.String),
	expiresAt: optionalContract(Schema.String),
	inline: optionalContract(Schema.Unknown),
	sizeBytes: optionalContract(Schema.Number),
	provenance: optionalContract(ArtifactProvenance),
}).annotate({ identifier: undefined });

export interface GetArtifactAccepted extends Schema.Schema.Type<typeof GetArtifactAccepted> {}
export const GetArtifactRejected = Schema.Struct({
	ok: booleanLiteral(false),
	status: literals([
		"invalid_input",
		"not_found",
		"format_unavailable",
		"expired",
		"storage_failed",
	]),
	issues: Schema.Array(CodeModeIssue).pipe(Schema.mutable),
}).annotate({ identifier: undefined });

export interface GetArtifactRejected extends Schema.Schema.Type<typeof GetArtifactRejected> {}
export const GetArtifactResultSchema = Schema.Union([GetArtifactAccepted, GetArtifactRejected]);
export type GetArtifactResult = typeof GetArtifactResultSchema.Type;
