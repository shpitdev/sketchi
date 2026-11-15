/** Jev through the account's credential-free Workers AI binding. */
import { TypeSafeClient, TypeSafeDecisionModel } from "@effect/ai-typesafe";
import { Effect, Layer, Schema } from "effect";
import { DecisionModel } from "effect/ai";
import { HttpBody, HttpClient, HttpClientError, HttpClientResponse } from "effect/http";

/** The slice of a Workers AI binding Jev needs. */
export interface WorkersAiRunner {
	run(model: string, input: unknown): Promise<unknown>;
}

const decodeRequest = Schema.decodeUnknownEffect(
	Schema.fromJsonString(
		Schema.StructWithRest(Schema.Struct({ model: Schema.String }), [
			Schema.Record(Schema.String, Schema.Unknown),
		]),
	),
);

/** The binding wraps Jev's response; the documented response is bare. */
function jevResult(response: unknown): unknown {
	return typeof response === "object" && response !== null && "result" in response
		? response.result
		: response;
}

/** Only System One is transported: the provider owns all decision codecs. */
const bindingClient = (ai: WorkersAiRunner) =>
	HttpClient.make(
		Effect.fn("WorkersAiJev.systemOne")(function* (request, url) {
			const encodeError = (cause: unknown) =>
				new HttpClientError.HttpClientError({
					reason: new HttpClientError.EncodeError({ request, cause }),
				});
			if (
				request.method !== "POST" ||
				url.pathname !== "/systemone" ||
				request.body._tag !== "Uint8Array"
			) {
				return yield* Effect.fail(encodeError("Workers AI Jev requires a System One JSON request"));
			}
			const { model, ...input } = yield* decodeRequest(
				request.body.text ?? new TextDecoder().decode(request.body.body),
			).pipe(Effect.mapError(encodeError));
			// AI.run has no AbortSignal. Interruption stops waiting, not provider work or billing.
			const result = yield* Effect.tryPromise({
				try: () => ai.run(`typesafe/${model}`, input),
				catch: (cause) =>
					new HttpClientError.HttpClientError({
						reason: new HttpClientError.TransportError({
							request,
							cause,
							description: `Workers AI run failed: ${String(cause)}`,
						}),
					}),
			});
			const body = yield* HttpBody.json(jevResult(result)).pipe(
				Effect.mapError(
					(cause) =>
						new HttpClientError.HttpClientError({
							reason: new HttpClientError.DecodeError({
								request,
								response: HttpClientResponse.fromWeb(request, new Response()),
								cause,
							}),
						}),
				),
			);
			return HttpClientResponse.fromWeb(
				request,
				new Response(body.text, { headers: { "content-type": body.contentType } }),
			);
		}),
	);

/** A TypeSafe DecisionModel with only its HTTP transport replaced by AI.run. */
export const makeWorkersAiJev = Effect.fn("WorkersAiJev.make")(function* (options: {
	readonly ai: WorkersAiRunner;
	/** A Jev version, such as `jev-1.14.0`. */
	readonly model: string;
}) {
	const client = yield* TypeSafeClient.make({
		// Request identity for tracing/errors only; the binding client never fetches this URL.
		apiUrl: "https://workers-ai.invalid",
	}).pipe(Effect.provideService(HttpClient.HttpClient, bindingClient(options.ai)));
	return yield* TypeSafeDecisionModel.make({ model: options.model }).pipe(
		Effect.provideService(TypeSafeClient.TypeSafeClient, client),
	);
});

export const workersAiJevLayer = (options: {
	readonly ai: WorkersAiRunner;
	readonly model: string;
}): Layer.Layer<DecisionModel.DecisionModel> =>
	Layer.effect(DecisionModel.DecisionModel, makeWorkersAiJev(options));
