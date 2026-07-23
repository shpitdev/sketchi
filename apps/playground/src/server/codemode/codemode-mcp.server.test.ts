import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { describe, expect, it } from "vitest";
import { Context, Effect, Option, Schema } from "effect";

import type {
  CodeModeObjectBucket,
  CodeModeObjectBucketObject,
} from "@sketchi/diagram-agent";

import type { StudioEnv } from "../bindings/studio-env.server";
import { PlaygroundRequestMetadata } from "../runtime/playground-context.server";
import {
  PlaygroundRequestCallbacks,
  runPlaygroundEffect,
} from "../runtime/playground-runtime.server";
import { toPlaygroundStandardSchema } from "../schema/effect-standard-schema.server";
import { PlaygroundCodeMode } from "./codemode-service.server";
import {
  createEffectMcpServer,
  defineEffectMcpTool,
} from "./effect-mcp-adapter.server";
import {
  createSketchiMcpServer as createSketchiMcpServerEffect,
  executeSketchiCodeMode as executeSketchiCodeModeEffect,
  handleSketchiMcpRequest as handleSketchiMcpRequestEffect,
  makeSketchiCodeModeProvider,
  normalizeSketchiExecuteCode,
  type CodeModeMcpOptions,
  type SketchiCodeModeExecutor,
  type SketchiCodeModeProvider,
} from "./codemode-mcp.server";

function testBoundary(env: StudioEnv, request: Request) {
  return {
    env,
    request,
    platform: {
      waitUntilPromise: (promise: Promise<unknown>) => {
        void promise;
      },
    },
  };
}

function createSketchiMcpServer(
  env: StudioEnv,
  options: CodeModeMcpOptions & { origin?: string; request?: Request } = {},
) {
  const request =
    options.request ??
    new Request(`${options.origin ?? "https://studio.test"}/mcp`, {
      method: "POST",
    });
  return runPlaygroundEffect(
    Effect.gen(function* () {
      const callbacks = yield* PlaygroundRequestCallbacks;
      return createSketchiMcpServerEffect(
        callbacks.runPromise,
        options.executor ? { executor: options.executor } : {},
      );
    }),
    testBoundary(env, request),
  );
}

function executeSketchiCodeMode(
  env: StudioEnv,
  input: unknown,
  options: CodeModeMcpOptions & { origin?: string; request?: Request } = {},
) {
  const request =
    options.request ??
    new Request(`${options.origin ?? "https://studio.test"}/mcp`, {
      method: "POST",
    });
  const boundary = testBoundary(env, request);
  return runPlaygroundEffect(
    Effect.gen(function* () {
      const callbacks = yield* PlaygroundRequestCallbacks;
      return yield* executeSketchiCodeModeEffect(
        input,
        callbacks.runPromise,
        options.executor ? { executor: options.executor } : {},
      );
    }),
    boundary,
  );
}

function handleSketchiMcpRequest(
  env: StudioEnv,
  request: Request,
  options: CodeModeMcpOptions = {},
) {
  const boundary = testBoundary(env, request);
  return runPlaygroundEffect(
    handleSketchiMcpRequestEffect(request, options),
    boundary,
  );
}

const CIRCLE_TO_DIAMOND_CODE = `async () => {
  const built = await sketchi.buildFlowchart({
    spec: {
      title: "Harness MCP proof flow",
      nodes: [
        { id: "start", label: "Start", kind: "start" },
        { id: "choice", label: "Continue?", kind: "decision" },
        { id: "yes", label: "Continue", kind: "end" },
        { id: "no", label: "Stop", kind: "end" },
      ],
      edges: [
        { source: "start", target: "choice" },
        { source: "choice", target: "yes", label: "yes" },
        { source: "choice", target: "no", label: "no" },
      ],
      layout: { direction: "LR" },
    },
  });

  if (!built.ok) return built;

  const patched = await sketchi.applyDiagramPatch({
    source: { artifactId: built.artifact.artifactId },
    operations: [
      { op: "setShape", selector: { nodeIds: ["start"] }, shape: "circle" },
      { op: "setShape", selector: { nodeIds: ["choice"] }, shape: "diamond" },
      {
        op: "setStyle",
        selector: { nodeIds: ["choice"] },
        style: { strokeColor: "#7c3aed", fillColor: "#ede9fe" },
      },
    ],
    options: {
      artifactFormats: ["scene", "excalidraw"],
      inlineArtifacts: ["excalidraw"],
    },
  });

  if (!patched.ok) return patched;

  return sketchi.getArtifact({
    artifactId: patched.artifact.artifactId,
    format: "excalidraw",
    inline: true,
  });
}`;

const BUILD_MINDMAP_CODE = `async () => sketchi.buildMindmap({
  spec: {
    title: "Code Mode mindmap",
    root: { label: "Mindmap", children: [
      { label: "Branches", children: [{ label: "Depth" }] },
      { label: "Artifacts", children: [{ label: "Excalidraw" }] }
    ] }
  }
})`;

const BUILD_SEQUENCE_CODE = `async () => sketchi.buildSequenceDiagram({
  spec: {
    title: "Request sequence",
    participants: [
      { id: "client", label: "Client" },
      { id: "api", label: "API" },
      { id: "store", label: "Store" }
    ],
    messages: [
      { source: "client", target: "api", label: "Request" },
      { source: "api", target: "store", label: "Read" }
    ]
  }
})`;

const ACCEPTED_ARTIFACT_WITHOUT_URLS_CODE = `async () => ({
  ok: true,
  status: "accepted",
  artifact: {
    artifactId: "artifact_without_urls",
    diagramId: "diagram_without_urls",
    formats: [
      {
        format: "scene",
        mimeType: "application/vnd.sketchi.scene+json",
        sizeBytes: 100
      },
      {
        format: "excalidraw",
        mimeType: "application/vnd.excalidraw+json",
        sizeBytes: 200
      },
      {
        format: "png",
        mimeType: "image/png",
        sizeBytes: 300
      }
    ]
  }
})`;

const ACCEPTED_ARTIFACT_WITH_MIXED_URLS_CODE = `async () => ({
  ok: true,
  status: "accepted",
  artifact: {
    artifactId: "artifact_mixed_urls",
    diagramId: "diagram_mixed_urls",
    formats: [
      {
        format: "scene",
        mimeType: "application/vnd.sketchi.scene+json",
        sizeBytes: 100
      },
      {
        format: "excalidraw",
        mimeType: "application/vnd.excalidraw+json",
        sizeBytes: 200,
        url: "https://custom.test/excalidraw"
      },
      {
        format: "png",
        mimeType: "image/png",
        sizeBytes: 300
      }
    ]
  }
})`;

function createInProcessExecutor(): SketchiCodeModeExecutor {
  return {
    async execute(code: string, providers: SketchiCodeModeProvider[]) {
      const namespaces = Object.fromEntries(
        providers.map((provider) => [provider.name, provider.fns]),
      );
      const names = Object.keys(namespaces);
      const values = Object.values(namespaces);
      const logs: string[] = [];
      const sandboxConsole = {
        log: (...args: unknown[]) => logs.push(args.map(String).join(" ")),
      };

      try {
        const source = code.trim().replace(/;+\s*$/, "");
        const run = new Function(
          ...names,
          "console",
          `"use strict"; return (${source})();`,
        );
        return {
          result: await run(...values, sandboxConsole),
          logs,
        };
      } catch (error) {
        return {
          result: null,
          error: error instanceof Error ? error.message : String(error),
          logs,
        };
      }
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function structuredContent(response: unknown): Record<string, unknown> {
  if (!isRecord(response) || !isRecord(response.structuredContent)) {
    throw new Error("MCP response did not include structured content.");
  }

  return response.structuredContent;
}

function textContent(response: unknown): string[] {
  if (!isRecord(response) || !Array.isArray(response.content)) {
    throw new Error("MCP response did not include content.");
  }

  return response.content.flatMap((item) => {
    if (
      !isRecord(item) ||
      item.type !== "text" ||
      typeof item.text !== "string"
    ) {
      return [];
    }
    return [item.text];
  });
}

class MemoryBucket implements CodeModeObjectBucket {
  readonly objects = new Map<string, string | Uint8Array>();

  async get(key: string): Promise<CodeModeObjectBucketObject | null> {
    const value = this.objects.get(key);
    if (!value) {
      return null;
    }
    const bytes =
      typeof value === "string" ? new TextEncoder().encode(value) : value;

    return {
      size: bytes.byteLength,
      arrayBuffer: async () => toArrayBuffer(bytes),
      text: async () =>
        typeof value === "string" ? value : new TextDecoder().decode(value),
    };
  }

  async put(
    key: string,
    value: string | ArrayBuffer | Uint8Array,
  ): Promise<unknown> {
    this.objects.set(
      key,
      typeof value === "string" ? value : new Uint8Array(value),
    );
    return null;
  }
}

class MemoryPipeline {
  readonly batches: unknown[][] = [];

  async send(records: readonly unknown[]): Promise<void> {
    this.batches.push([...records]);
  }

  records(): unknown[] {
    return this.batches.flat();
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

async function readBucketJson(
  bucket: MemoryBucket,
  key: string,
): Promise<unknown> {
  const object = await bucket.get(key);
  return JSON.parse((await object?.text()) ?? "{}");
}

async function usageEventsFrom(bucket: MemoryBucket): Promise<unknown[]> {
  const eventKeys = [...bucket.objects.keys()]
    .filter((key) => key.startsWith("codemode/usage/"))
    .filter((key) => key.endsWith("/event.json"))
    .sort();

  return Promise.all(eventKeys.map((key) => readBucketJson(bucket, key)));
}

async function waitForUsageEvents(
  bucket: MemoryBucket,
  count: number,
): Promise<unknown[]> {
  const deadline = Date.now() + 1_000;

  while (Date.now() < deadline) {
    const events = await usageEventsFrom(bucket);
    if (events.length >= count) {
      return events;
    }
    await delay(5);
  }

  throw new Error(`Expected ${count} usage event(s) to be persisted.`);
}

async function waitForPipelineRecords(
  pipeline: MemoryPipeline,
  count: number,
): Promise<unknown[]> {
  const deadline = Date.now() + 1_000;

  while (Date.now() < deadline) {
    const records = pipeline.records();
    if (records.length >= count) {
      return records;
    }
    await delay(5);
  }

  throw new Error(`Expected ${count} pipeline record(s) to be sent.`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function createMcpFetch(
  options: CodeModeMcpOptions,
  env: StudioEnv = {},
): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    return handleSketchiMcpRequest(env, request, options);
  };
}

describe("Sketchi Code Mode MCP server", () => {
  it("preserves the MCP request trace in provider callbacks", async () => {
    let callbackContext:
      | {
          parentSpanId: string | undefined;
          spanId: string;
          spanName: string;
          spanTraceId: string;
          traceId: string;
        }
      | undefined;
    const observeContext = Effect.gen(function* () {
      const metadata = yield* PlaygroundRequestMetadata;
      const span = yield* Effect.currentSpan;
      const parent = Option.getOrUndefined(span.parent);
      return {
        parentSpanId: parent?.spanId,
        spanName: span.name,
        spanId: span.spanId,
        spanTraceId: span.traceId,
        traceId: metadata.traceId,
      };
    });
    const codeMode = {
      buildFlowchart: () =>
        observeContext.pipe(
          Effect.tap((context) =>
            Effect.sync(() => {
              callbackContext = context;
            }),
          ),
          Effect.as({
            ok: false as const,
            status: "invalid_input" as const,
            issues: [],
          }),
        ),
    } as unknown as Context.Service.Shape<typeof PlaygroundCodeMode>;
    const request = new Request("https://studio.test/mcp", {
      headers: { "x-sketchi-trace-id": "trace-mcp-provider" },
      method: "POST",
    });

    const root = await runPlaygroundEffect(
      Effect.gen(function* () {
        const callbacks = yield* PlaygroundRequestCallbacks;
        const requestContext = yield* observeContext;
        const provider = makeSketchiCodeModeProvider(
          codeMode,
          callbacks.runPromise,
        );
        const buildFlowchart = provider.fns.buildFlowchart;
        if (!buildFlowchart) {
          throw new Error("MCP provider did not expose buildFlowchart.");
        }
        return {
          callback: buildFlowchart({ spec: {} }),
          requestContext,
        };
      }),
      testBoundary({}, request),
    );

    await root.callback;
    expect(callbackContext?.spanTraceId).toBe(root.requestContext.spanTraceId);
    expect(callbackContext?.parentSpanId).toBe(root.requestContext.spanId);
    expect(callbackContext?.spanName).toBe("playground.request.callback");
    expect(callbackContext?.traceId).toBe("trace-mcp-provider");
  });

  it("exposes buildMindmap inside the Code Mode namespace", async () => {
    const result = await executeSketchiCodeMode(
      {},
      { code: BUILD_MINDMAP_CODE },
      { executor: createInProcessExecutor() },
    );
    expect(result).toMatchObject({
      ok: true,
      result: {
        ok: true,
        status: "accepted",
        normalizedSpec: { root: { id: "topic-0" } },
      },
    });
  });
  it("exposes buildSequenceDiagram inside the Code Mode namespace", async () => {
    const result = await executeSketchiCodeMode(
      {},
      { code: BUILD_SEQUENCE_CODE },
      { executor: createInProcessExecutor() },
    );
    expect(result).toMatchObject({
      ok: true,
      result: {
        ok: true,
        status: "accepted",
        normalizedSpec: {
          participants: [{ id: "client" }, { id: "api" }, { id: "store" }],
        },
      },
    });
  });
  it("normalizes common LLM execute input wrappers", () => {
    expect(normalizeSketchiExecuteCode("async () => { return 1; };")).toBe(
      "async () => { return 1; }",
    );
    expect(
      normalizeSketchiExecuteCode("```js\nasync () => { return 1; };\n```"),
    ).toBe("async () => { return 1; }");
  });

  it("exposes docs, search, and execute tools through the MCP protocol", async () => {
    const client = new Client({
      name: "sketchi-codemode-test-client",
      version: "0.0.0",
    });
    const server = await createSketchiMcpServer(
      {},
      { executor: createInProcessExecutor() },
    );
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      await expect(client.ping()).resolves.toEqual({});

      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
        "docs",
        "execute",
        "search",
      ]);
      const executeTool = tools.tools.find((tool) => tool.name === "execute");
      expect(executeTool?.inputSchema).toMatchObject({
        properties: {
          code: { type: "string" },
        },
        required: ["code"],
        type: "object",
      });
      expect(executeTool?.description).toContain("Write JavaScript only");
      expect(executeTool?.description).toContain("async () =>");
      expect(executeTool?.description).toContain("artifactDelivery");
      expect(executeTool?.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      });
      expect(
        tools.tools.find((tool) => tool.name === "docs")?.outputSchema,
      ).toBeDefined();
      expect(
        tools.tools.find((tool) => tool.name === "search")?.outputSchema,
      ).toBeDefined();
      expect(
        tools.tools.find((tool) => tool.name === "execute")?.outputSchema,
      ).toBeDefined();
      const invalidSearch = await client.callTool({
        name: "search",
        arguments: { query: "", limit: 21 },
      });
      expect(invalidSearch).toEqual({
        isError: true,
        content: [
          {
            type: "text",
            text: `MCP error -32602: Input validation error: Invalid arguments for tool search: [
  {
    "origin": "string",
    "code": "too_small",
    "minimum": 1,
    "inclusive": true,
    "path": [
      "query"
    ],
    "message": "Invalid input"
  },
  {
    "origin": "number",
    "code": "too_big",
    "maximum": 20,
    "inclusive": true,
    "path": [
      "limit"
    ],
    "message": "Invalid input"
  }
]`,
          },
        ],
      });

      // These complete payloads were captured from the parent production MCP
      // Worker at playground.sketchi.app/mcp.
      const invalidExecuteType = await client.callTool({
        name: "execute",
        arguments: { code: 123 },
      });
      expect(invalidExecuteType).toEqual({
        content: [
          {
            type: "text",
            text: `MCP error -32602: Input validation error: Invalid arguments for tool execute: [
  {
    "expected": "string",
    "code": "invalid_type",
    "path": [
      "code"
    ],
    "message": "Invalid input"
  }
]`,
          },
        ],
        isError: true,
      });

      const missingExecuteCode = await client.callTool({
        name: "execute",
        arguments: {},
      });
      expect(missingExecuteCode).toEqual({
        content: [
          {
            type: "text",
            text: `MCP error -32602: Input validation error: Invalid arguments for tool execute: [
  {
    "expected": "string",
    "code": "invalid_type",
    "path": [
      "code"
    ],
    "message": "Invalid input"
  }
]`,
          },
        ],
        isError: true,
      });

      const invalidSearchLimit = await client.callTool({
        name: "search",
        arguments: { query: "diagram", limit: 1.5 },
      });
      expect(invalidSearchLimit).toEqual({
        content: [
          {
            type: "text",
            text: `MCP error -32602: Input validation error: Invalid arguments for tool search: [
  {
    "expected": "int",
    "format": "safeint",
    "code": "invalid_type",
    "path": [
      "limit"
    ],
    "message": "Invalid input"
  }
]`,
          },
        ],
        isError: true,
      });

      const invalidDocsTopic = await client.callTool({
        name: "docs",
        arguments: { topic: "bogus" },
      });
      expect(invalidDocsTopic).toEqual({
        content: [
          {
            type: "text",
            text: `MCP error -32602: Input validation error: Invalid arguments for tool docs: [
  {
    "code": "invalid_value",
    "values": [
      "overview",
      "execute",
      "buildFlowchart",
      "buildMindmap",
      "buildSequenceDiagram",
      "getArtifact",
      "applyDiagramPatch",
      "patchOperations",
      "agentSequence",
      "issues",
      "examples"
    ],
    "path": [
      "topic"
    ],
    "message": "Invalid input"
  }
]`,
          },
        ],
        isError: true,
      });

      const unknownTool = await client.callTool({
        name: "missing",
        arguments: {},
      });
      expect(unknownTool).toEqual({
        content: [
          {
            type: "text",
            text: "MCP error -32602: Tool missing not found",
          },
        ],
        isError: true,
      });

      const docs = structuredContent(
        await client.callTool({
          name: "docs",
          arguments: { topic: "agentSequence" },
        }),
      );
      expect(docs).toMatchObject({
        topic: "agentSequence",
      });
      expect(JSON.stringify(docs)).toContain("buildFlowchart");

      const search = structuredContent(
        await client.callTool({
          name: "search",
          arguments: { query: "managed convex threads" },
        }),
      );
      expect(JSON.stringify(search)).toContain("managed-thread-non-goal");

      const execute = structuredContent(
        await client.callTool({
          name: "execute",
          arguments: { code: CIRCLE_TO_DIAMOND_CODE },
        }),
      );
      expect(execute).toMatchObject({
        ok: true,
        result: {
          ok: true,
          format: "excalidraw",
          inline: {
            type: "excalidraw",
            version: 2,
          },
        },
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("preserves the complete parent rejection payload for invalid tool output", async () => {
    const invalidOutput = defineEffectMcpTool(
      "invalid-output",
      {
        title: "Invalid output fixture",
        description: "Exercises MCP output validation.",
        inputSchema: toPlaygroundStandardSchema(
          Schema.Struct({ ok: Schema.optionalKey(Schema.Boolean) }),
        ),
        outputSchema: toPlaygroundStandardSchema(
          Schema.Struct({ value: Schema.String }),
        ),
      },
      () => ({
        content: [{ type: "text", text: "invalid" }],
        structuredContent: { value: 1 },
      }),
    );
    const server = createEffectMcpServer({
      name: "effect-mcp-output-validation-test",
      tools: [invalidOutput],
      version: "0.0.0",
    });
    const client = new Client({
      name: "effect-mcp-output-validation-test-client",
      version: "0.0.0",
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const response = await client.callTool({
        name: "invalid-output",
        arguments: {},
      });
      // Captured from the parent high-level MCP adapter after bundling it with
      // the Playground Worker's production build pipeline.
      expect(response).toEqual({
        content: [
          {
            type: "text",
            text: `MCP error -32602: Output validation error: Invalid structured content for tool invalid-output: [
  {
    "expected": "string",
    "code": "invalid_type",
    "path": [
      "value"
    ],
    "message": "Invalid input"
  }
]`,
          },
        ],
        isError: true,
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("puts artifact delivery text first in execute content for harnesses", async () => {
    const client = new Client({
      name: "sketchi-codemode-delivery-text-test-client",
      version: "0.0.0",
    });
    const server = await createSketchiMcpServer(
      {},
      {
        executor: createInProcessExecutor(),
        origin: "https://studio.test",
      },
    );
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const response = await client.callTool({
        name: "execute",
        arguments: { code: ACCEPTED_ARTIFACT_WITHOUT_URLS_CODE },
      });
      const text = textContent(response);

      expect(text).toHaveLength(2);
      expect(text[0]).toBe(
        "Sketchi artifact ready.\nArtifact ID: artifact_without_urls\nDiagram ID: diagram_without_urls\nFormats: scene, excalidraw, png\nExcalidraw URL: https://studio.test/api/v1/artifacts/artifact_without_urls?format=excalidraw&raw=true\nPNG URL: https://studio.test/api/v1/artifacts/artifact_without_urls?format=png&raw=true",
      );
      expect(text[1]).toContain('"artifactDelivery"');
      expect(structuredContent(response)).toMatchObject({
        artifactDelivery: {
          artifactId: "artifact_without_urls",
          excalidrawUrl:
            "https://studio.test/api/v1/artifacts/artifact_without_urls?format=excalidraw&raw=true",
          pngUrl:
            "https://studio.test/api/v1/artifacts/artifact_without_urls?format=png&raw=true",
        },
        ok: true,
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("serves docs, search, and execute over the streamable HTTP MCP route", async () => {
    const client = new Client({
      name: "sketchi-codemode-http-test-client",
      version: "0.0.0",
    });
    const transport = new StreamableHTTPClientTransport(
      new URL("https://studio.test/mcp"),
      {
        fetch: createMcpFetch({ executor: createInProcessExecutor() }),
      },
    );

    try {
      await client.connect(transport as unknown as Transport);

      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
        "docs",
        "execute",
        "search",
      ]);

      const docs = structuredContent(
        await client.callTool({
          name: "docs",
          arguments: { topic: "execute" },
        }),
      );
      expect(JSON.stringify(docs)).toContain("sketchi.applyDiagramPatch");

      const execute = structuredContent(
        await client.callTool({
          name: "execute",
          arguments: { code: CIRCLE_TO_DIAMOND_CODE },
        }),
      );
      expect(execute).toMatchObject({
        ok: true,
        result: {
          ok: true,
          format: "excalidraw",
          inline: {
            type: "excalidraw",
            version: 2,
          },
          url: expect.stringContaining("https://studio.test/api/v1/artifacts/"),
        },
      });
    } finally {
      await client.close();
    }
  });

  it("returns structured execute errors instead of throwing tool failures", async () => {
    await expect(
      executeSketchiCodeMode({}, {}, { executor: createInProcessExecutor() }),
    ).resolves.toMatchObject({
      ok: false,
      logs: [],
    });

    const result = await executeSketchiCodeMode(
      {},
      {
        code: `async () => {
          throw new Error("generated code failed");
        }`,
      },
      { executor: createInProcessExecutor() },
    );

    expect(result).toEqual({
      ok: false,
      error: "generated code failed",
      logs: [],
      result: null,
    });
  });

  it("accepts execute code with a trailing arrow-function semicolon", async () => {
    const result = await executeSketchiCodeMode(
      {},
      {
        code: `${CIRCLE_TO_DIAMOND_CODE};`,
      },
      { executor: createInProcessExecutor() },
    );

    expect(result).toMatchObject({
      ok: true,
      result: {
        ok: true,
        format: "excalidraw",
      },
    });
  });

  it("adds artifactDelivery when generated code returns an accepted artifact bundle", async () => {
    const result = await executeSketchiCodeMode(
      {},
      {
        code: `async () => ({
          ok: true,
          status: "accepted",
          artifact: {
            artifactId: "artifact_delivery",
            diagramId: "diagram_delivery",
            formats: [
              {
                format: "scene",
                mimeType: "application/vnd.sketchi.scene+json",
                url: "https://studio.test/api/v1/artifacts/artifact_delivery?format=scene&raw=true"
              },
              {
                format: "excalidraw",
                mimeType: "application/vnd.excalidraw+json",
                sizeBytes: 1234,
                url: "https://studio.test/api/v1/artifacts/artifact_delivery?format=excalidraw&raw=true"
              },
              {
                format: "png",
                mimeType: "image/png",
                sizeBytes: 5678,
                url: "https://studio.test/api/v1/artifacts/artifact_delivery?format=png&raw=true"
              }
            ]
          }
        })`,
      },
      { executor: createInProcessExecutor() },
    );

    expect(result).toMatchObject({
      artifactDelivery: {
        artifactId: "artifact_delivery",
        diagramId: "diagram_delivery",
        excalidrawUrl:
          "https://studio.test/api/v1/artifacts/artifact_delivery?format=excalidraw&raw=true",
        finalResponseText:
          "Sketchi artifact ready.\nArtifact ID: artifact_delivery\nDiagram ID: diagram_delivery\nFormats: scene, excalidraw, png\nExcalidraw URL: https://studio.test/api/v1/artifacts/artifact_delivery?format=excalidraw&raw=true\nPNG URL: https://studio.test/api/v1/artifacts/artifact_delivery?format=png&raw=true",
        formats: [
          {
            format: "scene",
          },
          {
            format: "excalidraw",
            mimeType: "application/vnd.excalidraw+json",
            sizeBytes: 1234,
          },
          {
            format: "png",
            mimeType: "image/png",
            sizeBytes: 5678,
          },
        ],
        pngUrl:
          "https://studio.test/api/v1/artifacts/artifact_delivery?format=png&raw=true",
        sceneUrl:
          "https://studio.test/api/v1/artifacts/artifact_delivery?format=scene&raw=true",
      },
      finalResponseText:
        "Sketchi artifact ready.\nArtifact ID: artifact_delivery\nDiagram ID: diagram_delivery\nFormats: scene, excalidraw, png\nExcalidraw URL: https://studio.test/api/v1/artifacts/artifact_delivery?format=excalidraw&raw=true\nPNG URL: https://studio.test/api/v1/artifacts/artifact_delivery?format=png&raw=true",
      ok: true,
    });
    expect(result.artifactDelivery?.finalResponseInstruction).toContain(
      "Paste artifactDelivery.finalResponseText",
    );
  });

  it("captures MCP execute usage events in the artifact bucket", async () => {
    const bucket = new MemoryBucket();
    const usageEventsPipeline = new MemoryPipeline();
    const request = new Request("https://studio.test/mcp", {
      method: "POST",
      headers: {
        "user-agent": "agy-test",
        "x-sketchi-harness": "agy",
        "x-sketchi-model": "gemini-3.5-flash",
        "x-sketchi-reasoning-level": "medium",
        "x-sketchi-scenario-id": "scenario-approval",
      },
    });

    const result = await executeSketchiCodeMode(
      {
        CODEMODE_USAGE_EVENTS: usageEventsPipeline,
        SKETCHI_ARTIFACTS: bucket,
      },
      {
        code: ACCEPTED_ARTIFACT_WITHOUT_URLS_CODE,
      },
      {
        executor: createInProcessExecutor(),
        origin: "https://studio.test",
        request,
      },
    );

    expect(result).toMatchObject({
      artifactDelivery: {
        artifactId: "artifact_without_urls",
      },
      ok: true,
    });

    const usageEvents = await waitForUsageEvents(bucket, 1);
    expect(usageEvents).toHaveLength(1);
    expect(usageEvents[0]).toMatchObject({
      artifactRefs: [
        {
          artifactId: "artifact_without_urls",
          diagramId: "diagram_without_urls",
        },
      ],
      client: {
        harness: "agy",
        model: "gemini-3.5-flash",
        reasoningLevel: "medium",
        scenarioId: "scenario-approval",
        userAgent: "agy-test",
      },
      operation: "execute",
      request: {
        method: "POST",
        path: "/mcp",
      },
      schema: "sketchi.codemode.usage.v1",
      status: "ok",
      surface: "mcp",
    });
    if (!isRecord(usageEvents[0]) || !isRecord(usageEvents[0].request)) {
      throw new Error("Usage event did not include request metadata.");
    }
    if (!isRecord(usageEvents[0].request.body)) {
      throw new Error("Usage event did not include a request snapshot.");
    }
    expect(usageEvents[0].request.body.value).toMatchObject({
      code: ACCEPTED_ARTIFACT_WITHOUT_URLS_CODE,
    });

    const eventRows = await waitForPipelineRecords(usageEventsPipeline, 1);
    expect(eventRows[0]).toMatchObject({
      artifact_count: 1,
      artifact_delivery: true,
      artifact_formats: "scene,excalidraw,png",
      harness: "agy",
      issue_count: 0,
      model: "gemini-3.5-flash",
      operation: "execute",
      reasoning_level: "medium",
      request_method: "POST",
      request_path: "/mcp",
      scenario_id: "scenario-approval",
      schema: "sketchi.codemode.usage.v1",
      status: "ok",
      surface: "mcp",
      user_agent: "agy-test",
    });
    if (!isRecord(eventRows[0])) {
      throw new Error("Usage pipeline event row was not an object.");
    }
    expect(eventRows[0].event_key).toMatch(/^codemode\/usage\//);
    expect(eventRows[0].event_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("synthesizes artifactDelivery URLs from the MCP origin when formats omit URLs", async () => {
    const result = await executeSketchiCodeMode(
      {},
      {
        code: ACCEPTED_ARTIFACT_WITHOUT_URLS_CODE,
      },
      {
        executor: createInProcessExecutor(),
        origin: "https://studio.test",
      },
    );

    expect(result).toMatchObject({
      artifactDelivery: {
        artifactId: "artifact_without_urls",
        diagramId: "diagram_without_urls",
        excalidrawUrl:
          "https://studio.test/api/v1/artifacts/artifact_without_urls?format=excalidraw&raw=true",
        finalResponseText:
          "Sketchi artifact ready.\nArtifact ID: artifact_without_urls\nDiagram ID: diagram_without_urls\nFormats: scene, excalidraw, png\nExcalidraw URL: https://studio.test/api/v1/artifacts/artifact_without_urls?format=excalidraw&raw=true\nPNG URL: https://studio.test/api/v1/artifacts/artifact_without_urls?format=png&raw=true",
        formats: [
          {
            format: "scene",
            url: "https://studio.test/api/v1/artifacts/artifact_without_urls?format=scene&raw=true",
          },
          {
            format: "excalidraw",
            url: "https://studio.test/api/v1/artifacts/artifact_without_urls?format=excalidraw&raw=true",
          },
          {
            format: "png",
            url: "https://studio.test/api/v1/artifacts/artifact_without_urls?format=png&raw=true",
          },
        ],
        pngUrl:
          "https://studio.test/api/v1/artifacts/artifact_without_urls?format=png&raw=true",
        sceneUrl:
          "https://studio.test/api/v1/artifacts/artifact_without_urls?format=scene&raw=true",
      },
      finalResponseText:
        "Sketchi artifact ready.\nArtifact ID: artifact_without_urls\nDiagram ID: diagram_without_urls\nFormats: scene, excalidraw, png\nExcalidraw URL: https://studio.test/api/v1/artifacts/artifact_without_urls?format=excalidraw&raw=true\nPNG URL: https://studio.test/api/v1/artifacts/artifact_without_urls?format=png&raw=true",
      ok: true,
    });
  });

  it("preserves existing artifactDelivery URLs while synthesizing missing ones", async () => {
    const result = await executeSketchiCodeMode(
      {},
      {
        code: ACCEPTED_ARTIFACT_WITH_MIXED_URLS_CODE,
      },
      {
        executor: createInProcessExecutor(),
        origin: "https://studio.test",
      },
    );

    expect(result).toMatchObject({
      artifactDelivery: {
        artifactId: "artifact_mixed_urls",
        diagramId: "diagram_mixed_urls",
        excalidrawUrl: "https://custom.test/excalidraw",
        finalResponseText:
          "Sketchi artifact ready.\nArtifact ID: artifact_mixed_urls\nDiagram ID: diagram_mixed_urls\nFormats: scene, excalidraw, png\nExcalidraw URL: https://custom.test/excalidraw\nPNG URL: https://studio.test/api/v1/artifacts/artifact_mixed_urls?format=png&raw=true",
        formats: [
          {
            format: "scene",
            url: "https://studio.test/api/v1/artifacts/artifact_mixed_urls?format=scene&raw=true",
          },
          {
            format: "excalidraw",
            url: "https://custom.test/excalidraw",
          },
          {
            format: "png",
            url: "https://studio.test/api/v1/artifacts/artifact_mixed_urls?format=png&raw=true",
          },
        ],
        pngUrl:
          "https://studio.test/api/v1/artifacts/artifact_mixed_urls?format=png&raw=true",
        sceneUrl:
          "https://studio.test/api/v1/artifacts/artifact_mixed_urls?format=scene&raw=true",
      },
      ok: true,
    });
  });

  it("uses the injected MCP request origin when no override is supplied", async () => {
    const result = await executeSketchiCodeMode(
      {},
      {
        code: ACCEPTED_ARTIFACT_WITHOUT_URLS_CODE,
      },
      {
        executor: createInProcessExecutor(),
      },
    );

    expect(result).toMatchObject({
      artifactDelivery: {
        artifactId: "artifact_without_urls",
        diagramId: "diagram_without_urls",
        finalResponseText:
          "Sketchi artifact ready.\nArtifact ID: artifact_without_urls\nDiagram ID: diagram_without_urls\nFormats: scene, excalidraw, png\nExcalidraw URL: https://studio.test/api/v1/artifacts/artifact_without_urls?format=excalidraw&raw=true\nPNG URL: https://studio.test/api/v1/artifacts/artifact_without_urls?format=png&raw=true",
        formats: [
          {
            format: "scene",
          },
          {
            format: "excalidraw",
          },
          {
            format: "png",
          },
        ],
      },
      finalResponseText:
        "Sketchi artifact ready.\nArtifact ID: artifact_without_urls\nDiagram ID: diagram_without_urls\nFormats: scene, excalidraw, png\nExcalidraw URL: https://studio.test/api/v1/artifacts/artifact_without_urls?format=excalidraw&raw=true\nPNG URL: https://studio.test/api/v1/artifacts/artifact_without_urls?format=png&raw=true",
      ok: true,
    });
    expect(result.artifactDelivery?.excalidrawUrl).toContain(
      "https://studio.test/api/v1/artifacts/",
    );
    expect(result.artifactDelivery?.pngUrl).toContain(
      "https://studio.test/api/v1/artifacts/",
    );
    expect(result.artifactDelivery?.sceneUrl).toContain(
      "https://studio.test/api/v1/artifacts/",
    );
  });
});
