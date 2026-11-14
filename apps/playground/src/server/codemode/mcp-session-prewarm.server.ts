import "@tanstack/react-start/server-only";

import { SpanContent } from "@sketchi/observability";
import { Effect, Schema } from "effect";

import { RequestBodyReadError } from "../runtime/request-body.server";

/** JSON-RPC messages a harness sends while starting a session, before its first execute. */
const SessionStartMessage = Schema.Union([
	Schema.Struct({ method: Schema.Literals(["initialize", "tools/list"]) }),
	Schema.Struct({
		method: Schema.Literal("tools/call"),
		params: Schema.Struct({ name: Schema.Literal("docs") }),
	}),
]);
const isSessionStart = Schema.is(SessionStartMessage);

/**
 * The JSON-RPC message an MCP POST carries, read from a clone so the MCP transport
 * keeps the original stream. The body is recorded on the current span as it
 * arrived. A body that is not JSON reads as `undefined`; the transport reports it.
 */
export function readMcpMessage(request: Request): Effect.Effect<unknown> {
	if (request.method !== "POST" || !request.body) return Effect.void;
	const body = request.clone();
	return Effect.tryPromise({
		try: (): Promise<string> => body.text(),
		catch: (cause) => RequestBodyReadError.make({ cause, message: "Unable to read MCP message." }),
	}).pipe(
		Effect.tap((text) => Effect.annotateCurrentSpan(SpanContent.httpRequestBody, text)),
		Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))),
		Effect.orElseSucceed(() => undefined),
	);
}

/**
 * Prewarms the PNG renderer when an MCP message starts a session. Harnesses
 * read docs a few seconds before their first execute, which covers opening a
 * Browser Run page. Run the returned effect in waitUntil with
 * `PlaygroundCodeMode.prewarmPngRenderer`.
 */
export function prewarmPngRendererOnSessionStart<R>(
	message: unknown,
	codeMode: { readonly prewarmPngRenderer: Effect.Effect<void, never, R> },
): Effect.Effect<void, never, R> {
	return (Array.isArray(message) ? message.some(isSessionStart) : isSessionStart(message))
		? codeMode.prewarmPngRenderer
		: Effect.void;
}
