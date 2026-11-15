import { Effect, Layer } from "effect";
import { McpSchema, McpServer } from "effect/ai";

/**
 * Effect 4.1.4 registerToolkit emits only JSON text; its middleware result is
 * opaque. Decorate native registration once to present already-encoded output.
 * Native registration retains schemas, dispatch, errors and request services.
 */
export const mcpToolContent = (
	project: (name: string, result: McpSchema.CallToolResult) => McpSchema.CallToolResult,
) =>
	Layer.effect(
		McpServer.McpServer,
		Effect.map(McpServer.McpServer, (server) =>
			McpServer.McpServer.of({
				...server,
				addTool: (registration) =>
					server.addTool({
						...registration,
						handle: (payload) =>
							Effect.map(registration.handle(payload), (result) =>
								"content" in result && !result.isError
									? project(registration.tool.name, result)
									: result,
							),
					}),
			}),
		),
	);
