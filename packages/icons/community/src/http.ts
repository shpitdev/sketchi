import { Effect, Layer, Schema } from "effect";

import { type ClientLimitNamespace, limitClient } from "./client-limit.js";

import {
	bareCommunitySlug,
	COMMUNITY_ICON_LIMITS,
	communityDiagramSlug,
	type CommunityIcon,
} from "./contracts.js";
import {
	CommunityIconModeration,
	unavailableCommunityModerationLayer,
	workersAiCommunityModerationLayer,
	type CommunityModerationAi,
} from "./moderation.js";
import { publishCommunityIcon } from "./publish.js";
import {
	communityIconStoreLayer,
	CommunityIconStore,
	type CommunityIconDatabase,
} from "./store.js";

/**
 * The HTTP surface of community icons: plain `Request` in, JSON `Response`
 * out, so a Worker route only adds its own headers.
 */
function json(value: unknown, init: ResponseInit = {}): Response {
	return Response.json(value, init);
}

/** Icons one client address may publish a minute. */
export const COMMUNITY_PUBLISHES_PER_CLIENT_MINUTE = 10;

export interface CommunityEnv {
	readonly COMMUNITY_ICONS?: CommunityIconDatabase;
	/** One limit object per client address, counting its publishes. */
	readonly COMMUNITY_CLIENT_LIMIT?: ClientLimitNamespace;
	/** Workers AI: Jev moderates names before they publish. */
	readonly AI?: CommunityModerationAi;
	/** A Worker secret: the bearer token that hides or restores an icon. */
	readonly COMMUNITY_ADMIN_TOKEN?: string;
}

/** A community icon as the API returns it; `slug` is what a diagram's `icon` takes. */
export interface CommunityIconResult {
	readonly slug: string;
	readonly name: string;
	readonly recipe: CommunityIcon["recipe"];
	readonly colors: readonly string[];
	readonly createdAt: string;
	readonly url: string;
	readonly api: string;
}

function errorJson(status: number, code: string, message: string, extra: object = {}) {
	return json({ error: { code, message, ...extra } }, { status });
}

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

function storeLayer(env: CommunityEnv) {
	return env.COMMUNITY_ICONS ? communityIconStoreLayer(env.COMMUNITY_ICONS) : undefined;
}

function storeUnavailable() {
	return errorJson(503, "unavailable", "Community icons are unavailable.");
}

/** Runs a store read and answers 503 when the store cannot be read. */
async function withStore(
	env: CommunityEnv,
	read: Effect.Effect<Response, unknown, CommunityIconStore>,
): Promise<Response> {
	const layer = storeLayer(env);
	if (!layer) return storeUnavailable();
	return Effect.runPromise(
		read.pipe(
			Effect.provide(layer),
			Effect.catch((error) =>
				Effect.logWarning("Community icon read failed", { error }).pipe(
					Effect.as(storeUnavailable()),
				),
			),
		),
	);
}

/**
 * The body, read chunk by chunk and abandoned once it passes `limit`, so a
 * client that sends no Content-Length cannot make the Worker buffer it all.
 */
async function readAtMost(request: Request, limit: number): Promise<Uint8Array | undefined> {
	if (!request.body) return new Uint8Array();
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > limit) {
			await reader.cancel();
			return undefined;
		}
		chunks.push(value);
	}
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

async function readJsonBody(
	request: Request,
): Promise<
	| { readonly ok: true; readonly body: unknown }
	| { readonly ok: false; readonly response: Response }
> {
	const declared = Number(request.headers.get("Content-Length") ?? "0");
	const tooLarge = () => ({
		ok: false as const,
		response: errorJson(
			413,
			"invalid_request",
			`The body must be at most ${COMMUNITY_ICON_LIMITS.maxBodyBytes} bytes.`,
		),
	});
	if (declared > COMMUNITY_ICON_LIMITS.maxBodyBytes) return tooLarge();
	const bytes = await readAtMost(request, COMMUNITY_ICON_LIMITS.maxBodyBytes);
	if (!bytes) return tooLarge();
	try {
		return { ok: true, body: JSON.parse(new TextDecoder().decode(bytes)) as unknown };
	} catch {
		return { ok: false, response: errorJson(400, "invalid_request", "The body must be JSON.") };
	}
}

/** `POST /api/community`: publish a drawn icon. */
export async function handleCommunityPublish(
	request: Request,
	env: CommunityEnv,
	options: { readonly moderation?: Layer.Layer<CommunityIconModeration> } = {},
): Promise<Response> {
	if (env.COMMUNITY_CLIENT_LIMIT) {
		const decision = await limitClient(
			env.COMMUNITY_CLIENT_LIMIT,
			request,
			COMMUNITY_PUBLISHES_PER_CLIENT_MINUTE,
			60_000,
			// A limit object that cannot answer does not stop publishing; moderation still runs.
		).catch(() => ({ allowed: true, retryAfterSeconds: 0 }));
		if (!decision.allowed) {
			const response = errorJson(
				429,
				"rate_limited",
				"Too many icons published; try again in a minute.",
			);
			response.headers.set("Retry-After", String(decision.retryAfterSeconds));
			return response;
		}
	}
	const layer = storeLayer(env);
	if (!layer) return storeUnavailable();
	const parsed = await readJsonBody(request);
	if (!parsed.ok) return parsed.response;
	const moderation =
		options.moderation ??
		(env.AI ? workersAiCommunityModerationLayer(env.AI) : unavailableCommunityModerationLayer);
	const origin = new URL(request.url).origin;
	return Effect.runPromise(
		publishCommunityIcon(parsed.body).pipe(
			Effect.map(({ icon, created }) =>
				json({ ...communityIconResult(icon, origin), created }, { status: created ? 201 : 200 }),
			),
			Effect.catchTags({
				CommunityIconInvalidRequestError: (error) =>
					Effect.succeed(
						errorJson(
							// A drawable recipe whose word would clip is well-formed but unfit to publish.
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
			Effect.provide(Layer.merge(layer, moderation)),
		),
	);
}

/** `GET /api/community?q=&limit=&cursor=`: newest first. */
export function handleCommunityList(request: Request, env: CommunityEnv): Promise<Response> {
	const url = new URL(request.url);
	const query = url.searchParams.get("q")?.trim() ?? "";
	const limit = Number(url.searchParams.get("limit") ?? "");
	const cursor = url.searchParams.get("cursor") ?? "";
	return withStore(
		env,
		Effect.gen(function* () {
			const store = yield* CommunityIconStore;
			const page = yield* store.search({
				...(query ? { query } : {}),
				...(Number.isInteger(limit) && limit > 0 ? { limit } : {}),
				...(cursor ? { cursor } : {}),
			});
			return json(
				{
					query,
					count: page.icons.length,
					results: page.icons.map((icon) => communityIconResult(icon, url.origin)),
					...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
				},
				{ headers: { "Cache-Control": "no-cache" } },
			);
		}),
	);
}

/** `GET /api/community/:slug`, bare or `community/`-prefixed. */
export function handleCommunityDetail(
	request: Request,
	env: CommunityEnv,
	slug: string,
): Promise<Response> {
	const bare = bareCommunitySlug(slug);
	return withStore(
		env,
		Effect.gen(function* () {
			const store = yield* CommunityIconStore;
			const icon = yield* store.get(bare);
			if (!icon) return errorJson(404, "not_found", "Icon not found.", { slug });
			return json(
				{
					...communityIconResult(icon, new URL(request.url).origin),
					...(icon.verdict ? { verdict: icon.verdict } : {}),
				},
				{ headers: { "Cache-Control": "public, max-age=60" } },
			);
		}),
	);
}

/** Compare without leaking how much of the token matched. */
function tokensMatch(given: string, expected: string): boolean {
	const left = new TextEncoder().encode(given);
	const right = new TextEncoder().encode(expected);
	let difference = left.length ^ right.length;
	for (let index = 0; index < right.length; index += 1) {
		difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
	}
	return difference === 0;
}

const VisibilityRequest = Schema.Struct({ hidden: Schema.Boolean });

/** `PATCH /api/community/:slug` with `{ hidden }` and the owner's bearer token. */
export async function handleCommunityVisibility(
	request: Request,
	env: CommunityEnv,
	slug: string,
): Promise<Response> {
	const expected = env.COMMUNITY_ADMIN_TOKEN?.trim();
	const given = /^Bearer\s+(.+)$/iu.exec(request.headers.get("Authorization") ?? "")?.[1]?.trim();
	if (!expected || !given || !tokensMatch(given, expected)) {
		return errorJson(401, "unauthorized", "A valid admin token is required.");
	}
	const parsed = await readJsonBody(request);
	if (!parsed.ok) return parsed.response;
	const body = Schema.decodeUnknownOption(VisibilityRequest)(parsed.body);
	if (body._tag === "None")
		return errorJson(400, "invalid_request", "The body must be { hidden }.");
	const bare = bareCommunitySlug(slug);
	return withStore(
		env,
		Effect.gen(function* () {
			const store = yield* CommunityIconStore;
			const found = yield* store.setHidden(bare, body.value.hidden);
			return found
				? json({ slug: communityDiagramSlug(bare), hidden: body.value.hidden })
				: errorJson(404, "not_found", "Icon not found.", { slug });
		}),
	);
}
