import "@tanstack/react-start/server-only";
import { env, waitUntil } from "cloudflare:workers";
import { Cache, Context, Effect, Exit, Layer, ManagedRuntime, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { decodePackIndex, PACK_INDEX_PATH, type PackSummary } from "./packs";
import { loadPackExcalidrawStates } from "./publication.server";

class PackIndexError extends Schema.TaggedError<
	PackIndexError,
	{ readonly brand: unique symbol }
>()("PackIndexError", {
	message: Schema.String,
	cause: Schema.optionalKey(Schema.Defect()),
}) {}
const readIndex = Effect.fn("Icons.packs.index")(
	function* (origin: string) {
		const client = (yield* HttpClient.HttpClient).pipe(HttpClient.withScope);
		const response = yield* client.execute(
			HttpClientRequest.get(new URL(PACK_INDEX_PATH, origin).href),
		);
		if (response.status < 200 || response.status >= 300)
			return yield* Effect.fail(
				new PackIndexError({ message: `Pack index returned HTTP ${response.status}.` }),
			);
		const payload = yield* response.json;
		return yield* Effect.try({
			try: () => decodePackIndex(payload),
			catch: (cause) => new PackIndexError({ message: "Pack index could not be decoded.", cause }),
		});
	},
	Effect.scoped,
	Effect.provideService(FetchHttpClient.Fetch, (input, init) =>
		env.ASSETS.fetch(input instanceof Request ? input : new Request(input, init)),
	),
	// @effect-diagnostics-next-line strictEffectProvide:off -- Static asset loader is the ASSETS binding HTTP entry point.
	Effect.provide(FetchHttpClient.layer),
);
class PackIndex extends Context.Service<
	PackIndex,
	Cache.Cache<string, PackSummary[], Effect.Error<ReturnType<typeof readIndex>>>
>()("icons/PackIndex") {}
// Build-owned immutable asset metadata. No D1, publication state, request or origin URLs are cached.
const runtime = ManagedRuntime.make(
	Layer.effect(
		PackIndex,
		Cache.makeWith(readIndex, {
			capacity: 8,
			timeToLive: (exit) => (Exit.isSuccess(exit) ? Infinity : 0),
		}),
	),
);
export const loadPackShelf = (origin: string) =>
	runtime.runPromise(
		Effect.gen(function* () {
			const cache = yield* PackIndex;
			const packs = yield* Cache.get(cache, origin);
			return { packs, excalidraw: yield* loadPackExcalidrawStates(env, packs, { waitUntil }) };
		}),
	);
