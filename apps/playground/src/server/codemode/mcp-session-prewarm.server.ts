import "@tanstack/react-start/server-only";

import { Effect, Schema } from "effect";

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
 * Prewarms the PNG renderer when an MCP request starts a session. Harnesses
 * read docs a few seconds before their first execute, which covers opening a
 * Browser Run page. The body is read from a clone taken now, so the MCP
 * transport keeps the original stream; run the returned effect in waitUntil
 * with `PlaygroundCodeMode.prewarmPngRenderer`.
 */
export function prewarmPngRendererOnSessionStart<R>(
	request: Request,
	codeMode: { readonly prewarmPngRenderer: Effect.Effect<void, never, R> },
): Effect.Effect<void, never, R> {
	if (request.method !== "POST") {
		return Effect.void;
	}
	const body = request.clone();
	return Effect.tryPromise({
		try: (): Promise<unknown> => body.json(),
		catch: (cause) => cause,
	}).pipe(
		Effect.flatMap((message) =>
			(Array.isArray(message) ? message.some(isSessionStart) : isSessionStart(message))
				? codeMode.prewarmPngRenderer
				: Effect.void,
		),
		// The MCP transport reports malformed requests; prewarming only skips them.
		Effect.ignore,
	);
}
