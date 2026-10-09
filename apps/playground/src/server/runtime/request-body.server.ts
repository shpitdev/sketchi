import "@tanstack/react-start/server-only";

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

export const readBoundedJson = Effect.fn("playground.http.readBoundedJson")(
  (request: Request, maxBytes: number) =>
    Effect.tryPromise({
      try: async (effectSignal): Promise<BoundedJson> => {
        const signal = AbortSignal.any([effectSignal, request.signal]);
        signal.throwIfAborted();
        const contentLength = Number(request.headers.get("content-length"));
        if (Number.isFinite(contentLength) && contentLength > maxBytes) {
          await request.body?.cancel("Request byte limit exceeded");
          return { _tag: "TooLarge" };
        }
        if (!request.body) return { _tag: "InvalidJson" };

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
              return { _tag: "TooLarge" };
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
        try {
          return {
            _tag: "Body",
            body: JSON.parse(new TextDecoder().decode(bytes)),
          };
        } catch {
          return { _tag: "InvalidJson" };
        }
      },
      catch: (cause) =>
        RequestBodyReadError.make({
          cause,
          message: "The request body could not be read.",
        }),
    }),
);
