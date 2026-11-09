import { Context, Effect, Layer, Schema } from "effect";

import { CommunityIconModerationUnavailableError } from "./contracts.js";

/** Jev on Workers AI: billed and logged through the account, no key needed. */
export const COMMUNITY_MODERATION_MODEL = "typesafe/jev";

/** Jev's noul at or above which a name is kept out of the gallery. */
export const COMMUNITY_MODERATION_THRESHOLD = 0.5;

export interface CommunityIconModerationInput {
	readonly name: string;
	/** The words the recipe writes. */
	readonly words: readonly string[];
}

export interface CommunityIconModerationShape {
	/** Whether a name and the recipe's words may appear in a public gallery. */
	readonly review: (
		input: CommunityIconModerationInput,
	) => Effect.Effect<{ readonly allowed: boolean }, CommunityIconModerationUnavailableError>;
}

export class CommunityIconModeration extends Context.Service<
	CommunityIconModeration,
	CommunityIconModerationShape
>()("@sketchi/community-icons/CommunityIconModeration") {}

/** The slice of a Workers AI binding moderation uses. */
export interface CommunityModerationAi {
	run(model: string, input: unknown): Promise<unknown>;
}

/** The one question Jev answers about every publish. */
export const UNFIT_QUESTION = {
	type: "noul",
	instructions:
		"Would `name` or any of `words`, the label and text of a small icon in a public icon gallery, be unfit to show there?",
	criteria: {
		true: "It is a slur, hateful, sexual, violent, harassing, names or insults a private person, or advertises something, such as a link or contact details.",
		false:
			"It is an ordinary name for a thing, a product, a brand, a concept or a short label, even a blunt or informal one.",
	},
} as const;

const JevResponse = Schema.Struct({
	answers: Schema.Struct({
		unfit: Schema.Struct({ type: Schema.Literal("noul"), noul: Schema.Finite }),
	}),
});
const decodeJevResponse = Schema.decodeUnknownEffect(JevResponse);

/** The binding wraps Jev's answer as `{ state, result }`; the documented shape is bare. */
function jevResult(response: unknown): unknown {
	return typeof response === "object" && response !== null && "result" in response
		? response.result
		: response;
}

const unavailable = (cause: unknown) =>
	CommunityIconModerationUnavailableError.make({ cause, message: "Moderation is unavailable." });

/** Moderation by one Jev question on Workers AI, cut off after `timeoutMs`. */
export function workersAiCommunityModeration(
	ai: CommunityModerationAi,
	options: { readonly timeoutMs?: number } = {},
): CommunityIconModerationShape {
	const timeoutMs = options.timeoutMs ?? 4_000;
	return {
		review: Effect.fn("communityIcons.moderation.review")(function* (
			input: CommunityIconModerationInput,
		) {
			const response = yield* Effect.tryPromise({
				try: () =>
					ai.run(COMMUNITY_MODERATION_MODEL, {
						state: { name: input.name, words: [...input.words] },
						questions: { unfit: UNFIT_QUESTION },
					}),
				catch: unavailable,
			}).pipe(
				Effect.timeoutOrElse({
					duration: timeoutMs,
					orElse: () =>
						Effect.fail(unavailable(new Error(`Jev did not answer within ${timeoutMs} ms.`))),
				}),
			);
			const decoded = yield* decodeJevResponse(jevResult(response)).pipe(
				Effect.mapError(unavailable),
			);
			const unfit = decoded.answers.unfit.noul;
			yield* Effect.annotateCurrentSpan("sketchi.community_icons.unfit", unfit);
			return { allowed: unfit < COMMUNITY_MODERATION_THRESHOLD };
		}),
	};
}

export const workersAiCommunityModerationLayer = (
	ai: CommunityModerationAi,
	options: { readonly timeoutMs?: number } = {},
): Layer.Layer<CommunityIconModeration> =>
	Layer.succeed(CommunityIconModeration, workersAiCommunityModeration(ai, options));

/** Without a moderator, nothing publishes: every review reports moderation unavailable. */
export const unavailableCommunityModerationLayer: Layer.Layer<CommunityIconModeration> =
	Layer.succeed(
		CommunityIconModeration,
		CommunityIconModeration.of({
			review: () => Effect.fail(unavailable(new Error("No Workers AI binding is configured."))),
		}),
	);
