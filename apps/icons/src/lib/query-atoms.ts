import { Cause, Effect, Layer, Schedule, Schema, Stream } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { Atom, AsyncResult } from "effect/reactivity";
import { decodeIconManifest } from "@sketchi/icon-catalog";

import { decodeDrawings, DRAWINGS_PATH } from "./drawings.js";
import { decodePackIcons, packIconsPath } from "./packs.js";

export class IconQueryError extends Schema.TaggedError<
	IconQueryError,
	{ readonly brand: unique symbol }
>()("IconQueryError", {
	message: Schema.String,
	cause: Schema.optionalKey(Schema.Unknown),
}) {}

/** Each Registry owns its transport layer and queries; tests can supply the host Fetch service. */
export const queryHttpLayer = Atom.make<Layer.Layer<HttpClient.HttpClient>>(FetchHttpClient.layer);
export const queryRuntime = Atom.runtime((get) => get(queryHttpLayer));

const loadPublished = Effect.fn("Icons.assets.load")(
	function* <A>(path: string, what: string, decode: (payload: unknown) => A) {
		const client = yield* HttpClient.HttpClient;
		const response = yield* client.get(new URL(path, window.location.origin).href);
		if (response.status < 200 || response.status >= 300)
			return yield* Effect.fail(
				new IconQueryError({ message: `${what} returned HTTP ${response.status}.` }),
			);
		const payload = yield* response.json;
		return yield* Effect.try({
			try: () => decode(payload),
			catch: (cause) =>
				new IconQueryError({
					message: cause instanceof Error ? cause.message : `${what} could not be decoded.`,
					cause,
				}),
		});
	},
	Effect.provideService(FetchHttpClient.RequestInit, { cache: "no-cache" }),
);

const retryOnce = Schedule.spaced("1 second").pipe(Schedule.upTo({ times: 1 }));
export const manifestQuery = queryRuntime
	.atom(loadPublished("/icons-manifest.json", "Icon library", decodeIconManifest))
	.pipe(Atom.setIdleTTL(0), Atom.withServerValueInitial);
export const drawingsQuery = queryRuntime
	.atom((get) =>
		get
			.result(manifestQuery)
			.pipe(
				Effect.andThen(
					loadPublished(DRAWINGS_PATH, "Drawings", decodeDrawings).pipe(Effect.retry(retryOnce)),
				),
			),
	)
	.pipe(Atom.setIdleTTL(0), Atom.withServerValueInitial);
export const packQuery = Atom.family((id: string) =>
	queryRuntime
		.atom(
			loadPublished(packIconsPath(id), "Pack icons", decodePackIcons).pipe(Effect.retry(retryOnce)),
		)
		.pipe(Atom.setIdleTTL(0), Atom.withServerValueInitial),
);

// Community queries revalidate on reconnect, unlike published assets. The stream
// owns its event subscription and removes it when the last query unmounts.
const reconnect = Atom.make(() => Stream.fromEventListener(window, "online")).pipe(
	Atom.withServerValueInitial,
);
export const refreshOnReconnect = Atom.makeRefreshOnSignal(reconnect);
export const browserOrigin = HttpClient.mapRequest((request) =>
	HttpClientRequest.prependUrl(window.location.origin)(request),
);

export function queryError<A, E>(result: AsyncResult.AsyncResult<A, E>, fallback: string): string {
	if (!AsyncResult.isFailure(result)) return fallback;
	const error = Cause.squash(result.cause);
	return error instanceof Error ? error.message : fallback;
}
export function queryStatus<A, E>(
	result: AsyncResult.AsyncResult<A, E>,
): "ready" | "error" | "loading" {
	return AsyncResult.isSuccess(result)
		? "ready"
		: AsyncResult.isFailure(result) && !result.waiting
			? "error"
			: "loading";
}
