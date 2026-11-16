import "@tanstack/react-start/server-only";

import { SpanContent } from "@sketchi/observability";
import { ByteSize, Effect, Result, Schema } from "effect";
import { HttpIncomingMessage, type HttpServerRequest } from "effect/http";

export type JsonBody =
	| { readonly _tag: "TooLarge" }
	| { readonly _tag: "InvalidJson" }
	| { readonly _tag: "Body"; readonly body: unknown };

const decodeJson = Schema.decodeUnknownResult(Schema.fromJsonString(Schema.Unknown));

/**
 * Reads a JSON body of at most `maxBytes`. The native reader refuses a larger declared length
 * before reading and stops counting bytes past the limit. The span records the body as it arrived,
 * or the outcome when there is none to record.
 */
export const readJsonBody = Effect.fn("playground.http.readJsonBody")(function* (
	request: HttpServerRequest.HttpServerRequest,
	maxBytes: number,
) {
	const read = yield* request.arrayBuffer.pipe(
		Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.bytes(maxBytes)),
		Effect.result,
	);
	if (Result.isFailure(read)) {
		const reason = read.failure.reason;
		const tooLarge = reason._tag === "RequestParseError" && reason.reason === "BodyTooLarge";
		yield* Effect.annotateCurrentSpan({
			"http.request.body.outcome": tooLarge ? "TooLarge" : "InvalidJson",
		});
		return tooLarge ? ({ _tag: "TooLarge" } as const) : ({ _tag: "InvalidJson" } as const);
	}
	const text = new TextDecoder().decode(read.success);
	const parsed = decodeJson(text);
	const body: JsonBody = Result.isSuccess(parsed)
		? { _tag: "Body", body: parsed.success }
		: { _tag: "InvalidJson" };
	yield* Effect.annotateCurrentSpan({
		"http.request.body.size": read.success.byteLength,
		"http.request.body.outcome": body._tag,
		[SpanContent.httpRequestBody]: text,
	});
	return body;
});
