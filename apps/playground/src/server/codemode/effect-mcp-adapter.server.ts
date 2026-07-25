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
import { Result, Schema, SchemaAST, SchemaIssue, SchemaParser } from "effect";

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

/**
 * MCP SDK 1.29's high-level server only accepts Zod. This is the one thin
 * compatibility adapter for that framework edge: Effect remains responsible
 * for validation and schema generation while this function translates the
 * generated document to the MCP SDK's Draft-07 object-schema shape.
 */
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
  const { additionalProperties: _additionalProperties, ...openRoot } =
    converted;
  const result = options.openRoot ? openRoot : converted;
  if (!isMcpObjectJsonSchema(result)) {
    throw new Error("MCP tool schemas must encode JSON objects.");
  }
  return result;
}

interface McpValidationIssue {
  readonly code: string;
  readonly format?: string;
  readonly inclusive?: boolean;
  readonly expected?: string;
  readonly maximum?: number;
  readonly message: string;
  readonly minimum?: number;
  readonly origin?: string;
  readonly path: ReadonlyArray<PropertyKey>;
  readonly values?: ReadonlyArray<unknown>;
}

function actualType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function expectedType(ast: SchemaAST.AST): string {
  if (SchemaAST.isString(ast)) return "string";
  if (SchemaAST.isNumber(ast)) return "number";
  if (SchemaAST.isBoolean(ast)) return "boolean";
  if (SchemaAST.isArrays(ast)) return "array";
  if (SchemaAST.isObjects(ast)) return "object";
  return "value";
}

function astAtPath(
  ast: SchemaAST.AST | undefined,
  path: ReadonlyArray<PropertyKey>,
): SchemaAST.AST | undefined {
  if (ast === undefined || path.length === 0) return ast;
  if (!SchemaAST.isObjects(ast)) return undefined;
  const property = ast.propertySignatures.find(
    (candidate) => candidate.name === path[0],
  );
  return property === undefined
    ? undefined
    : astAtPath(property.type, path.slice(1));
}

function invalidTypeIssue(
  expected: string,
  path: ReadonlyArray<PropertyKey>,
  format?: string,
): McpValidationIssue {
  return format === undefined
    ? {
        expected,
        code: "invalid_type",
        path,
        message: "Invalid input",
      }
    : {
        expected,
        format,
        code: "invalid_type",
        path,
        message: "Invalid input",
      };
}

function literalValues(ast: SchemaAST.AST): ReadonlyArray<unknown> | undefined {
  if (SchemaAST.isLiteral(ast)) return [ast.literal];
  if (!SchemaAST.isUnion(ast)) return undefined;
  const values: Array<unknown> = [];
  for (const member of ast.types) {
    if (!SchemaAST.isLiteral(member)) return undefined;
    values.push(member.literal);
  }
  return values;
}

function issueForAst(
  ast: SchemaAST.AST,
  path: ReadonlyArray<PropertyKey>,
): McpValidationIssue {
  const values = literalValues(ast);
  return values === undefined
    ? invalidTypeIssue(expectedType(ast), path)
    : {
        code: "invalid_value",
        values,
        path,
        message: "Invalid input",
      };
}

function numberField(
  value: Record<string, unknown>,
  key: string,
): number | undefined {
  const field = value[key];
  return typeof field === "number" ? field : undefined;
}

function filterIssue(
  issue: SchemaIssue.Filter,
  path: ReadonlyArray<PropertyKey>,
): McpValidationIssue {
  const message = "Invalid input";
  const metadata = issue.filter.annotations?.meta;
  if (!isRecord(metadata) || typeof metadata._tag !== "string") {
    return { code: "custom", path, message };
  }

  const origin = actualType(issue.actual);
  switch (metadata._tag) {
    case "isInt":
      return invalidTypeIssue("int", path, "safeint");
    case "isFinite":
      return invalidTypeIssue("number", path);
    case "isMinLength": {
      const minimum = numberField(metadata, "minLength");
      return minimum === undefined
        ? { code: "custom", path, message }
        : {
            origin,
            code: "too_small",
            minimum,
            inclusive: true,
            path,
            message,
          };
    }
    case "isMaxLength": {
      const maximum = numberField(metadata, "maxLength");
      return maximum === undefined
        ? { code: "custom", path, message }
        : {
            origin,
            code: "too_big",
            maximum,
            inclusive: true,
            path,
            message,
          };
    }
    case "isGreaterThan":
    case "isGreaterThanOrEqualTo": {
      const minimum = numberField(metadata, "minimum");
      return minimum === undefined
        ? { code: "custom", path, message }
        : {
            origin,
            code: "too_small",
            minimum,
            inclusive: metadata._tag === "isGreaterThanOrEqualTo",
            path,
            message,
          };
    }
    case "isLessThan":
    case "isLessThanOrEqualTo": {
      const maximum = numberField(metadata, "maximum");
      return maximum === undefined
        ? { code: "custom", path, message }
        : {
            origin,
            code: "too_big",
            maximum,
            inclusive: metadata._tag === "isLessThanOrEqualTo",
            path,
            message,
          };
    }
    default:
      return { code: "custom", path, message };
  }
}

function leafIssue(
  issue: SchemaIssue.Leaf,
  path: ReadonlyArray<PropertyKey>,
  ast: SchemaAST.AST | undefined,
): McpValidationIssue {
  switch (issue._tag) {
    case "InvalidType":
      return issueForAst(issue.ast, path);
    case "MissingKey":
      return ast === undefined
        ? invalidTypeIssue("value", path)
        : issueForAst(ast, path);
    default:
      return {
        code: "custom",
        path,
        message: "Invalid input",
      };
  }
}

function validationIssues(
  issue: SchemaIssue.Issue,
  path: ReadonlyArray<PropertyKey> = [],
  ast?: SchemaAST.AST,
): ReadonlyArray<McpValidationIssue> {
  switch (issue._tag) {
    case "Filter":
      return [filterIssue(issue, path)];
    case "Encoding":
      return validationIssues(issue.issue, path, ast);
    case "Pointer":
      return validationIssues(
        issue.issue,
        [...path, ...issue.path],
        astAtPath(ast, issue.path),
      );
    case "Composite":
      return issue.issues.flatMap((child) =>
        validationIssues(child, path, issue.ast),
      );
    case "AnyOf":
      if (issue.issues.length > 0) {
        return issue.issues.flatMap((child) =>
          validationIssues(child, path, issue.ast),
        );
      }
      return [issueForAst(issue.ast, path)];
    default:
      return [leafIssue(issue, path, ast)];
  }
}

function validationIssuesText(issues: readonly McpValidationIssue[]): string {
  return JSON.stringify(issues, null, 2);
}

function decodeEffectSchema<
  InputSchema extends Schema.ConstraintDecoder<unknown>,
>(
  schema: PlaygroundStandardSchema<InputSchema>,
  input: unknown,
):
  | { readonly issues: ReadonlyArray<McpValidationIssue> }
  | { readonly value: InputSchema["Type"] } {
  const result = SchemaParser.decodeUnknownResult(schema, {
    errors: "all",
  })(input);
  return Result.isFailure(result)
    ? { issues: validationIssues(result.failure) }
    : { value: result.success };
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

function makeEffectTool<
  InputSchema extends Schema.ConstraintDecoder<unknown>,
  OutputSchema extends Schema.ConstraintDecoder<unknown>,
>(
  name: string,
  config: EffectMcpToolConfig<InputSchema, OutputSchema>,
  handler: (
    input: InputSchema["Type"],
  ) => CallToolResult | Promise<CallToolResult>,
): RegisteredEffectTool {
  return {
    definition: {
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
    },
    call: async (input) => {
      const decodedInput = decodeEffectSchema(config.inputSchema, input);
      if ("issues" in decodedInput) {
        return invalidParamsToolError(
          `Input validation error: Invalid arguments for tool ${name}: ${validationIssuesText(decodedInput.issues)}`,
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

        const decodedOutput = decodeEffectSchema(
          config.outputSchema,
          result.structuredContent,
        );
        return "issues" in decodedOutput
          ? invalidParamsToolError(
              `Output validation error: Invalid structured content for tool ${name}: ${validationIssuesText(decodedOutput.issues)}`,
            )
          : result;
      } catch (error) {
        return toolError(
          error instanceof Error ? error.message : String(error),
        );
      }
    },
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
    input.tools.map((tool) => [tool.definition.name, tool]),
  );

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

export const defineEffectMcpTool = makeEffectTool;
