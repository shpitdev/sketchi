import "@tanstack/react-start/server-only";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
	CallToolRequestSchema,
	ErrorCode,
	ListToolsRequestSchema,
	McpError,
	type CallToolResult,
	type Tool as McpTool,
} from "@modelcontextprotocol/sdk/types.js";
import { Array, Context, Effect, Option, Schema, SchemaIssue } from "effect";
import { AiError, Tool } from "effect/ai";

import {
	toPlaygroundStandardSchema,
	type PlaygroundStandardSchema,
} from "../schema/effect-standard-schema.server";

interface RegisteredEffectTool {
	readonly call: (input: unknown) => Promise<CallToolResult>;
	readonly definition: McpTool;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isMcpObjectJsonSchema(value: unknown): value is McpTool["inputSchema"] {
	return isRecord(value) && value.type === "object";
}

/** Convert the Effect-backed Standard Schema document to MCP's Draft-07 object shape. */
function toMcpJsonSchema<S extends Schema.ConstraintDecoder<unknown>>(
	schema: PlaygroundStandardSchema<S>,
	options: { readonly mode: "input" | "output"; readonly openRoot: boolean },
): McpTool["inputSchema"] {
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

/** Only SDK wire projection remains here; Toolkit owns decoding, dispatch and output encoding. */
export function makeEffectMcpTool<
	Name extends string,
	Input extends Schema.ConstraintDecoder<unknown>,
	Output extends Schema.ConstraintDecoder<unknown>,
	Requirements,
	Execution extends Tool.Execution,
>(
	tool: Tool.Tool<
		Name,
		{
			readonly parameters: Input;
			readonly success: Output;
			readonly failure: typeof Schema.Never;
			readonly failureMode: "error";
		},
		Requirements,
		Execution
	>,
	format: (result: Output["Type"]) => Effect.Effect<CallToolResult>,
) {
	const inputSchema = toPlaygroundStandardSchema(tool.parametersSchema);
	const outputSchema = toPlaygroundStandardSchema(tool.successSchema);
	const definition: McpTool = {
		name: tool.name,
		title: Option.getOrElse(Context.getOption(tool.annotations, Tool.Title), () => tool.name),
		description: tool.description,
		inputSchema: toMcpJsonSchema(inputSchema, { mode: "input", openRoot: true }),
		outputSchema: toMcpJsonSchema(outputSchema, { mode: "output", openRoot: false }),
		annotations: {
			readOnlyHint: Option.getOrUndefined(Context.getOption(tool.annotations, Tool.Readonly)),
			destructiveHint: Option.getOrUndefined(Context.getOption(tool.annotations, Tool.Destructive)),
			idempotentHint: Option.getOrUndefined(Context.getOption(tool.annotations, Tool.Idempotent)),
			openWorldHint: Option.getOrUndefined(Context.getOption(tool.annotations, Tool.OpenWorld)),
		},
		execution: { taskSupport: "forbidden" },
	};
	const failure = Effect.fn("sketchi.mcp.toolFailure")(function* (
		error: AiError.AiError,
		input: unknown,
	) {
		const reason = error.reason;
		if (
			reason._tag === "ToolParameterValidationError" ||
			reason._tag === "ToolResultEncodingError"
		) {
			const isInput = reason._tag === "ToolParameterValidationError";
			const value = isInput ? input : reason.toolResult;
			if (!isInput && value === undefined) {
				return invalidParamsToolError(
					`Output validation error: Tool ${tool.name} has an output schema but no structured content was provided`,
				);
			}
			// Upstream AiError exposes a description, not the Standard Schema issue array.
			// Reuse the same tool schema only on failure to retain the captured SDK wire oracle.
			const validation = yield* Schema.decodeUnknownEffect(
				isInput ? tool.parametersSchema : tool.successSchema,
			)(value, { errors: "all" }).pipe(
				Effect.match({
					onFailure: (error) => SchemaIssue.makeFormatterStandardSchemaV1()(error.issue),
					onSuccess: () => undefined,
				}),
			);
			if (validation) {
				const prefix = isInput
					? `Input validation error: Invalid arguments for tool ${tool.name}`
					: `Output validation error: Invalid structured content for tool ${tool.name}`;
				const issues = yield* Schema.encodeEffect(
					Schema.fromJsonString(Schema.Unknown, { space: 2 }),
				)(validation.issues).pipe(Effect.orDie);
				return invalidParamsToolError(`${prefix}: ${issues}`);
			}
		}
		return toolError(error.message);
	});
	return {
		definition,
		bind: <R>(
			dispatch: (input: Schema.Json) => Effect.Effect<Output["Type"], AiError.AiError, R>,
			run: <A>(effect: Effect.Effect<A, never, R>) => Promise<A>,
		): RegisteredEffectTool => ({
			definition,
			call: (input) =>
				run(
					Schema.decodeUnknownEffect(Schema.Json)(input).pipe(
						Effect.mapError((error) =>
							AiError.make({
								module: "McpAdapter",
								method: "call",
								reason: new AiError.ToolParameterValidationError({
									toolName: tool.name,
									description: error.message,
								}),
							}),
						),
						Effect.flatMap(dispatch),
						Effect.matchEffect({
							onFailure: (error) => failure(error, input),
							onSuccess: format,
						}),
					),
				),
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
	const toolsByName = new Map(
		Array.map(input.tools, (tool) => [tool.definition.name, tool] as const),
	);

	server.setRequestHandler(ListToolsRequestSchema, () => ({
		tools: Array.map(input.tools, (tool) => tool.definition),
	}));
	server.setRequestHandler(CallToolRequestSchema, (request) => {
		const tool = toolsByName.get(request.params.name);
		return tool
			? tool.call(request.params.arguments ?? {})
			: invalidParamsToolError(`Tool ${request.params.name} not found`);
	});

	return server;
}
