import { ORPCError, os } from "@orpc/server";
import { JSON_SCHEMA_REGISTRY } from "@orpc/zod/zod4";
import { api } from "@sketchi/backend/convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";
import { z } from "zod";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) {
  throw new Error("Missing NEXT_PUBLIC_CONVEX_URL for oRPC router");
}

const convex = new ConvexHttpClient(convexUrl);

export interface OrpcContext {
  convex: ConvexHttpClient;
  traceId: string;
}

function createTraceId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
}

export function createOrpcContext(_request: Request): OrpcContext {
  return { convex, traceId: createTraceId() };
}

const orpc = os.$context<OrpcContext>();

type PublicErrorReason =
  | "AI_NO_OUTPUT"
  | "AI_PROVIDER_ERROR"
  | "AI_PARSE_ERROR"
  | "AI_VALIDATION_FAILED"
  | "UPSTREAM_ERROR"
  | "UNKNOWN";

function classifyError(error: unknown): {
  reason: PublicErrorReason;
  message: string;
  name?: string;
} {
  if (error instanceof Error) {
    const message = error.message;
    const name = error.name;
    const lower = message.toLowerCase();

    if (lower.includes("no output generated")) {
      return { reason: "AI_NO_OUTPUT", message, name };
    }
    if (
      lower.includes("failed to process successful response") ||
      lower.includes("invalid json") ||
      lower.includes("json parse")
    ) {
      return { reason: "AI_PARSE_ERROR", message, name };
    }
    if (lower.includes("validation failed after")) {
      return { reason: "AI_VALIDATION_FAILED", message, name };
    }
    if (
      lower.includes("provider returned error") ||
      lower.includes("openrouter") ||
      lower.includes("cloudflare") ||
      lower.includes("502") ||
      lower.includes("503") ||
      lower.includes("504") ||
      lower.includes("timeout") ||
      lower.includes("rate limit") ||
      lower.includes("429")
    ) {
      return { reason: "AI_PROVIDER_ERROR", message, name };
    }

    if (
      lower.includes("excalidraw") ||
      lower.includes("json.excalidraw.com") ||
      lower.includes("failed to fetch")
    ) {
      return { reason: "UPSTREAM_ERROR", message, name };
    }

    return { reason: "UNKNOWN", message, name };
  }

  return { reason: "UNKNOWN", message: String(error) };
}

function throwInternalError(params: {
  traceId: string;
  stage: string;
  action: string;
  error: unknown;
  hint?: string;
}): never {
  const { reason, message, name } = classifyError(params.error);
  throw new ORPCError("INTERNAL_SERVER_ERROR", {
    message: `${params.action} failed (${reason}). traceId=${params.traceId}`,
    data: {
      traceId: params.traceId,
      stage: params.stage,
      action: params.action,
      reason,
      errorName: name,
      errorMessage: message.slice(0, 600),
      hint: params.hint,
    },
  });
}

const shareLinkSchema = z.object({
  url: z.string().url(),
  shareId: z.string(),
  encryptionKey: z.string(),
});

const exampleShareUrl =
  "https://excalidraw.com/#json=exampleShareId,exampleKey";

const exampleIntermediate = {
  nodes: [
    { id: "node-1", label: "Start" },
    { id: "node-2", label: "Finish" },
  ],
  edges: [{ fromId: "node-1", toId: "node-2", label: "next" }],
  graphOptions: { diagramType: "flowchart" },
};

const exampleElements = [
  {
    id: "node-1",
    type: "rectangle",
    x: 0,
    y: 0,
    width: 120,
    height: 60,
    angle: 0,
    strokeColor: "#1971c2",
    backgroundColor: "#a5d8ff",
    fillStyle: "hachure",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    index: "a0",
    roundness: { type: 3 },
    seed: 101,
    version: 1,
    versionNonce: 30_101,
    isDeleted: false,
    boundElements: null,
    updated: 1_725_000_000_000,
    link: null,
    locked: false,
  },
];

const generateInputSchema = z
  .object({
    prompt: z.string().min(1).max(10_000).optional(),
    profileId: z.string().optional(),
    intermediate: z.any().optional(),
    traceId: z.string().optional(),
  })
  .refine((value) => Boolean(value.prompt || value.intermediate), {
    message: "prompt or intermediate is required",
  });

JSON_SCHEMA_REGISTRY.add(generateInputSchema, {
  examples: [
    { prompt: "Create a flowchart for user onboarding." },
    { intermediate: exampleIntermediate },
  ],
});

const generateOutputSchema = z.object({
  status: z.literal("success"),
  intermediate: z.any(),
  diagram: z.any(),
  elements: z.array(z.any()),
  shareLink: shareLinkSchema,
  stats: z.object({
    traceId: z.string(),
    iterations: z.number(),
    tokens: z.number(),
    durationMs: z.number(),
    nodeCount: z.number(),
    edgeCount: z.number(),
    shapeCount: z.number(),
    arrowCount: z.number(),
  }),
});

const modifyOutputSchema = z.object({
  status: z.enum(["success", "failed"]),
  reason: z.string().optional(),
  elements: z.array(z.any()).optional(),
  appState: z.record(z.string(), z.any()).optional(),
  changes: z
    .object({
      diff: z.any().optional(),
      addedIds: z.array(z.string()).optional(),
      removedIds: z.array(z.string()).optional(),
      modifiedIds: z.array(z.string()).optional(),
    })
    .optional(),
  issues: z
    .array(
      z.object({
        code: z.string(),
        message: z.string(),
        elementId: z.string().optional(),
      })
    )
    .optional(),
  stats: z.object({
    iterations: z.number(),
    tokens: z.number(),
    durationMs: z.number(),
    traceId: z.string(),
  }),
  shareLink: shareLinkSchema.optional(),
});

const parseOutputSchema = z.object({
  elements: z.array(z.any()),
  appState: z.record(z.string(), z.any()),
  intermediate: z.any(),
  stats: z.object({
    elementCount: z.number(),
    nodeCount: z.number(),
    edgeCount: z.number(),
  }),
});

const modifyInputSchema = z.object({
  shareUrl: z.string().url(),
  request: z.string().min(1),
  traceId: z.string().optional(),
  options: z
    .object({
      maxSteps: z.number().optional(),
      timeoutMs: z.number().optional(),
      preferExplicitEdits: z.boolean().optional(),
    })
    .optional(),
});

JSON_SCHEMA_REGISTRY.add(modifyInputSchema, {
  examples: [
    {
      shareUrl: exampleShareUrl,
      request: "Rename node-1 to 'Start' and update label colors.",
    },
  ],
});

const parseInputSchema = z.object({
  shareUrl: z.string().url(),
  traceId: z.string().optional(),
});

JSON_SCHEMA_REGISTRY.add(parseInputSchema, {
  examples: [{ shareUrl: exampleShareUrl }],
});

const shareInputSchema = z.object({
  elements: z.array(z.any()),
  appState: z.record(z.string(), z.any()).optional(),
  traceId: z.string().optional(),
});

JSON_SCHEMA_REGISTRY.add(shareInputSchema, {
  examples: [{ elements: exampleElements, appState: {} }],
});

export const appRouter = {
  diagramsGenerate: orpc
    .route({ method: "POST", path: "/diagrams/generate" })
    .input(generateInputSchema)
    .output(generateOutputSchema)
    .handler(async ({ input, context }) => {
      const traceId = input.traceId ?? context.traceId;
      try {
        return await context.convex.action(api.diagrams.generateDiagram, {
          ...input,
          traceId,
        });
      } catch (error) {
        throwInternalError({
          traceId,
          stage: "convex.action",
          action: "diagrams.generateDiagram",
          error,
          hint: "If this is intermittent, retry; if persistent, switch model or check upstream/provider status.",
        });
      }
    }),
  diagramsModify: orpc
    .route({ method: "POST", path: "/diagrams/modify" })
    .input(modifyInputSchema)
    .output(modifyOutputSchema)
    .handler(async ({ input, context }) => {
      const traceId = input.traceId ?? context.traceId;
      try {
        return await context.convex.action(api.diagrams.modifyDiagram, {
          ...input,
          traceId,
        });
      } catch (error) {
        throwInternalError({
          traceId,
          stage: "convex.action",
          action: "diagrams.modifyDiagram",
          error,
        });
      }
    }),
  diagramsParse: orpc
    .route({ method: "GET", path: "/diagrams/parse" })
    .input(parseInputSchema)
    .output(parseOutputSchema)
    .handler(async ({ input, context }) => {
      const traceId = input.traceId ?? context.traceId;
      try {
        return await context.convex.action(api.diagrams.parseDiagram, {
          ...input,
          traceId,
        });
      } catch (error) {
        throwInternalError({
          traceId,
          stage: "convex.action",
          action: "diagrams.parseDiagram",
          error,
        });
      }
    }),
  diagramsShare: orpc
    .route({ method: "POST", path: "/diagrams/share" })
    .input(shareInputSchema)
    .output(shareLinkSchema)
    .handler(async ({ input, context }) => {
      const traceId = input.traceId ?? context.traceId;
      try {
        return await context.convex.action(api.diagrams.shareDiagram, {
          ...input,
          traceId,
        });
      } catch (error) {
        throwInternalError({
          traceId,
          stage: "convex.action",
          action: "diagrams.shareDiagram",
          error,
        });
      }
    }),
};

export type AppRouter = typeof appRouter;
