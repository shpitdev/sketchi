import { String as Str, ByteSize, Effect, Result, Schema } from "effect";
import {
	HttpIncomingMessage,
	HttpServerRequest,
	HttpServerRespondable,
	HttpServerResponse,
} from "effect/http";
/** Only the Cloudflare namespace operations used to locate one native MCP session. */
export interface McpSessionNamespace {
	newUniqueId(): {
		toString(): string;
	};
	idFromString(id: string): {
		toString(): string;
	};
	get(id: { toString(): string }): {
		fetch(request: Request, init?: RequestInit): Promise<Response>;
	};
}
export class McpRouteError extends Schema.TaggedError<
	McpRouteError,
	{
		readonly brand: unique symbol;
	}
>()("McpRouteError", {
	cause: Schema.Defect(),
}) {}
export const MCP_SESSION_HEADER = "mcp-session-id";
export const MCP_SESSION_IDLE_MS = 30 * 60 * 1000;
export const expiredMcpSession = () =>
	Response.json(
		{
			jsonrpc: "2.0",
			id: null,
			error: { code: -32001, message: "MCP session expired. Initialize a new session." },
		},
		{ status: 404 },
	);
/** The opaque header carries its DO locator; no isolate-local session index. */
export const routeMcpSession = Effect.fn("cloudflare.mcp.route")(function* (
	request: Request,
	namespace: McpSessionNamespace,
) {
	if (request.method === "OPTIONS")
		return new Response(null, {
			status: 204,
			headers: {
				"Access-Control-Allow-Origin": "*",
				"Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
				"Access-Control-Allow-Headers": "Content-Type, MCP-Protocol-Version, MCP-Session-Id",
				"Access-Control-Expose-Headers": "MCP-Session-Id",
			},
		});
	const session = request.headers.get(MCP_SESSION_HEADER);
	if (session !== null && !/^[a-f0-9]{64}\.[A-Za-z0-9_-]{1,128}$/.test(session)) {
		return expiredMcpSession();
	}
	// Workerd cannot keep forwarding an unread request stream after the DO has
	// already rejected it. Bound and buffer bytes once at this Worker boundary;
	// the native MCP transport remains the sole JSON/protocol decoder.
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
	const id =
		session === null
			? namespace.newUniqueId()
			: yield* Effect.try(() => namespace.idFromString(Str.slice(0, 64)(session))).pipe(
					Effect.catch(() => Effect.succeed(undefined)),
				);
	if (id === undefined) return expiredMcpSession();
	const headers = new Headers(request.headers);
	if (session !== null) headers.set(MCP_SESSION_HEADER, Str.slice(65)(session));
	const response = yield* Effect.tryPromise({
		try: (signal) =>
			namespace.get(id).fetch(
				new Request(request, {
					headers,
					...(body === undefined ? {} : { body: body.success }),
				}),
				{ signal: AbortSignal.any([signal, request.signal]) },
			),
		catch: (cause) => new McpRouteError({ cause }),
	});
	const nativeSession = response.headers.get(MCP_SESSION_HEADER);
	if (nativeSession === null) return response;
	const returnedHeaders = new Headers(response.headers);
	returnedHeaders.set(MCP_SESSION_HEADER, `${id.toString()}.${nativeSession}`);
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers: returnedHeaders,
	});
});
