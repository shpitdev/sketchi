import { os } from "@orpc/server";
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

const generateInputSchema = z
  .object({
    prompt: z.string().min(1).max(10_000).optional(),
    profileId: z.string().optional(),
    intermediate: z.any().optional(),
  })
  .refine((value) => Boolean(value.prompt || value.intermediate), {
    message: "prompt or intermediate is required",
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
  appState: z.record(z.any()).optional(),
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
  appState: z.record(z.any()),
  intermediate: z.any(),
  stats: z.object({
    elementCount: z.number(),
    nodeCount: z.number(),
    edgeCount: z.number(),
  }),
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
    .input(
      z.object({
        shareUrl: z.string().url(),
        request: z.string().min(1),
        options: z
          .object({
            maxSteps: z.number().optional(),
            timeoutMs: z.number().optional(),
            preferExplicitEdits: z.boolean().optional(),
          })
          .optional(),
      })
    )
    .output(modifyOutputSchema)
    .handler(async ({ input, context }) => {
      return await context.convex.action(api.diagrams.modifyDiagram, input);
    }),
  diagramsParse: orpc
    .route({ method: "GET", path: "/diagrams/parse" })
    .input(
      z.object({
        shareUrl: z.string().url(),
      })
    )
    .output(parseOutputSchema)
    .handler(async ({ input, context }) => {
      return await context.convex.action(api.diagrams.parseDiagram, input);
    }),
  diagramsShare: orpc
    .route({ method: "POST", path: "/diagrams/share" })
    .input(
      z.object({
        elements: z.array(z.any()),
        appState: z.record(z.any()).optional(),
      })
    )
    .output(shareLinkSchema)
    .handler(async ({ input, context }) => {
      return await context.convex.action(api.diagrams.shareDiagram, input);
    }),
};

export type AppRouter = typeof appRouter;
