import { Schema } from "effect";

/** The caller sent something the service cannot draw from. */
export class IconInputError extends Schema.TaggedError<IconInputError>()("IconInputError", {
	code: Schema.String,
	message: Schema.String,
	hint: Schema.String,
}) {}

/** A model call failed: the gateway, the upstream provider, or an unreadable reply. */
export class IconModelError extends Schema.TaggedError<IconModelError>()("IconModelError", {
	cause: Schema.Defect(),
	message: Schema.String,
	model: Schema.String,
	role: Schema.Literals(["author", "judge"]),
	retryable: Schema.Boolean,
	status: Schema.optional(Schema.Number),
}) {}

/** The browser could not decode, measure or export an image. */
export class IconImagingError extends Schema.TaggedError<IconImagingError>()("IconImagingError", {
	cause: Schema.Defect(),
	message: Schema.String,
	stage: Schema.Literals(["prepare", "export"]),
}) {}

/** No round produced a recipe that passes the checker. */
export class IconRecipeError extends Schema.TaggedError<IconRecipeError>()("IconRecipeError", {
	issues: Schema.Array(Schema.String),
	message: Schema.String,
}) {}

/** The draw used up its time budget before it had a drawing to return. */
export class IconTimeoutError extends Schema.TaggedError<IconTimeoutError>()("IconTimeoutError", {
	message: Schema.String,
	stage: Schema.Literals(["source", "lineup", "author", "render", "judge"]),
}) {}

export type IconDrawError =
	| IconInputError
	| IconModelError
	| IconImagingError
	| IconRecipeError
	| IconTimeoutError;
