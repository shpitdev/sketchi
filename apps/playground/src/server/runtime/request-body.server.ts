import "@tanstack/react-start/server-only";

import { SpanContent } from "@sketchi/observability";
import { Effect, Schema } from "effect";

export class RequestBodyReadError extends Schema.TaggedError<RequestBodyReadError>()(
	"RequestBodyReadError",
	{
		cause: Schema.Defect(),
		message: Schema.String,
	},
) {}

export type BoundedJson =
	| { readonly _tag: "TooLarge" }
	| { readonly _tag: "InvalidJson" }
	| { readonly _tag: "Body"; readonly body: unknown };

/** What a bounded read got: the body as text, or how much arrived before the limit stopped it. */
interface BodyRead {
	readonly bytesRead: number;
	readonly result: BoundedJson;
	readonly text?: string;
}

/**
 * Reads a JSON body up to `maxBytes`, then cancels the rest. The span records the body
 * as it arrived, or, for one over the limit, how many bytes came before the read stopped.
 */
export const readBoundedJson = Effect.fn("playground.http.readBoundedJson")(
	(request: Request, maxBytes: number) =>
		Effect.tryPromise({
			try: async (effectSignal): Promise<BodyRead> => {
				const signal = AbortSignal.any([effectSignal, request.signal]);
				signal.throwIfAborted();
				const contentLength = Number(request.headers.get("content-length"));
				if (Number.isFinite(contentLength) && contentLength > maxBytes) {
					await request.body?.cancel("Request byte limit exceeded");
					return { bytesRead: 0, result: { _tag: "TooLarge" } };
				}
				if (!request.body) return { bytesRead: 0, result: { _tag: "InvalidJson" } };

				const reader = request.body.getReader();
				const cancel = () => {
					void reader.cancel(signal.reason).catch(() => undefined);
				};
				signal.addEventListener("abort", cancel, { once: true });
				const chunks: Uint8Array[] = [];
				let byteLength = 0;
				try {
					for (;;) {
						signal.throwIfAborted();
						const chunk = await reader.read();
						signal.throwIfAborted();
						if (chunk.done) break;
						byteLength += chunk.value.byteLength;
						if (byteLength > maxBytes) {
							await reader.cancel("Request byte limit exceeded");
							return { bytesRead: byteLength, result: { _tag: "TooLarge" } };
						}
						chunks.push(chunk.value);
					}
				} finally {
					signal.removeEventListener("abort", cancel);
					reader.releaseLock();
				}
				const bytes = new Uint8Array(byteLength);
				let offset = 0;
				for (const chunk of chunks) {
					bytes.set(chunk, offset);
					offset += chunk.byteLength;
				}
				const text = new TextDecoder().decode(bytes);
				try {
					return { bytesRead: byteLength, result: { _tag: "Body", body: JSON.parse(text) }, text };
				} catch {
					return { bytesRead: byteLength, result: { _tag: "InvalidJson" }, text };
				}
			},
			catch: (cause) =>
				RequestBodyReadError.make({
					cause,
					message: "The request body could not be read.",
				}),
		}).pipe(
			Effect.tap(({ bytesRead, result, text }) =>
				Effect.annotateCurrentSpan({
					"http.request.body.size": bytesRead,
					"http.request.body.outcome": result._tag,
					...(text === undefined ? {} : { [SpanContent.httpRequestBody]: text }),
				}),
			),
			Effect.map(({ result }) => result),
		),
);
