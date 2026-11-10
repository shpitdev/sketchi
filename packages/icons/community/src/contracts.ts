import { COMMUNITY_ICON_SLUG_PREFIX, type IconRecipe } from "@sketchi/diagram-core";
import { Schema } from "effect";

import { COMMUNITY_ICON_NAME_MAX_LENGTH } from "./recipe.js";

/** What a judge said about a drawing before it was published. */
export const CommunityIconVerdict = Schema.Struct({
	recognizable: Schema.Boolean,
	score: Schema.optionalKey(Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 }))),
	reason: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(280))),
	judge: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(64))),
});
export interface CommunityIconVerdict extends Schema.Schema.Type<typeof CommunityIconVerdict> {}

/**
 * `POST /api/community`. The recipe is checked by the shared recipe checker
 * after decoding, so its issues read the same as everywhere else recipes go.
 */
export const PublishCommunityIconRequest = Schema.Struct({
	name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
	recipe: Schema.Unknown,
	verdict: Schema.optionalKey(CommunityIconVerdict),
});
export interface PublishCommunityIconRequest extends Schema.Schema.Type<
	typeof PublishCommunityIconRequest
> {}

/** One published icon. `slug` is bare; diagrams name it with the community prefix. */
export interface CommunityIcon {
	readonly slug: string;
	readonly name: string;
	readonly recipe: IconRecipe;
	/** Fixed colors the recipe draws in, sorted. */
	readonly colors: readonly string[];
	/** ISO timestamp. */
	readonly createdAt: string;
	readonly hash: string;
	readonly verdict?: CommunityIconVerdict;
}

export const COMMUNITY_ICON_LIMITS = Object.freeze({
	/** The largest publish body the API reads. */
	maxBodyBytes: 8 * 1024,
	maxNameLength: COMMUNITY_ICON_NAME_MAX_LENGTH,
	defaultPageSize: 60,
	maxPageSize: 100,
	/** The most community icons one diagram resolves. */
	maxPerDiagram: 24,
});

/** The slug a diagram uses for a community icon: `community/<slug>`. */
export function communityDiagramSlug(slug: string): string {
	return `${COMMUNITY_ICON_SLUG_PREFIX}${slug}`;
}

/** The bare slug of `community/<slug>`, or of a bare slug. */
export function bareCommunitySlug(slug: string): string {
	return slug.startsWith(COMMUNITY_ICON_SLUG_PREFIX)
		? slug.slice(COMMUNITY_ICON_SLUG_PREFIX.length)
		: slug;
}

export class CommunityIconInvalidRequestError extends Schema.TaggedError<CommunityIconInvalidRequestError>()(
	"CommunityIconInvalidRequestError",
	{
		/** `recipe_clips`: drawable, but a word is too large for the icon and would be cut off. */
		code: Schema.Literals(["invalid_request", "invalid_recipe", "recipe_clips"]),
		message: Schema.String,
		issues: Schema.Array(Schema.String),
	},
) {}

/** Moderation found the name or the recipe's words unfit to publish, or the owner hid the icon. */
export class CommunityIconRejectedError extends Schema.TaggedError<CommunityIconRejectedError>()(
	"CommunityIconRejectedError",
	{ message: Schema.String },
) {}

export class CommunityIconModerationUnavailableError extends Schema.TaggedError<CommunityIconModerationUnavailableError>()(
	"CommunityIconModerationUnavailableError",
	{ cause: Schema.Defect(), message: Schema.String },
) {}

export class CommunityIconStorageError extends Schema.TaggedError<CommunityIconStorageError>()(
	"CommunityIconStorageError",
	{
		cause: Schema.Defect(),
		message: Schema.String,
		operation: Schema.Literals(["read", "write", "schema"]),
	},
) {}
