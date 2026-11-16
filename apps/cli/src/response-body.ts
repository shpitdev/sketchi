import { Effect, Option, Stream } from "effect";
import { HttpClientResponse } from "effect/http";

export const MAX_API_RESPONSE_BYTES = 16 * 1024 * 1024;
export const API_REQUEST_TIMEOUT = "90 seconds";
// The generate API gives one request 120 s across its model calls, then builds
// and returns the diagram; the wait covers both with room to spare.
export const GENERATE_REQUEST_TIMEOUT = "150 seconds";

/** The stream scope cancels the body on failure, timeout, or interruption. */
export const readBoundedBody = Effect.fn("sketchi.cli.response.readBoundedBody")(function* <E>(
	response: Response,
	limit: number,
	onError: () => E,
	onReadError: () => E = onError,
) {
	const body = response.body;
	const declaredLength = Number(response.headers.get("content-length"));
	if (Number.isFinite(declaredLength) && declaredLength > limit) {
		if (body) {
			yield* Effect.tryPromise({
				try: () => body.cancel(),
				catch: onError,
			}).pipe(Effect.ignore);
		}
		return yield* Effect.fail(onError());
	}
	if (!body) return new Uint8Array();
	const collected = yield* Stream.fromReadableStream({
		evaluate: () => body,
		onError: onReadError,
	}).pipe(
		Stream.runFoldEffect(
			(): { chunks: Uint8Array[]; size: number } => ({ chunks: [], size: 0 }),
			(state, chunk) => {
				const size = state.size + chunk.byteLength;
				if (size > limit) return Effect.fail(onError());
				state.chunks.push(chunk);
				return Effect.succeed({ chunks: state.chunks, size });
			},
		),
	);
	const bytes = new Uint8Array(collected.size);
	let offset = 0;
	for (const chunk of collected.chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
});

export const readBoundedText = Effect.fn("sketchi.cli.response.readBoundedText")(function* <E>(
	response: Response,
	limit: number,
	onError: () => E,
	onReadError: () => E = onError,
) {
	const bytes = yield* readBoundedBody(response, limit, onError, onReadError);
	return yield* Effect.try({
		try: () => new TextDecoder("utf-8", { fatal: true }).decode(bytes),
		catch: onError,
	});
});

/**
 * A client response with its body read under the CLI's byte cap, ready for the generated decoder.
 * FetchHttpClient reads bodies without a cap.
 */
export const boundedResponse = Effect.fn("sketchi.cli.response.bounded")(function* <E>(
	response: HttpClientResponse.HttpClientResponse,
	limit: number,
	onError: () => E,
	onReadError: () => E = onError,
) {
	const web = HttpClientResponse.toWeb(response);
	if (Option.isNone(web)) return yield* Effect.fail(onError());
	const text = yield* readBoundedText(web.value, limit, onError, onReadError);
	return HttpClientResponse.fromWeb(
		response.request,
		new Response(text, { status: response.status, headers: response.headers }),
	);
});
