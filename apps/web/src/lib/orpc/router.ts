import { os } from "@orpc/server";
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
}

export function createOrpcContext(): OrpcContext {
  return { convex };
}

const orpc = os.$context<OrpcContext>();

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
    fillStyle: "solid",
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
    versionNonce: 30101,
    isDeleted: false,
    boundElements: null,
    updated: 1725000000000,
    link: null,
    locked: false,
  },
];

const generateInputSchema = z
  .object({
    prompt: z.string().min(1).max(10_000).optional(),
    profileId: z.string().optional(),
    intermediate: z.any().optional(),
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
});

JSON_SCHEMA_REGISTRY.add(parseInputSchema, {
  examples: [{ shareUrl: exampleShareUrl }],
});

const shareInputSchema = z.object({
  elements: z.array(z.any()),
  appState: z.record(z.string(), z.any()).optional(),
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
      return await context.convex.action(api.diagrams.generateDiagram, input);
    }),
  diagramsModify: orpc
    .route({ method: "POST", path: "/diagrams/modify" })
    .input(modifyInputSchema)
    .output(modifyOutputSchema)
    .handler(async ({ input, context }) => {
      return await context.convex.action(api.diagrams.modifyDiagram, input);
    }),
  diagramsParse: orpc
    .route({ method: "GET", path: "/diagrams/parse" })
    .input(parseInputSchema)
    .output(parseOutputSchema)
    .handler(async ({ input, context }) => {
      return await context.convex.action(api.diagrams.parseDiagram, input);
    }),
  diagramsShare: orpc
    .route({ method: "POST", path: "/diagrams/share" })
    .input(shareInputSchema)
    .output(shareLinkSchema)
    .handler(async ({ input, context }) => {
      return await context.convex.action(api.diagrams.shareDiagram, input);
    }),
};

export type AppRouter = typeof appRouter;
