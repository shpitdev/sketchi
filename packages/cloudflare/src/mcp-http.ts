import { ByteSize, Effect, Option, Result, Schema } from "effect";
import {
	HttpIncomingMessage,
	HttpServerRequest,
	HttpServerRespondable,
	HttpServerResponse,
} from "effect/http";

/** One native Effect MCP web handler, owned by a single HTTP request. */
export interface McpWebHandler {
	/** `replay` marks the boundary's own initialize, which must not export telemetry. */
	readonly fetch: (request: Request, options: { readonly replay: boolean }) => Promise<Response>;
	readonly dispose: () => Promise<void>;
}

const SESSION_HEADER = "mcp-session-id";
const VERSION_HEADER = "mcp-protocol-version";
// Streamable HTTP: a client that sends no version header speaks 2025-03-26.
const DEFAULT_PROTOCOL_VERSION = "2025-03-26";

const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const decodeMethod = Schema.decodeUnknownOption(
	Schema.fromJsonString(Schema.Struct({ method: Schema.String })),
);

/**
 * Returns a response without any native session header and releases the
 * request's handler once that body is fully read or cancelled, so streamed
 * tool output is never cut short.
 */
const releaseAfterBody = (response: Response, release: () => void) => {
	const headers = new Headers(response.headers);
	headers.delete(SESSION_HEADER);
	const reader = response.body?.getReader();
	if (reader === undefined) release();
	const body =
		reader &&
		new ReadableStream<Uint8Array>({
			pull: (controller) =>
				reader.read().then((chunk) => {
					if (!chunk.done) return controller.enqueue(chunk.value);
					controller.close();
					release();
				}),
			cancel: (reason) => reader.cancel(reason).finally(release),
		});
	return new Response(body, { status: response.status, statusText: response.statusText, headers });
};

/**
 * Serves one MCP HTTP request without sessions, as production did before
 * Effect MCP: every POST gets a fresh native handler, so nothing a client
 * relies on lives between requests and no idle gap or eviction can lose it.
 *
 * Effect 4.1.4 serves the 2025 revisions only through sessions, so a request
 * other than `initialize` is preceded by an `initialize` on its own handler,
 * negotiating the version the client sent. The client's own `initialize`
 * passes through and its session header is dropped, so none is ever issued.
 */
export const serveStatelessMcp = Effect.fn("cloudflare.mcp.stateless")(function* (
	request: Request,
	open: () => McpWebHandler,
	waitUntil: (promise: Promise<unknown>) => void,
) {
	if (request.method === "OPTIONS")
		return new Response(null, {
			status: 204,
			headers: {
				"Access-Control-Allow-Origin": "*",
				"Access-Control-Allow-Methods": "POST, OPTIONS",
				"Access-Control-Allow-Headers": "Content-Type, MCP-Protocol-Version",
			},
		});
	// Bound the body once here; the native transport stays the only protocol decoder.
	const body =
		request.body === null
			? undefined
			: yield* HttpServerRequest.fromWeb(request).arrayBuffer.pipe(
					Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.mebibytes(1)),
					Effect.result,
				);
	if (body !== undefined && Result.isFailure(body)) {
		const response = yield* HttpServerRespondable.toResponse(body.failure);
		return HttpServerResponse.toWeb(HttpServerResponse.setHeader(response, "content-length", "0"));
	}
	const bytes = body?.success;
	const method =
		request.method === "POST" && bytes !== undefined
			? Option.getOrUndefined(decodeMethod(new TextDecoder().decode(bytes)))?.method
			: undefined;
	const handler = open();
	let released = false;
	const release = () => {
		if (released) return;
		released = true;
		waitUntil(handler.dispose());
	};
	const call = (outgoing: Request, replay: boolean) =>
		Effect.promise(() => handler.fetch(outgoing, { replay }));
	const prime = (message: object, session?: string) => {
		const origin = request.headers.get("origin");
		return Effect.flatMap(encodeJson({ jsonrpc: "2.0", ...message }), (body) =>
			call(
				new Request(request.url, {
					method: "POST",
					headers: {
						"content-type": "application/json",
						accept: "application/json, text/event-stream",
						...(origin === null ? {} : { origin }),
						...(session === undefined ? {} : { [SESSION_HEADER]: session }),
					},
					body,
					signal: request.signal,
				}),
				true,
			),
		);
	};
	return yield* Effect.gen(function* () {
		const headers = new Headers(request.headers);
		headers.delete(SESSION_HEADER);
		if (method !== undefined && method !== "initialize") {
			const initialized = yield* prime({
				id: 0,
				method: "initialize",
				params: {
					protocolVersion: request.headers.get(VERSION_HEADER) ?? DEFAULT_PROTOCOL_VERSION,
					capabilities: {},
					clientInfo: { name: "sketchi-stateless", version: "1" },
				},
			});
			const session = initialized.headers.get(SESSION_HEADER);
			if (session === null) return releaseAfterBody(initialized, release);
			yield* Effect.promise(() => initialized.arrayBuffer());
			const ready = yield* prime({ method: "notifications/initialized" }, session);
			yield* Effect.promise(() => ready.arrayBuffer());
			headers.set(SESSION_HEADER, session);
		}
		const response = yield* call(
			new Request(request, { headers, ...(bytes === undefined ? {} : { body: bytes }) }),
			false,
		);
		return releaseAfterBody(response, release);
	}).pipe(Effect.onError(() => Effect.sync(release)));
});
