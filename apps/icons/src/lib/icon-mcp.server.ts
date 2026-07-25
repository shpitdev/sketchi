import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { withCors } from "./cors-policy.js";
import {
  getIconDetail,
  parseIconLimit,
  searchIconResults,
} from "./icon-api.server.js";
import type { IconSourceLoader } from "./icon-catalog.server.js";

const SEARCH_ICONS_TOOL = {
  annotations: {
    idempotentHint: true,
    openWorldHint: false,
    readOnlyHint: true,
  },
  description:
    "Search Sketchi icons by slug, name, alias, keyword, or collection. Results are ranked and include stable SVG and JSON URLs.",
  inputSchema: {
    additionalProperties: false,
    properties: {
      collection: {
        description: "Optional collection slug to filter by.",
        type: "string",
      },
      limit: {
        description: "Maximum results from 1 to 100. Defaults to 50.",
        maximum: 100,
        minimum: 1,
        type: "integer",
      },
      q: {
        description: "Search text. Aliases such as k8s and psql are supported.",
        type: "string",
      },
    },
    type: "object",
  },
  name: "search_icons",
  title: "Search Sketchi icons",
};

const GET_ICON_TOOL = {
  annotations: {
    idempotentHint: true,
    openWorldHint: false,
    readOnlyHint: true,
  },
  description:
    "Get one Sketchi icon by its public slug. The first text block is the raw SVG source.",
  inputSchema: {
    additionalProperties: false,
    properties: {
      slug: {
        description: "Exact public icon slug from search_icons.",
        minLength: 1,
        type: "string",
      },
    },
    required: ["slug"],
    type: "object",
  },
  name: "get_icon",
  title: "Get a Sketchi icon",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(
  input: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = input[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function invalidArguments(message: string) {
  return {
    content: [{ text: message, type: "text" as const }],
    isError: true,
  };
}

function jsonToolResult(value: Record<string, unknown>) {
  return {
    content: [{ text: JSON.stringify(value, null, 2), type: "text" as const }],
    structuredContent: value,
  };
}

export interface IconMcpServerOptions {
  readonly origin?: string;
  readonly sourceLoader: IconSourceLoader;
}

export function createIconMcpServer(options: IconMcpServerOptions): Server {
  const origin = options.origin ?? "https://icons.sketchi.app";
  const sourceLoader = options.sourceLoader;
  const server = new Server(
    { name: "sketchi-icons", version: "1.0.0" },
    { capabilities: { tools: { listChanged: false } } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [SEARCH_ICONS_TOOL, GET_ICON_TOOL],
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const input = isRecord(request.params.arguments)
      ? request.params.arguments
      : {};

    if (request.params.name === "search_icons") {
      const limitValue = input.limit;
      if (
        limitValue !== undefined &&
        (typeof limitValue !== "number" ||
          !Number.isInteger(limitValue) ||
          limitValue < 1 ||
          limitValue > 100)
      ) {
        return invalidArguments("limit must be an integer from 1 to 100.");
      }
      const q = optionalString(input, "q");
      const collection = optionalString(input, "collection");
      const result = searchIconResults({
        ...(collection ? { collection } : {}),
        limit: parseIconLimit(
          typeof limitValue === "number" ? String(limitValue) : null,
        ),
        origin,
        ...(q ? { query: q } : {}),
      });
      return jsonToolResult(result);
    }

    if (request.params.name === "get_icon") {
      const slug = optionalString(input, "slug");
      if (!slug) {
        return invalidArguments("slug is required.");
      }
      const detail = await getIconDetail(
        new Request(origin),
        slug,
        sourceLoader,
      );
      if (!detail) {
        return invalidArguments(`Icon ${slug} was not found.`);
      }
      return {
        content: [
          { text: detail.svg, type: "text" as const },
          {
            text: `Permanent SVG URL: ${detail.svgUrl}`,
            type: "text" as const,
          },
        ],
        structuredContent: detail,
      };
    }

    return invalidArguments(`Tool ${request.params.name} was not found.`);
  });

  return server;
}

export async function handleIconMcpRequest(
  request: Request,
  sourceLoader: IconSourceLoader,
): Promise<Response> {
  const { createMcpHandler } = await import("agents/mcp");
  const handler = createMcpHandler(
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
