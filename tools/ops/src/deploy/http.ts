import { Effect, Option, Schema } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";

import { opsError } from "../process";

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

export interface JsonResponse {
	readonly status: number;
	readonly ok: boolean;
	readonly headers: Readonly<Record<string, string>>;
	readonly text: string;
	/** The parsed body, or undefined when it is not JSON. */
	readonly json: unknown;
}

/** Sends a request and reads its whole body. Only a transport failure fails the effect. */
export const send = Effect.fn("ops.http.send")(
	function* (request: HttpClientRequest.HttpClientRequest) {
		const client = yield* HttpClient.HttpClient;
		const response = yield* client.execute(request);
		const text = yield* response.text;
		return {
			status: response.status,
			ok: response.status >= 200 && response.status < 300,
			headers: response.headers,
			text,
			json: Option.getOrUndefined(decodeJson(text)),
		} satisfies JsonResponse;
	},
	Effect.mapError((error) => opsError(`${error.message}`)),
);

/** Decodes a response body with `schema`, failing with `message` and the body when it does not match. */
export function decodeBody<S extends Schema.Top & { readonly DecodingServices: never }>(
	schema: S,
	response: JsonResponse,
	message: string,
) {
	return Schema.decodeUnknownEffect(schema)(response.json).pipe(
		Effect.mapError(() =>
			opsError(`${message} (HTTP ${response.status}): ${response.text.slice(0, 500)}`),
		),
	);
}
