import { iconRecipeIssues, isIconRecipe } from "@sketchi/diagram-core";
import { Effect, Schema } from "effect";

import {
	COMMUNITY_ICON_LIMITS,
	CommunityIconInvalidRequestError,
	CommunityIconRejectedError,
	PublishCommunityIconRequest,
	type CommunityIcon,
} from "./contracts.js";
import { CommunityIconModeration } from "./moderation.js";
import { cleanCommunityIconName, communityIconHash, communityIconWords } from "./recipe.js";
import { CommunityIconStore } from "./store.js";

const decodeRequest = Schema.decodeUnknownEffect(PublishCommunityIconRequest);

const removed = () =>
	CommunityIconRejectedError.make({ message: "This icon was removed from the gallery." });

/**
 * Publish a drawn icon: check the request and recipe, return the icon already
 * published with the same recipe, otherwise moderate the name and the
 * recipe's words and store it.
 */
export const publishCommunityIcon = Effect.fn("communityIcons.publish")(function* (body: unknown) {
	const request = yield* decodeRequest(body).pipe(
		Effect.mapError((error) =>
			CommunityIconInvalidRequestError.make({
				code: "invalid_request",
				message: "The body must be { name, recipe, verdict? }.",
				issues: [error.message],
			}),
		),
	);
	const name = cleanCommunityIconName(request.name);
	if (!/[\p{L}\p{N}]/u.test(name) || name.length > COMMUNITY_ICON_LIMITS.maxNameLength) {
		return yield* CommunityIconInvalidRequestError.make({
			code: "invalid_request",
			message: `name must be 1-${COMMUNITY_ICON_LIMITS.maxNameLength} characters with a letter or digit.`,
			issues: [],
		});
	}
	const recipe = request.recipe;
	if (!isIconRecipe(recipe)) {
		return yield* CommunityIconInvalidRequestError.make({
			code: "invalid_recipe",
			message: "The recipe cannot be drawn.",
			issues: iconRecipeIssues(recipe),
		});
	}
	const hash = yield* Effect.promise(() => communityIconHash(recipe));
	const store = yield* CommunityIconStore;
	const existing = yield* store.findByHash(hash);
	if (existing) {
		if (existing.hidden) return yield* removed();
		return { icon: existing.icon, created: false };
	}
	const moderation = yield* CommunityIconModeration;
	const review = yield* moderation.review({ name, words: communityIconWords(recipe) });
	if (!review.allowed) {
		return yield* CommunityIconRejectedError.make({
			message: "The name or the icon's text cannot be published.",
		});
	}
	const stored = yield* store.insert({
		name,
		recipe,
		hash,
		...(request.verdict ? { verdict: request.verdict } : {}),
	});
	if (stored.hidden) return yield* removed();
	return { icon: stored.icon, created: stored.created } satisfies {
		readonly icon: CommunityIcon;
		readonly created: boolean;
	};
});
