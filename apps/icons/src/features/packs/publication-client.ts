import { Effect, Schema } from "effect";
import { HttpApiClient } from "effect/http-api";
import { HttpClient, HttpClientRequest } from "effect/http";
import { PackPublicationApi } from "./publication-api.js";
import { PublishPayload } from "./publication.js";
import { IconQueryError } from "../../lib/query-atoms.js";
const decode = HttpApiClient.decodeResponse(PackPublicationApi, {
	group: "packs",
	endpoint: "publish",
});
export const publishPack = Effect.fn("Icons.packs.publish")(function* (
	packId: string,
	form: FormData,
) {
	const payload = yield* Schema.decodeUnknownEffect(PublishPayload)({
		authorName: form.get("authorName") ?? "",
		xHandle: form.get("xHandle") ?? "",
		website: form.get("website") ?? "",
	}).pipe(Effect.mapError((error) => new IconQueryError({ message: error.message })));
	const client = yield* HttpApiClient.make(PackPublicationApi, {
		transformClient: HttpClient.mapRequest(HttpClientRequest.prependUrl(window.location.origin)),
	});
	const response = yield* client.packs.publish({
		params: { id: packId },
		payload,
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
