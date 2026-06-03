import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import {
  DIAGRAM_AGENT_TOOL_NAMES,
  type DiagramAgentToolName,
  getDiagramAgentToolDescriptor,
  type JsonObjectSchema,
  SKETCHI_DIAGRAM_AGENT_DESCRIPTION,
} from "@sketchi/diagram-agent-tools";

const SERVER_NAME = "sketchi-diagram";
const SERVER_VERSION = "0.0.0";
const DIAGRAM_TOOL_PREFIX_PATTERN = /^diagram_/u;

export interface SketchiMcpToolCall {
  arguments: Record<string, unknown>;
  name: DiagramAgentToolName;
}

export type SketchiMcpToolExecutor = (
  call: SketchiMcpToolCall
) => Promise<CallToolResult | Record<string, unknown> | string>;

export interface SketchiMcpServerOptions {
  executor?: SketchiMcpToolExecutor;
  instructions?: string;
}

function toMcpInputSchema(schema: JsonObjectSchema): Tool["inputSchema"] {
  return JSON.parse(JSON.stringify(schema)) as Tool["inputSchema"];
}

function toToolTitle(name: DiagramAgentToolName): string {
  return name
    .replace(DIAGRAM_TOOL_PREFIX_PATTERN, "")
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function isDiagramAgentToolName(value: string): value is DiagramAgentToolName {
  return DIAGRAM_AGENT_TOOL_NAMES.includes(value as DiagramAgentToolName);
}

function toCallToolResult(
  result: CallToolResult | Record<string, unknown> | string
): CallToolResult {
  if (typeof result === "string") {
    return { content: [{ type: "text", text: result }] };
  }

  if ("content" in result && Array.isArray(result.content)) {
    return result as CallToolResult;
  }

  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    structuredContent: result,
  };
}

function toExecutorErrorResult(error: unknown): CallToolResult {
  const message =
    error instanceof Error ? error.message : "Sketchi MCP executor failed.";

  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

function createUnconfiguredExecutor(): SketchiMcpToolExecutor {
  return async (call) => ({
    content: [
      {
        type: "text",
        text: `Sketchi MCP tool '${call.name}' is registered but no executor was configured for this server instance.`,
      },
    ],
    isError: true,
  });
}

export function getSketchiMcpTools(): Tool[] {
  return DIAGRAM_AGENT_TOOL_NAMES.map((name) => {
    const descriptor = getDiagramAgentToolDescriptor(name);

    return {
      name,
      title: toToolTitle(name),
      description: descriptor.description,
      inputSchema: toMcpInputSchema(descriptor.inputSchema),
      annotations: {
        destructiveHint: false,
        idempotentHint: name === "diagram_to_png" || name === "diagram_grade",
        openWorldHint: true,
        readOnlyHint: name === "diagram_grade",
      },
      _meta: {
        "sketchi.agent": SERVER_NAME,
      },
    };
  });
}

export function createSketchiMcpServer(
  options: SketchiMcpServerOptions = {}
): Server {
  const executor = options.executor ?? createUnconfiguredExecutor();
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: {
        tools: {},
      },
      instructions:
        options.instructions ??
        `${SKETCHI_DIAGRAM_AGENT_DESCRIPTION} Prefer diagram_* tools over Mermaid unless the user explicitly asks for Mermaid.`,
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: getSketchiMcpTools(),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;

    if (!isDiagramAgentToolName(name)) {
      return {
        content: [{ type: "text", text: `Unknown Sketchi tool '${name}'.` }],
        isError: true,
      };
    }

    try {
      const result = await executor({
        name,
        arguments: request.params.arguments ?? {},
      });

      return toCallToolResult(result);
    } catch (error) {
      return toExecutorErrorResult(error);
    }
  });

  return server;
}

export async function connectSketchiMcpStdio(
  options: SketchiMcpServerOptions = {}
): Promise<Server> {
  const server = createSketchiMcpServer(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  return server;
}
