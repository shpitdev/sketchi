import { IconSource } from "./api.server.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
	type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { Array, Context, Effect, Option, Schema, Stream } from "effect";
import { Tool } from "effect/ai";
import { withCors } from "./cors-policy.js";
import type { IconSourceLoader } from "./catalog.server.js";
import { IconToolkit, IconToolHandlers, normalizeIconToolArguments } from "./toolkit.server.js";

const definitions = Array.map(
	[IconToolkit.tools.search_icons, IconToolkit.tools.get_icon],
	(tool) => ({
		name: tool.name,
		title: Option.getOrElse(Context.getOption(tool.annotations, Tool.Title), () => tool.name),
		description: tool.description,
		// Preserve the advertised closed shape; ingress still accepts/ignores extra keys.
		inputSchema: { ...Tool.getJsonSchema(tool), additionalProperties: false },
		annotations: {
			readOnlyHint: Context.get(tool.annotations, Tool.Readonly),
			idempotentHint: Context.get(tool.annotations, Tool.Idempotent),
			openWorldHint: Context.get(tool.annotations, Tool.OpenWorld),
		},
	}),
);

function invalidArguments(message: string): CallToolResult {
	return { content: [{ text: message, type: "text" }], isError: true };
}

export interface IconMcpServerOptions {
	readonly origin?: string;
	readonly sourceLoader: IconSourceLoader;
}

export function createIconMcpServer(options: IconMcpServerOptions): Server {
	const source = {
		origin: options.origin ?? "https://icons.sketchi.app",
		sourceLoader: options.sourceLoader,
	};
	const server = new Server(
		{ name: "sketchi-icons", version: "1.0.0" },
		{ capabilities: { tools: { listChanged: false } } },
	);
	server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: definitions }));
	server.setRequestHandler(CallToolRequestSchema, (request, extra) => {
		const name = request.params.name;
		if (name !== "search_icons" && name !== "get_icon")
			return invalidArguments(`Tool ${name} was not found.`);
		const call = Effect.gen(function* () {
			const input = yield* Schema.decodeUnknownEffect(Schema.Json)(request.params.arguments ?? {});
			const toolkit = yield* IconToolkit;
			const stream = yield* toolkit.handle(
				name,
				normalizeIconToolArguments(name, input),
				request.params._meta?.progressToken?.toString(),
			);
			const output = yield* stream.pipe(
				Stream.filter((result) => !result.preliminary),
				Stream.runLast,
			);
			if (Option.isNone(output)) return invalidArguments(`Tool ${name} returned no result.`);
			// HandlerResult includes failure values even in error mode; use the tool
			// success schema to narrow the transport projection without a type assertion.
			if (name === "get_icon") {
				const detail = yield* Schema.decodeUnknownEffect(IconToolkit.tools.get_icon.successSchema)(
					output.value.result,
				);
				return {
					content: [
						{ text: detail.svg, type: "text" as const },
						{ text: `Permanent SVG URL: ${detail.svgUrl}`, type: "text" as const },
					],
					structuredContent: detail,
				};
			}
			const value = yield* Schema.decodeUnknownEffect(IconToolkit.tools.search_icons.successSchema)(
				output.value.result,
			);
			const json = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown, { space: 2 }))(
				value,
			);
			return { content: [{ text: json, type: "text" as const }], structuredContent: value };
		}).pipe(
			Effect.catchTags({
				IconNotFound: (error) => Effect.succeed(invalidArguments(error.message)),
				AiError: (error) =>
					error.reason._tag === "ToolParameterValidationError"
						? Effect.succeed(
								invalidArguments(
									name === "search_icons"
										? "limit must be an integer from 1 to 100."
										: "slug is required.",
								),
							)
						: Effect.fail(error),
			}),
			// @effect-diagnostics-next-line strictEffectProvide:off -- SDK callback owns this Toolkit layer and its request source.
			Effect.provide(IconToolHandlers),
			Effect.provideService(IconSource, source),
		);
		return Effect.runPromise(call, { signal: extra.signal });
	});
	return server;
}

// @effect-diagnostics-next-line asyncFunction:off -- Existing agents HTTP transport is a Promise host boundary until slice 5b.
export async function handleIconMcpRequest(
	request: Request,
	sourceLoader: IconSourceLoader,
): Promise<Response> {
	const { createLegacyMcpHandler } = await import("agents/mcp");
	const handler = createLegacyMcpHandler(
		createIconMcpServer({
			origin: new URL(request.url).origin,
			sourceLoader,
		}),
		{ route: "/mcp" },
	);
	const response = await handler(
		request,
		{},
		{
			passThroughOnException() {},
			props: {},
			waitUntil() {},
		},
	);
	return withCors(response);
}
