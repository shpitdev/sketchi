import { BuildOptions, CodeModeIssue } from "../build/result.js";

import { CanvasSpec } from "@sketchi/drawing";
import { ArtifactBundleSchema, PartialArtifactBundleSchema } from "@sketchi/drawing/artifacts";
import { Schema } from "effect";

import {
	booleanLiteral,
	literals,
	NonEmptyString,
	optionalContract,
	requiredObject,
	stringLiteral,
} from "../build/schema.js";
import { CanvasInput } from "./input.js";

export const CreateCanvasRequest = Schema.Struct({
	requestId: optionalContract(NonEmptyString),
	spec: requiredObject(CanvasInput),
	options: optionalContract(BuildOptions),
}).annotate({ identifier: undefined });

export interface CreateCanvasRequest extends Schema.Schema.Type<typeof CreateCanvasRequest> {}

export const CreateCanvasAccepted = Schema.Struct({
	ok: booleanLiteral(true),
	status: stringLiteral("accepted"),
	buildId: Schema.String,
	requestId: optionalContract(Schema.String),
	normalizedSpec: CanvasSpec,
	artifact: ArtifactBundleSchema,
	issues: Schema.Array(CodeModeIssue).pipe(Schema.mutable),
}).annotate({ identifier: undefined });

export interface CreateCanvasAccepted extends Schema.Schema.Type<typeof CreateCanvasAccepted> {}

export const CreateCanvasRejected = Schema.Struct({
	ok: booleanLiteral(false),
	status: literals([
		"invalid_input",
		"invalid_canvas",
		"limit_exceeded",
		"render_failed",
		"export_failed",
		"storage_failed",
	]),
	buildId: optionalContract(Schema.String),
	requestId: optionalContract(Schema.String),
	normalizedSpec: optionalContract(CanvasSpec),
	partial: optionalContract(PartialArtifactBundleSchema),
	issues: Schema.Array(CodeModeIssue).pipe(Schema.mutable),
}).annotate({ identifier: undefined });

export interface CreateCanvasRejected extends Schema.Schema.Type<typeof CreateCanvasRejected> {}

export const CreateCanvasResultSchema = Schema.Union([CreateCanvasAccepted, CreateCanvasRejected]);
export type CreateCanvasResult = typeof CreateCanvasResultSchema.Type;
