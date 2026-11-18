import { Effect, Stream } from "effect";
import { FetchHttpClient, HttpClient, HttpClientError, HttpClientRequest } from "effect/http";

/** Send each generated JSON body once. The caller's scope owns the whole exchange. */
export const oneShotJsonClient = (http: HttpClient.HttpClient, endpoint: string) =>
	http.pipe(
		HttpClient.mapRequestEffect((request) => {
			const { body } = request;
			if (body._tag !== "Uint8Array") {
				return Effect.fail(
					new HttpClientError.HttpClientError({
						reason: new HttpClientError.EncodeError({
							request,
							description: "A one-shot request requires an encoded JSON body.",
						}),
					}),
				);
			}
			// Node Fetch silently resends replayable bodies after HTTP 421. Give each explicit
			// attempt a fresh stream and never let Fetch buffer it or follow a redirect.
			return Effect.succeed(
				request.pipe(
					HttpClientRequest.setUrl(endpoint),
					HttpClientRequest.setHeader("x-sketchi-client", "sketchi-cli"),
					HttpClientRequest.bodyStream(Stream.succeed(body.body), {
						contentType: body.contentType,
					}),
				),
			);
		}),
		HttpClient.withScope,
		HttpClient.transformResponse((effect) =>
			effect.pipe(
				Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }),
				Effect.provideService(FetchHttpClient.StreamBodyFallback, "error"),
			),
		),
	);
