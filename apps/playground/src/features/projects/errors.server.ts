import { Schema } from "effect";

const StudioResourceKind = Schema.Literals([
	"diagram",
	"owner-index",
	"project",
	"session",
	"source-artifact",
]);

export type StudioResourceKind = typeof StudioResourceKind.Type;

export class StudioNotFoundError extends Schema.TaggedError<
	StudioNotFoundError,
	{ readonly brand: unique symbol }
>()("StudioNotFoundError", {
	id: Schema.String,
	resource: StudioResourceKind,
}) {}

export class StudioDecodeError extends Schema.TaggedError<
	StudioDecodeError,
	{ readonly brand: unique symbol }
>()("StudioDecodeError", {
	cause: Schema.Defect(),
	key: Schema.String,
	message: Schema.String,
	operation: Schema.Literals(["decode", "encode"]),
}) {}

export class StudioSessionError extends Schema.TaggedError<
	StudioSessionError,
	{ readonly brand: unique symbol }
>()("StudioSessionError", {
	cause: Schema.Defect(),
	message: Schema.String,
}) {}

export class StudioOwnershipError extends Schema.TaggedError<
	StudioOwnershipError,
	{ readonly brand: unique symbol }
>()("StudioOwnershipError", {
	id: Schema.String,
	resource: StudioResourceKind,
}) {}

export class StudioStorageError extends Schema.TaggedError<
	StudioStorageError,
	{ readonly brand: unique symbol }
>()("StudioStorageError", {
	cause: Schema.Defect(),
	message: Schema.String,
	operation: Schema.Literals(["delete", "get", "head", "list", "put"]),
	target: Schema.String,
}) {}

export class StudioSourceArtifactError extends Schema.TaggedError<
	StudioSourceArtifactError,
	{ readonly brand: unique symbol }
>()("StudioSourceArtifactError", {
	artifactId: Schema.String,
	cause: Schema.optionalKey(Schema.Defect()),
	code: Schema.String,
	message: Schema.String,
	status: Schema.Number,
}) {}

export class StudioInvalidInputError extends Schema.TaggedError<
	StudioInvalidInputError,
	{ readonly brand: unique symbol }
>()("StudioInvalidInputError", {
	cause: Schema.optionalKey(Schema.Defect()),
	message: Schema.String,
}) {}

export type StudioPersistenceError =
	| StudioDecodeError
	| StudioNotFoundError
	| StudioOwnershipError
	| StudioStorageError;

export type StudioProjectsError = StudioPersistenceError | StudioSourceArtifactError;

export type StudioHttpError = StudioInvalidInputError | StudioProjectsError | StudioSessionError;

export function failureMessage(cause: unknown, fallback: string): string {
	return cause instanceof Error ? cause.message : fallback;
}
