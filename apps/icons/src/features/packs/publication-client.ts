import { Effect } from "effect";
import { HttpApiClient } from "effect/http-api";
import { HttpClient, HttpClientRequest } from "effect/http";
import { PackPublicationApi } from "./publication-api.js";
import { parseXHandle } from "./publication.js";
import { IconQueryError } from "../../lib/query-atoms.js";
const decode = HttpApiClient.decodeResponse(PackPublicationApi, {
	group: "packs",
	endpoint: "publish",
});
export const publishPack = Effect.fn("Icons.packs.publish")(function* (
	packId: string,
	form: FormData,
) {
	const typed = form.get("xHandle");
	const xHandle = parseXHandle(typeof typed === "string" ? typed : "");
	if (!xHandle.ok) return yield* Effect.fail(new IconQueryError({ message: xHandle.message }));
	const client = yield* HttpApiClient.make(PackPublicationApi, {
		transformClient: HttpClient.mapRequest(HttpClientRequest.prependUrl(window.location.origin)),
	});
	const author = form.get("authorName");
	const website = form.get("website");
	const response = yield* client.packs.publish({
		params: { id: packId },
		payload: {
			authorName: typeof author === "string" ? author : "",
			xHandle: xHandle.handle,
			...(typeof website === "string" ? { website } : {}),
		},
		responseMode: "response-only",
	});
	return yield* decode(response).pipe(
		Effect.mapError(
			(error) =>
				new IconQueryError({
					message:
						"body" in error
							? error.body.error.message
							: `Publishing failed with HTTP ${response.status}.`,
				}),
		),
	);
});
