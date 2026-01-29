import { v } from "convex/values";
import { generateIntermediate } from "../lib/agents";
import { createLoggedAction } from "./lib/logging";

interface GenerateIntermediateFromPromptArgs {
  prompt: string;
  profileId?: string;
  /** Optional correlation id (recommended). */
  traceId?: string;
}

const loggedGenerateIntermediateFromPrompt = createLoggedAction<
  GenerateIntermediateFromPromptArgs,
  Awaited<ReturnType<typeof generateIntermediate>>
>("diagramGenerateIntermediateFromPrompt", {
  formatArgs: (args) => ({
    traceId: args.traceId,
    profileId: args.profileId,
    promptLength: args.prompt.length,
  }),
  formatResult: (result) => ({
    traceId: result.traceId,
    profileId: result.profileId,
    iterations: result.iterations,
    tokens: result.tokens,
    durationMs: result.durationMs,
    nodeCount: result.intermediate.nodes.length,
    edgeCount: result.intermediate.edges.length,
  }),
});

export const generateIntermediateFromPrompt =
  loggedGenerateIntermediateFromPrompt({
    args: {
      prompt: v.string(),
      profileId: v.optional(v.string()),
      traceId: v.optional(v.string()),
    },
    handler: async (_ctx, args) => {
      const traceId = args.traceId ?? crypto.randomUUID();

      const result = await generateIntermediate(args.prompt, {
        profileId: args.profileId,
        traceId,
      });

      console.log(
        JSON.stringify({
          event: "intermediate_generated",
          traceId: result.traceId,
          profileId: result.profileId,
          nodeCount: result.intermediate.nodes.length,
          edgeCount: result.intermediate.edges.length,
          iterations: result.iterations,
          tokens: result.tokens,
          durationMs: result.durationMs,
        })
      );

      return result;
    },
  });
