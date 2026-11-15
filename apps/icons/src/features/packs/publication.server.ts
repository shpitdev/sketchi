import { type ClientLimitNamespace, clientAddress } from "@sketchi/community-icons";
import { D1Client } from "@effect/sql-d1";
import {
	Array,
	ByteSize,
	Clock,
	Context,
	Effect,
	Layer,
	Option,
	Order,
	Record,
	Schema,
	String,
} from "effect";
import {
	FetchHttpClient,
	HttpClient,
	HttpClientRequest,
	HttpServer,
	HttpServerRequest,
	HttpServerError,
	HttpEffect,
	HttpRouter,
} from "effect/http";
import { HttpApiBuilder, HttpApiMiddleware } from "effect/http-api";
import {
	PackPublicationApi,
	PublicationAdmission,
	PublicationSchemaErrors,
	publicationFailure,
} from "./publication-api.js";
import {
	PublishPayload,
	type PackExcalidrawState,
	PUBLISH_MAX_BODY_BYTES,
	type PublishResult,
	type PullRequestState,
} from "./publication.js";
import {
	findPack,
	isExcalidrawInstallUrl,
	packLibraryPath,
	packPreviewImagePath,
	packVersion,
	type PackSummary,
} from "../../lib/packs.js";

class PublicationReadError extends Schema.TaggedError<
	PublicationReadError,
	{ readonly brand: unique symbol }
>()("PublicationReadError", { message: Schema.String }) {}
export const EXCALIDRAW_LIBRARY_BACKEND =
	"https://us-central1-excalidraw-room-persistence.cloudfunctions.net/libraries";
const GITHUB_API = "https://api.github.com";
const PULL_REQUEST_URL =
	/^https:\/\/github\.com\/excalidraw\/excalidraw-libraries\/pull\/(?<number>[1-9]\d{0,9})$/u;
export const PUBLISHES_PER_CLIENT_HOUR = 3;
export const PULL_REQUEST_RECHECK_MS: Readonly<Record<PullRequestState | "unread", number>> = {
	unread: 600_000,
	open: 600_000,
	closed: 21_600_000,
	merged: Number.POSITIVE_INFINITY,
};
const PULL_REQUESTS_PER_REFRESH = 10;
export interface ExcalidrawPublishEnv {
	readonly ASSETS: {
		fetch(request: Request | URL | string, init?: RequestInit): Promise<Response>;
	};
	readonly COMMUNITY_ICONS?: D1Client.D1ClientConfig["db"];
	readonly COMMUNITY_CLIENT_LIMIT?: ClientLimitNamespace;
	/** Production source configuration is on; previews omit this flag. */
	readonly EXCALIDRAW_LIBRARY_SUBMIT?: string;
	readonly EXCALIDRAW_LIBRARY_BACKEND?: string;
	readonly EXCALIDRAW_LIBRARY_GITHUB_API?: string;
	/** Controlled/local deployments can serve the same trusted collection paths locally. */
	readonly EXCALIDRAW_LIBRARY_RAW_ORIGIN?: string;
}
export const publishingEnabled = (env: ExcalidrawPublishEnv) =>
	env.EXCALIDRAW_LIBRARY_SUBMIT === "on" && env.COMMUNITY_ICONS !== undefined;
const SCHEMA = [
	`CREATE TABLE IF NOT EXISTS excalidraw_library_submissions (
 pack_id TEXT NOT NULL,version TEXT NOT NULL,status TEXT NOT NULL,author_name TEXT NOT NULL,
 pull_request_url TEXT,install_url TEXT,pull_request TEXT,created_at INTEGER NOT NULL,PRIMARY KEY(pack_id,version))`,
	`CREATE TABLE IF NOT EXISTS excalidraw_library_pull_requests (url TEXT PRIMARY KEY,state TEXT,etag TEXT,checked_at INTEGER NOT NULL)`,
];
const State = Schema.Literals(["open", "closed", "merged"]);
const SubmissionRow = Schema.Struct({
	pack_id: Schema.String,
	version: Schema.String,
	status: Schema.Literals(["pending", "unconfirmed", "submitted"]),
	pull_request_url: Schema.NullOr(Schema.String),
	install_url: Schema.NullOr(Schema.String),
	created_at: Schema.Number,
	pull_request_state: Schema.NullOr(State),
	pull_request_checked_at: Schema.NullOr(Schema.Number),
});
export type SubmissionRow = typeof SubmissionRow.Type;
const decodeRows = Schema.decodeUnknownEffect(Schema.Array(SubmissionRow));
const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
export class PublicationRequest extends Context.Service<
	PublicationRequest,
	{ readonly env: ExcalidrawPublishEnv; readonly origin: string }
>()("icons/PackPublicationRequest") {}
const initialize = Effect.gen(function* () {
	const sql = yield* D1Client.D1Client;
	yield* sql.batch(Array.map(SCHEMA, (statement) => sql.unsafe(statement)));
	return sql;
});
const rows = Effect.gen(function* () {
	const sql = yield* D1Client.D1Client;
	return yield* sql`SELECT s.pack_id,s.version,s.status,s.pull_request_url,s.install_url,s.created_at,p.state AS pull_request_state,p.checked_at AS pull_request_checked_at FROM excalidraw_library_submissions s LEFT JOIN excalidraw_library_pull_requests p ON p.url=s.pull_request_url ORDER BY s.created_at DESC`.pipe(
		Effect.flatMap(decodeRows),
	);
});
const hold = Effect.fn("Icons.publication.hold")(function* (
	packId: string,
	version: string,
	detail: string,
) {
	const sql = yield* D1Client.D1Client;
	yield* sql`UPDATE excalidraw_library_submissions SET status='unconfirmed',pull_request=${detail} WHERE pack_id=${packId} AND version=${version} AND status='pending'`.pipe(
		Effect.uninterruptible,
	);
});
const complete = Effect.fn("Icons.publication.complete")(function* (
	packId: string,
	version: string,
	result: PublishResult,
	pullRequest: string,
) {
	const sql = yield* D1Client.D1Client;
	yield* sql`UPDATE excalidraw_library_submissions SET status='submitted',pull_request_url=${result.pullRequestUrl},install_url=${result.installUrl ?? null},pull_request=${pullRequest} WHERE pack_id=${packId} AND version=${version}`.pipe(
		Effect.uninterruptible,
	);
});

function mergedLibraryUrl(installUrl: string): string | undefined {
	const library = URL.parse(URL.parse(installUrl)?.searchParams.get("addLibrary") ?? "");
	if (!library) return undefined;
	const path = String.split("/")(library.pathname);
	if (path.length < 5 || path[4] !== "libraries") return undefined;
	path[3] = "main";
	library.pathname = Array.join(path, "/");
	return library.href;
}
export function mergedInstallUrl(installUrl: string): string | undefined {
	const url = URL.parse(installUrl);
	const library = mergedLibraryUrl(installUrl);
	if (!url || !library) return undefined;
	url.searchParams.set("addLibrary", library);
	return isExcalidrawInstallUrl(url.href) ? url.href : undefined;
}
function reachableInstallUrl(row: SubmissionRow): string | undefined {
	if (!row.install_url || row.pull_request_state === "closed") return undefined;
	return row.pull_request_state === "merged" ? mergedInstallUrl(row.install_url) : row.install_url;
}
export function packExcalidrawStates(
	packs: readonly Pick<PackSummary, "id" | "version">[],
	stored: readonly SubmissionRow[],
	options: { readonly enabled: boolean },
): Record<string, PackExcalidrawState> {
	return Record.fromEntries(
		Array.map(packs, (pack) => {
			const mine = Array.filter(stored, (row) => row.pack_id === pack.id);
			const installUrl = Array.findFirst(
				Array.flatMap(mine, (row) => {
					const url = reachableInstallUrl(row);
					return url ? [url] : [];
				}),
				(url) => Boolean(url),
			);
			const latest = Array.findFirst(mine, (row) => Boolean(row.pull_request_url));
			const confirmed = Option.getOrUndefined(latest);
			const pullRequest = confirmed?.pull_request_url
				? {
						url: confirmed.pull_request_url,
						...(confirmed.pull_request_state ? { state: confirmed.pull_request_state } : {}),
					}
				: undefined;
			return [
				pack.id,
				{
					...(Option.isSome(installUrl) ? { installUrl: installUrl.value } : {}),
					...(pullRequest ? { pullRequest } : {}),
					publishable:
						options.enabled &&
						findPack(pack.id)?.excalidrawListing !== undefined &&
						!Array.some(mine, (row) => row.version === pack.version),
				},
			] as const;
		}),
	);
}
export function installLinkFromPullRequest(body: string): string | undefined {
	const link = /\[Installation link\]\((?<href>[^)\s]+)\)/u.exec(body)?.groups?.["href"];
	return link && isExcalidrawInstallUrl(link) ? link : undefined;
}

/** Scope closure owns headers AND body cancellation; timeout must enclose this scope. */
const readHttp = Effect.fn("Icons.publication.readHttp")(function* (
	request: HttpClientRequest.HttpClientRequest,
	timeout: number,
) {
	const client = (yield* HttpClient.HttpClient).pipe(HttpClient.withScope);
	return yield* Effect.gen(function* () {
		const response = yield* client.execute(request);
		const text = yield* response.text;
		return { status: response.status, headers: response.headers, text };
	}).pipe(Effect.scoped, Effect.timeout(timeout));
});
const safeAnswer = Schema.decodeUnknownOption(
	Schema.Struct({
		url: Schema.optionalKey(Schema.Unknown),
		message: Schema.optionalKey(Schema.Unknown),
	}),
);
const Pull = Schema.Struct({
	body: Schema.optionalKey(Schema.String),
	head: Schema.optionalKey(Schema.Struct({ ref: Schema.optionalKey(Schema.String) })),
	state: Schema.optionalKey(Schema.String),
	merged_at: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
const decodePull = Schema.decodeUnknownEffect(Schema.fromJsonString(Pull));
const pullRequest = Effect.fn("Icons.publication.readPull")(function* (
	env: ExcalidrawPublishEnv,
	number: string,
	timeout: number,
	etag?: string,
) {
	const read = yield* readHttp(
		HttpClientRequest.get(
			`${env.EXCALIDRAW_LIBRARY_GITHUB_API ?? GITHUB_API}/repos/excalidraw/excalidraw-libraries/pulls/${number}`,
			{
				headers: {
					Accept: "application/vnd.github+json",
					"User-Agent": "sketchi-icons",
					...(etag ? { "If-None-Match": etag } : {}),
				},
			},
		),
		timeout,
	);
	if (read.status === 304) return undefined;
	if (read.status < 200 || read.status >= 300)
		return yield* Effect.fail(
			new PublicationReadError({ message: `GitHub answered HTTP ${read.status}.` }),
		);
	return { pull: yield* decodePull(read.text), etag: read.headers.etag };
});
export interface DuePullRequest {
	readonly url: string;
	readonly version: string;
	readonly installUrl?: string;
}
const versionOnMain = Effect.fn("Icons.publication.mainVersion")(
	function* (env: ExcalidrawPublishEnv, library: string, version: string) {
		const url = new URL(library);
		if (env.EXCALIDRAW_LIBRARY_RAW_ORIGIN) {
			const local = new URL(env.EXCALIDRAW_LIBRARY_RAW_ORIGIN);
			url.protocol = local.protocol;
			url.host = local.host;
		}
		const read = yield* readHttp(
			HttpClientRequest.get(url.href, { headers: { "User-Agent": "sketchi-icons" } }),
			8_000,
		);
		if (read.status < 200 || read.status >= 300) return false;
		const json = yield* decodeJson(read.text);
		const text = yield* encodeJson(json);
		return (yield* Effect.promise(() => packVersion(text))) === version;
	},
	Effect.orElseSucceed(() => false),
);
const refreshPullRequests = Effect.fn("Icons.publication.refresh")(function* (
	env: ExcalidrawPublishEnv,
	pulls: readonly DuePullRequest[],
	now: number,
) {
	// Page initialization completed before scheduling; this fresh background client needs no second DDL batch.
	const sql = yield* D1Client.D1Client;
	yield* Effect.forEach(
		pulls,
		Effect.fn("Icons.publication.refreshOne")(
			function* ({ url, version, installUrl }: DuePullRequest) {
				const number = PULL_REQUEST_URL.exec(url)?.groups?.["number"];
				if (!number) return;
				const current =
					yield* sql`SELECT state,etag,checked_at FROM excalidraw_library_pull_requests WHERE url=${url}`.pipe(
						Effect.flatMap(
							Schema.decodeUnknownEffect(
								Schema.Array(
									Schema.Struct({
										state: Schema.NullOr(State),
										etag: Schema.NullOr(Schema.String),
										checked_at: Schema.Number,
									}),
								),
							),
						),
						Effect.map((rows) => rows[0]),
					);
				if (
					current &&
					now - current.checked_at < PULL_REQUEST_RECHECK_MS[current.state ?? "unread"]
				)
					return;
				const claim =
					yield* sql`INSERT INTO excalidraw_library_pull_requests(url,checked_at) VALUES(${url},${now}) ON CONFLICT(url) DO UPDATE SET checked_at=excluded.checked_at WHERE checked_at=${current?.checked_at ?? -1} RETURNING url`.pipe(
						Effect.uninterruptible,
					);
				if (claim.length === 0) return;
				const result = yield* pullRequest(env, number, 5_000, current?.etag ?? undefined).pipe(
					Effect.result,
				);
				let state: PullRequestState | undefined;
				let etag: string | undefined;
				if (result._tag === "Success") {
					if (!result.success) return;
					const pull = result.success.pull;
					state =
						typeof pull.merged_at === "string"
							? "merged"
							: pull.state === "closed"
								? "closed"
								: "open";
					etag = result.success.etag;
				} else {
					const library = installUrl ? mergedLibraryUrl(installUrl) : undefined;
					if (!library || !(yield* versionOnMain(env, library, version)))
						return yield* Effect.logWarning("Excalidraw pull request state not read", {
							url,
							error: result.failure,
						});
					state = "merged";
				}
				yield* sql`UPDATE excalidraw_library_pull_requests SET state=${state},etag=${etag ?? null} WHERE url=${url}`.pipe(
					Effect.uninterruptible,
				);
			},
			Effect.catch((error) =>
				Effect.logWarning("Excalidraw pull request state not read", { error }),
			),
		),
		{ concurrency: 10, discard: true },
	);
});
// Cloudflare waitUntil is the host boundary: refresh has a separate scope and native client.
function scheduleRefresh(
	env: ExcalidrawPublishEnv,
	pulls: readonly DuePullRequest[],
	now: number,
	waitUntil: (promise: Promise<unknown>) => void,
) {
	if (!env.COMMUNITY_ICONS) return;
	waitUntil(
		Effect.runPromise(
			refreshPullRequests(env, pulls, now).pipe(
				// @effect-diagnostics-next-line strictEffectProvide:off -- Cloudflare background entry point owns fresh SQL and HTTP scopes beyond the response.
				Effect.provide(
					Layer.merge(D1Client.layer({ db: env.COMMUNITY_ICONS }), FetchHttpClient.layer),
				),
				Effect.catch((error) => Effect.logWarning("Excalidraw refresh failed", { error })),
			),
		),
	);
}
export const loadPackExcalidrawStates = Effect.fn("Icons.publication.pageStates")(function* (
	env: ExcalidrawPublishEnv,
	packs: readonly Pick<PackSummary, "id" | "version">[],
	options: { readonly waitUntil?: (promise: Promise<unknown>) => void; readonly now?: number } = {},
) {
	if (!env.COMMUNITY_ICONS) return {};
	return yield* Effect.gen(function* () {
		yield* initialize;
		const stored = yield* rows;
		const now = options.now ?? (yield* Clock.currentTimeMillis);
		const due = Array.map(
			Array.take(
				Array.sort(
					Array.filter(
						stored,
						(row) =>
							Boolean(row.pull_request_url) &&
							(row.pull_request_checked_at === null ||
								now - row.pull_request_checked_at >=
									PULL_REQUEST_RECHECK_MS[row.pull_request_state ?? "unread"]),
					),
					Order.mapInput(Order.Number, (row: SubmissionRow) => row.pull_request_checked_at ?? -1),
				),
				PULL_REQUESTS_PER_REFRESH,
			),
			(row) => ({
				url: row.pull_request_url ?? "",
				version: row.version,
				...(row.install_url ? { installUrl: row.install_url } : {}),
			}),
		);
		const waitUntil = options.waitUntil;
		if (due.length && waitUntil)
			yield* Effect.sync(() => scheduleRefresh(env, due, now, waitUntil));
		return packExcalidrawStates(packs, stored, { enabled: publishingEnabled(env) });
	}).pipe(
		// @effect-diagnostics-next-line strictEffectProvide:off -- Page entry point owns its request D1 binding; background work acquires separately.
		Effect.provide(D1Client.layer({ db: env.COMMUNITY_ICONS })),
		Effect.catch((error) =>
			Effect.logWarning("Excalidraw publication state unavailable", { error }).pipe(Effect.as({})),
		),
	);
});
const unconfirmed = () =>
	publicationFailure(
		502,
		"upstream_unconfirmed",
		"Excalidraw's library service did not confirm it. This version is held until it is checked.",
	);
const AdmissionLive = Layer.effect(
	PublicationAdmission,
	Effect.gen(function* () {
		return PublicationAdmission.of((httpEffect) =>
			Effect.gen(function* () {
				const { env } = yield* PublicationRequest;
				const request = yield* HttpServerRequest.HttpServerRequest;
				if (!publishingEnabled(env))
					return yield* Effect.fail(
						publicationFailure(404, "not_found", "Publishing to Excalidraw is off."),
					);
				const params = yield* HttpRouter.params;
				if (!findPack(params.id ?? "")?.excalidrawListing)
					return yield* Effect.fail(
						publicationFailure(404, "not_found", "This pack cannot be published."),
					);
				const namespace = env.COMMUNITY_CLIENT_LIMIT;
				if (namespace) {
					const web = yield* HttpServerRequest.toWeb(request).pipe(Effect.orDie);
					const decision = yield* Effect.tryPromise(() =>
						namespace
							.getByName(`excalidraw-publish:${clientAddress(web)}`)
							.take(PUBLISHES_PER_CLIENT_HOUR, 3_600_000),
					).pipe(Effect.orElseSucceed(() => ({ allowed: true, retryAfterSeconds: 0 })));
					if (!decision.allowed)
						return yield* Effect.fail(
							publicationFailure(
								429,
								"rate_limited",
								"Too many submissions; try again later.",
								decision.retryAfterSeconds,
							),
						);
				}
				return yield* httpEffect.pipe(
					Effect.provideService(
						HttpServerRequest.MaxBodySize,
						ByteSize.bytes(PUBLISH_MAX_BODY_BYTES),
					),
					Effect.catchDefect((cause) =>
						HttpServerError.isHttpServerError(cause) && cause.reason._tag === "RequestParseError"
							? Effect.fail(
									cause.reason.reason === "BodyTooLarge"
										? publicationFailure(
												413,
												"invalid_request",
												`The body must be at most ${PUBLISH_MAX_BODY_BYTES} bytes.`,
											)
										: publicationFailure(400, "invalid_request", "The body must be JSON."),
								)
							: Effect.die(cause),
					),
				);
			}),
		);
	}),
);
const SchemaErrorsLive = HttpApiMiddleware.layerSchemaErrorTransform(
	PublicationSchemaErrors,
	(error) => Effect.fail(publicationFailure(400, "invalid_request", error.cause.message)),
);
const publish = Effect.fn("Icons.publication.publish")(function* (
	packId: string,
	payload: typeof PublishPayload.Type,
) {
	const { env, origin } = yield* PublicationRequest;
	const listing = findPack(packId)?.excalidrawListing;
	const database = env.COMMUNITY_ICONS;
	// Middleware admitted this exact route before native payload decoding.
	if (!listing || !database)
		return yield* Effect.fail(
			publicationFailure(404, "not_found", "This pack cannot be published."),
		);
	const author = {
		authorName: payload.authorName,
		xHandle: payload.xHandle ?? "",
		website: payload.website || `https://icons.sketchi.app/packs/${packId}`,
	};

	return yield* Effect.gen(function* () {
		const sql = yield* initialize;
		const assets = (yield* HttpClient.HttpClient).pipe(
			HttpClient.withScope,
			HttpClient.mapRequest((request) => HttpClientRequest.prependUrl(origin)(request)),
		);
		const readAsset = (path: string) =>
			Effect.gen(function* () {
				const response = yield* assets.get(path);
				if (response.status < 200 || response.status >= 300)
					return yield* Effect.fail(
						new PublicationReadError({ message: `${path} returned HTTP ${response.status}.` }),
					);
				return response;
			});
		const assetFetch: typeof globalThis.fetch = (input, init) =>
			env.ASSETS.fetch(input instanceof Request ? input : new Request(input, init));
		const [library, preview] = yield* Effect.gen(function* () {
			const library = yield* (yield* readAsset(packLibraryPath(packId))).text;
			const preview = yield* (yield* readAsset(packPreviewImagePath(packId))).arrayBuffer;
			return [library, preview] as const;
		}).pipe(Effect.provideService(FetchHttpClient.Fetch, assetFetch), Effect.scoped);
		const version = yield* Effect.promise(() => packVersion(library));
		const claimed =
			yield* sql`INSERT INTO excalidraw_library_submissions(pack_id,version,status,author_name,created_at) VALUES(${packId},${version},'pending',${author.authorName},${yield* Clock.currentTimeMillis}) ON CONFLICT(pack_id,version) DO NOTHING RETURNING pack_id`.pipe(
				Effect.uninterruptible,
			);
		if (claimed.length === 0)
			return yield* Effect.fail(
				publicationFailure(
					409,
					"already_submitted",
					"This version of the pack has already been sent to Excalidraw.",
				),
			);
		const form = new FormData();
		const parsed = yield* decodeJson(library);
		const pretty = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown, { space: 2 }))(
			parsed,
		);
		form.append("excalidrawLib", new Blob([pretty], { type: "application/json" }));
		form.append("previewImage", new File([preview], "preview", { type: "image/jpeg" }));
		form.append("previewImageType", "image/jpeg");
		form.append("title", listing.name);
		form.append("authorName", author.authorName);
		form.append("githubHandle", "");
		form.append("name", listing.name);
		form.append("description", listing.description);
		form.append("twitterHandle", author.xHandle);
		form.append("website", author.website);
		const outcome = Effect.gen(function* () {
			const sent = yield* readHttp(
				HttpClientRequest.post(
					`${env.EXCALIDRAW_LIBRARY_BACKEND ?? EXCALIDRAW_LIBRARY_BACKEND}/submit`,
				).pipe(HttpClientRequest.bodyFormData(form)),
				30_000,
			).pipe(Effect.result);
			if (sent._tag === "Failure") {
				const detail = yield* encodeJson({ error: globalThis.String(sent.failure) });
				yield* hold(packId, version, detail);
				yield* Effect.logWarning("Excalidraw library submission unconfirmed", {
					packId,
					version,
					detail,
				});
				return yield* Effect.fail(unconfirmed());
			}
			const read = sent.success;
			const decoded = yield* decodeJson(read.text).pipe(Effect.option);
			const answer = Option.isSome(decoded) ? safeAnswer(decoded.value) : Option.none();
			const parsedAnswer = Option.getOrUndefined(answer);
			const pr =
				typeof parsedAnswer?.url === "string" && PULL_REQUEST_URL.test(parsedAnswer.url)
					? parsedAnswer.url
					: undefined;
			const detail = yield* encodeJson({
				status: read.status,
				body: String.slice(0, 2000)(read.text),
			});
			if (!pr) {
				if (read.status >= 400 && read.status < 500) {
					yield* sql`DELETE FROM excalidraw_library_submissions WHERE pack_id=${packId} AND version=${version} AND status='pending'`.pipe(
						Effect.uninterruptible,
					);
					return yield* Effect.fail(
						publicationFailure(
							502,
							"upstream_refused",
							typeof parsedAnswer?.message === "string"
								? `Excalidraw's library service refused it: ${parsedAnswer.message}`
								: "Excalidraw's library service refused it.",
						),
					);
				}
				yield* hold(packId, version, detail);
				return yield* Effect.fail(unconfirmed());
			}
			// Trusted PR evidence takes precedence over a contradictory status, and is recorded before lookup.
			const confirmed = { pullRequestUrl: pr };
			yield* complete(packId, version, confirmed, detail).pipe(
				Effect.catch((error) =>
					Effect.logError("Excalidraw library submission not recorded", {
						packId,
						version,
						...confirmed,
						error,
					}),
				),
			);
			const lookup = yield* pullRequest(
				env,
				PULL_REQUEST_URL.exec(pr)?.groups?.["number"] ?? "",
				8_000,
			).pipe(Effect.result);
			const installUrl =
				lookup._tag === "Success" && lookup.success
					? installLinkFromPullRequest(lookup.success.pull.body ?? "")
					: undefined;
			const pullDetail = yield* encodeJson(
				lookup._tag === "Success" && lookup.success
					? {
							...(lookup.success.pull.head?.ref ? { branch: lookup.success.pull.head.ref } : {}),
							body: String.slice(0, 4000)(lookup.success.pull.body ?? ""),
						}
					: {
							error: globalThis.String(
								lookup._tag === "Failure" ? lookup.failure : "No pull request body",
							),
						},
			);
			const result: PublishResult = { pullRequestUrl: pr, ...(installUrl ? { installUrl } : {}) };
			yield* complete(packId, version, result, pullDetail).pipe(
				Effect.catch((error) =>
					Effect.logError("Excalidraw library submission not recorded", {
						packId,
						version,
						...result,
						pullDetail,
						error,
					}),
				),
			);
			return result;
		});
		return yield* outcome.pipe(
			Effect.onInterrupt(() =>
				hold(packId, version, "Interrupted after version claim; submission outcome unknown.").pipe(
					Effect.catch((error) =>
						Effect.logError("Excalidraw interrupted claim remains pending", {
							packId,
							version,
							error,
						}),
					),
				),
			),
		);
	}).pipe(
		// @effect-diagnostics-next-line strictEffectProvide:off -- Publication HTTP entry point owns request-bound D1 and HTTP lifetimes.
		Effect.provide(Layer.merge(D1Client.layer({ db: database }), FetchHttpClient.layer)),
	);
});
const handlers = HttpApiBuilder.group(PackPublicationApi, "packs", (handlers) =>
	handlers.handle("publish", ({ params, payload }) =>
		publish(params.id, payload).pipe(
			Effect.catch((error) =>
				"body" in error
					? Effect.fail(error)
					: Effect.logError("Excalidraw publication failed", { error }).pipe(
							Effect.andThen(
								Effect.fail(
									publicationFailure(
										500,
										"unavailable",
										"Publishing is unavailable; try again later.",
									),
								),
							),
						),
			),
		),
	),
);
const publicationHttp = HttpRouter.toHttpEffect(
	HttpApiBuilder.layer(PackPublicationApi).pipe(
		Layer.provide(handlers.pipe(Layer.provide(Layer.merge(AdmissionLive, SchemaErrorsLive)))),
		Layer.provide(HttpServer.layerServices),
	),
).pipe(Effect.flatten);
const handler = HttpEffect.toWebHandlerWith<never, Effect.Services<typeof publicationHttp>>(
	Context.empty(),
)(publicationHttp);
/** The TanStack route hands request-owned bindings to the native HttpApi runtime. */
export const handlePackPublish = (request: Request, env: ExcalidrawPublishEnv) =>
	handler(request, Context.make(PublicationRequest, { env, origin: new URL(request.url).origin }));
