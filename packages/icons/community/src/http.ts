import { D1Client } from "@effect/sql-d1";
import { Array, ByteSize, Context, Effect, Layer, Schema, String } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";

import { type ClientLimitNamespace, limitClient } from "./client-limit";
import {
	bareCommunitySlug,
	COMMUNITY_ICON_LIMITS,
	communityDiagramSlug,
	type CommunityIcon,
	type CommunityIconStorageError,
} from "./contracts";
import {
	CommunityDetail,
	CommunityHttpApi,
	CommunityHttpError,
	CommunityIconResult,
	CommunityPage,
	CommunityPublished,
	CommunityVisibilityRequest,
} from "./http-api";
import {
	CommunityIconModeration,
	unavailableCommunityModerationLayer,
	workersAiCommunityModerationLayer,
	type CommunityModerationAi,
} from "./moderation";
import { publishCommunityIcon } from "./publish";
import { communityIconStoreLayer, CommunityIconStore } from "./store";

export const COMMUNITY_PUBLISHES_PER_CLIENT_MINUTE = 10;
export interface CommunityEnv {
	readonly COMMUNITY_ICONS?: D1Client.D1ClientConfig["db"];
	readonly COMMUNITY_CLIENT_LIMIT?: ClientLimitNamespace;
	readonly AI?: CommunityModerationAi;
	readonly COMMUNITY_ADMIN_TOKEN?: string;
}

/** Supplied separately for each HTTP request, never during shared layer construction. */
export class CommunityHttpRequest extends Context.Service<
	CommunityHttpRequest,
	{
		readonly env: CommunityEnv;
		readonly origin: string;
		readonly moderation?: Layer.Layer<CommunityIconModeration>;
	}
>()("sketchi/CommunityHttpRequest") {}

export function communityIconResult(icon: CommunityIcon, origin: string): CommunityIconResult {
	const slug = encodeURIComponent(icon.slug);
	return {
		slug: communityDiagramSlug(icon.slug),
		name: icon.name,
		recipe: icon.recipe,
		colors: icon.colors,
		createdAt: icon.createdAt,
		url: new URL(`/community/${slug}`, origin).href,
		api: new URL(`/api/community/${slug}`, origin).href,
	};
}

function errorJson(
	status: number,
	code: typeof CommunityHttpError.Type.error.code,
	message: string,
	extra: { readonly issues?: readonly string[]; readonly slug?: string } = {},
) {
	return HttpServerResponse.jsonUnsafe(
		{ error: { code, message, ...extra } } satisfies typeof CommunityHttpError.Type,
		{ status },
	);
}
const storeUnavailable = () => errorJson(503, "unavailable", "Community icons are unavailable.");

const withStore = Effect.fn("CommunityHttp.withStore")(function* (
	read: Effect.Effect<
		HttpServerResponse.HttpServerResponse,
		CommunityIconStorageError,
		CommunityIconStore
	>,
) {
	const { env } = yield* CommunityHttpRequest;
	if (!env.COMMUNITY_ICONS) return storeUnavailable();
	return yield* read.pipe(
		// @effect-diagnostics-next-line strictEffectProvide:off -- This HTTP entry point owns the request-bound D1 layer; bindings cannot enter the shared module layer.
		Effect.provide(communityIconStoreLayer(env.COMMUNITY_ICONS)),
		Effect.catch((error) =>
			Effect.logWarning("Community icon read failed", { error }).pipe(
				Effect.as(storeUnavailable()),
			),
		),
	);
});

/** Preserve pre-decode status decisions and the bounded read for chunked bodies. */
const readJsonBody = Effect.fn("CommunityHttp.readBody")(function* () {
	const request = yield* HttpServerRequest.HttpServerRequest;
	const text = yield* request.text.pipe(
		Effect.provideService(
			HttpServerRequest.MaxBodySize,
			ByteSize.bytes(COMMUNITY_ICON_LIMITS.maxBodyBytes),
		),
		Effect.result,
	);
	if (text._tag === "Failure") {
		const error = text.failure;
		return {
			ok: false as const,
			response:
				error.reason._tag === "RequestParseError" && error.reason.reason === "BodyTooLarge"
					? errorJson(
							413,
							"invalid_request",
							`The body must be at most ${COMMUNITY_ICON_LIMITS.maxBodyBytes} bytes.`,
						)
					: errorJson(400, "invalid_request", "The body must be JSON."),
		};
	}
	yield* Effect.annotateCurrentSpan("http.request.body", text.success);
	const parsed = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))(
		text.success,
	).pipe(Effect.result);
	return parsed._tag === "Success"
		? { ok: true as const, body: parsed.success }
		: { ok: false as const, response: errorJson(400, "invalid_request", "The body must be JSON.") };
});

const publish = Effect.fn("CommunityHttp.publish")(function* () {
	const { env, origin, moderation: override } = yield* CommunityHttpRequest;
	if (env.COMMUNITY_CLIENT_LIMIT) {
		const request = yield* HttpServerRequest.HttpServerRequest;
		const webRequest = yield* HttpServerRequest.toWeb(request).pipe(Effect.orDie);
		const namespace = env.COMMUNITY_CLIENT_LIMIT;
		// The existing limiter is fail-open when its Durable Object cannot answer.
		const decision = yield* Effect.tryPromise(() =>
			limitClient(namespace, webRequest, COMMUNITY_PUBLISHES_PER_CLIENT_MINUTE, 60_000),
		).pipe(Effect.orElseSucceed(() => ({ allowed: true, retryAfterSeconds: 0 })));
		if (!decision.allowed)
			return errorJson(
				429,
				"rate_limited",
				"Too many icons published; try again in a minute.",
			).pipe(HttpServerResponse.setHeader("Retry-After", `${decision.retryAfterSeconds}`));
	}
	if (!env.COMMUNITY_ICONS) return storeUnavailable();
	const parsed = yield* readJsonBody();
	if (!parsed.ok) return parsed.response;
	const moderation =
		override ??
		(env.AI ? workersAiCommunityModerationLayer(env.AI) : unavailableCommunityModerationLayer);
	return yield* publishCommunityIcon(parsed.body).pipe(
		Effect.flatMap(({ icon, created }) =>
			HttpServerResponse.schemaJson(CommunityPublished)(
				{ ...communityIconResult(icon, origin), created },
				{ status: created ? 201 : 200 },
			).pipe(Effect.orDie),
		),
		// @effect-diagnostics-next-line strictEffectProvide:off -- This publish entry point scopes the actual request D1 and moderation bindings together.
		Effect.provide(Layer.merge(communityIconStoreLayer(env.COMMUNITY_ICONS), moderation)),
		Effect.catchTags({
			CommunityIconInvalidRequestError: (error) =>
				Effect.succeed(
					errorJson(
						error.code === "recipe_clips" ? 422 : 400,
						error.code,
						error.message,
						error.issues.length ? { issues: error.issues } : {},
					),
				),
			CommunityIconRejectedError: (error) =>
				Effect.succeed(errorJson(422, "rejected", error.message)),
			CommunityIconModerationUnavailableError: (error) =>
				Effect.logWarning("Community icon moderation unavailable", { cause: error.cause }).pipe(
					Effect.as(errorJson(503, "unavailable", "Publishing is unavailable; try again later.")),
				),
			CommunityIconStorageError: (error) =>
				Effect.logWarning("Community icon write failed", { cause: error.cause }).pipe(
					Effect.as(storeUnavailable()),
				),
		}),
	);
});

const list = Effect.fn("CommunityHttp.list")(function* (queryInput: {
	readonly q?: string;
	readonly limit?: string;
	readonly cursor?: string;
}) {
	const { origin } = yield* CommunityHttpRequest;
	const query = String.trim(queryInput.q ?? "");
	const limit = Number(queryInput.limit ?? "");
	const cursor = queryInput.cursor ?? "";
	return yield* withStore(
		Effect.gen(function* () {
			const store = yield* CommunityIconStore;
			const page = yield* store.search({
				...(query ? { query } : {}),
				...(Number.isInteger(limit) && limit > 0 ? { limit } : {}),
				...(cursor ? { cursor } : {}),
			});
			return yield* HttpServerResponse.schemaJson(CommunityPage)(
				{
					query,
					count: page.icons.length,
					results: Array.map(page.icons, (icon) => communityIconResult(icon, origin)),
					...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
				},
				{ headers: { "Cache-Control": "no-cache" } },
			).pipe(Effect.orDie);
		}),
	);
});

const detail = Effect.fn("CommunityHttp.detail")(function* (slug: string) {
	const { origin } = yield* CommunityHttpRequest;
	return yield* withStore(
		Effect.gen(function* () {
			const store = yield* CommunityIconStore;
			const icon = yield* store.get(bareCommunitySlug(slug));
			if (!icon) return errorJson(404, "not_found", "Icon not found.", { slug });
			return yield* HttpServerResponse.schemaJson(CommunityDetail)(
				{
					...communityIconResult(icon, origin),
					...(icon.verdict ? { verdict: icon.verdict } : {}),
				},
				{ headers: { "Cache-Control": "public, max-age=60" } },
			).pipe(Effect.orDie);
		}),
	);
});

/** Compare without leaking how much of the token matched. */
function tokensMatch(given: string, expected: string): boolean {
	const left = new TextEncoder().encode(given);
	const right = new TextEncoder().encode(expected);
	let difference = left.length ^ right.length;
	for (let index = 0; index < right.length; index += 1)
		difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
	return difference === 0;
}

const visibility = Effect.fn("CommunityHttp.visibility")(function* (slug: string) {
	const { env } = yield* CommunityHttpRequest;
	const request = yield* HttpServerRequest.HttpServerRequest;
	const expected = String.trim(env.COMMUNITY_ADMIN_TOKEN ?? "");
	const given = String.trim(
		/^Bearer\s+(.+)$/iu.exec(request.headers.authorization ?? "")?.[1] ?? "",
	);
	if (!expected || !given || !tokensMatch(given, expected))
		return errorJson(401, "unauthorized", "A valid admin token is required.");
	const parsed = yield* readJsonBody();
	if (!parsed.ok) return parsed.response;
	const body = yield* Schema.decodeUnknownEffect(CommunityVisibilityRequest)(parsed.body).pipe(
		Effect.result,
	);
	if (body._tag === "Failure")
		return errorJson(400, "invalid_request", "The body must be { hidden }.");
	const bare = bareCommunitySlug(slug);
	return yield* withStore(
		Effect.gen(function* () {
			const store = yield* CommunityIconStore;
			const found = yield* store.setHidden(bare, body.success.hidden);
			return found
				? HttpServerResponse.jsonUnsafe({
						slug: communityDiagramSlug(bare),
						hidden: body.success.hidden,
					})
				: errorJson(404, "not_found", "Icon not found.", { slug });
		}),
	);
});

export const CommunityHttpHandlers = HttpApiBuilder.group(
	CommunityHttpApi,
	"community",
	(handlers) =>
		handlers
			.handle("list", ({ query }) => list(query))
			.handle("detail", ({ params }) => detail(params.slug))
			// Quota/store/auth decisions precede decoding, with the existing public error envelopes.
			.handleRaw("publish", () => publish())
			.handleRaw("visibility", ({ params }) => visibility(params.slug)),
);
