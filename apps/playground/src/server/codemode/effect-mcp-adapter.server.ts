import "@tanstack/react-start/server-only";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
	CallToolRequestSchema,
	ErrorCode,
	ListToolsRequestSchema,
	McpError,
	type CallToolResult,
	type Tool,
	type ToolAnnotations,
} from "@modelcontextprotocol/sdk/types.js";
import type { Schema } from "effect";

import type { PlaygroundStandardSchema } from "../schema/effect-standard-schema.server";

interface EffectMcpToolConfig<
	InputSchema extends Schema.ConstraintDecoder<unknown>,
	OutputSchema extends Schema.ConstraintDecoder<unknown>,
> {
	readonly annotations?: ToolAnnotations;
	readonly description: string;
	readonly inputSchema: PlaygroundStandardSchema<InputSchema>;
	readonly outputSchema: PlaygroundStandardSchema<OutputSchema>;
	readonly title: string;
}

interface RegisteredEffectTool {
	readonly call: (input: unknown) => Promise<CallToolResult>;
	readonly definition: Tool;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isMcpObjectJsonSchema(value: unknown): value is Tool["inputSchema"] {
	return isRecord(value) && value.type === "object";
}

/** Convert the Effect-backed Standard Schema document to MCP's Draft-07 object shape. */
function toMcpJsonSchema<S extends Schema.ConstraintDecoder<unknown>>(
	schema: PlaygroundStandardSchema<S>,
	options: { readonly mode: "input" | "output"; readonly openRoot: boolean },
): Tool["inputSchema"] {
	const draft07 = schema["~standard"].jsonSchema[options.mode]({
		target: "draft-07",
	});
	if (!isRecord(draft07)) {
		throw new Error("Effect generated an invalid MCP JSON Schema document.");
	}
	const converted: Record<string, unknown> = {
		...draft07,
		$schema: "http://json-schema.org/draft-07/schema#",
	};
	const { additionalProperties: _additionalProperties, ...openRoot } = converted;
	const result = options.openRoot ? openRoot : converted;
	if (!isMcpObjectJsonSchema(result)) {
		throw new Error("MCP tool schemas must encode JSON objects.");
	}
	return result;
}

function toolError(message: string): CallToolResult {
	return {
		content: [{ type: "text", text: message }],
		isError: true,
	};
}

function invalidParamsToolError(message: string): CallToolResult {
	return toolError(new McpError(ErrorCode.InvalidParams, message).message);
}

export function makeEffectMcpTool<
	InputSchema extends Schema.ConstraintDecoder<unknown>,
	OutputSchema extends Schema.ConstraintDecoder<unknown>,
>(name: string, config: EffectMcpToolConfig<InputSchema, OutputSchema>) {
	const definition: Tool = {
		name,
		title: config.title,
		description: config.description,
		inputSchema: toMcpJsonSchema(config.inputSchema, {
			mode: "input",
			openRoot: true,
		}),
		outputSchema: toMcpJsonSchema(config.outputSchema, {
			mode: "output",
			openRoot: false,
		}),
		annotations: config.annotations,
		execution: { taskSupport: "forbidden" },
	};
	return {
		definition,
		bind: (
			handler: (input: InputSchema["Type"]) => CallToolResult | Promise<CallToolResult>,
		): RegisteredEffectTool => ({
			definition,
			call: async (input) => {
				const decodedInput = await config.inputSchema["~standard"].validate(input);
				if ("issues" in decodedInput) {
					return invalidParamsToolError(
						`Input validation error: Invalid arguments for tool ${name}: ${JSON.stringify(decodedInput.issues, null, 2)}`,
					);
				}

				try {
					const result = await handler(decodedInput.value);
					if (result.isError) {
						return result;
					}
					if (!result.structuredContent) {
						return invalidParamsToolError(
							`Output validation error: Tool ${name} has an output schema but no structured content was provided`,
						);
					}

					const decodedOutput = await config.outputSchema["~standard"].validate(
						result.structuredContent,
					);
					return "issues" in decodedOutput
						? invalidParamsToolError(
								`Output validation error: Invalid structured content for tool ${name}: ${JSON.stringify(decodedOutput.issues, null, 2)}`,
							)
						: result;
				} catch (error) {
					return toolError(error instanceof Error ? error.message : String(error));
				}
			},
		}),
	};
}

export function createEffectMcpServer(input: {
	readonly name: string;
	readonly tools: readonly RegisteredEffectTool[];
	readonly version: string;
}): Server {
	const server = new Server(
		{ name: input.name, version: input.version },
		{ capabilities: { tools: { listChanged: true } } },
	);
	const toolsByName = new Map(input.tools.map((tool) => [tool.definition.name, tool]));

	server.setRequestHandler(ListToolsRequestSchema, () => ({
		tools: input.tools.map((tool) => tool.definition),
	}));
	server.setRequestHandler(CallToolRequestSchema, (request) => {
		const tool = toolsByName.get(request.params.name);
		return tool
			? tool.call(request.params.arguments)
			: invalidParamsToolError(`Tool ${request.params.name} not found`);
	});

	return server;
}
