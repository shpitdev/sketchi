"use node";
import { v } from "convex/values";
import type { Diagram } from "../lib/diagram-structure";
import { renderDiagramToPngRemote } from "../lib/render-png";
import { action } from "./_generated/server";
import { logEventSafely } from "./lib/observability";

export const exportDiagramPng = action({
  args: {
    diagram: v.any(), // Diagram JSON
    options: v.optional(
      v.object({
        chartType: v.optional(v.string()),
        scale: v.optional(v.number()),
        padding: v.optional(v.number()),
        background: v.optional(v.boolean()),
      })
    ),
  },
  handler: async (_ctx, args) => {
    const traceId = crypto.randomUUID();
    logEventSafely({
      traceId,
      actionName: "exportDiagramPng",
      op: "pipeline.start",
      stage: "render",
      status: "success",
      chartType: args.options?.chartType,
      scale: args.options?.scale,
      padding: args.options?.padding,
    });

    try {
      const result = await renderDiagramToPngRemote(
        args.diagram as Diagram,
        args.options ?? {}
      );
      logEventSafely({
        traceId,
        actionName: "exportDiagramPng",
        op: "pipeline.complete",
        stage: "render",
        status: "success",
        durationMs: result.durationMs,
      });

      // Return PNG as base64 (can't return raw Buffer from action)
      return {
        pngBase64: result.png.toString("base64"),
        durationMs: result.durationMs,
      };
    } catch (error) {
      logEventSafely(
        {
          traceId,
          actionName: "exportDiagramPng",
          op: "pipeline.complete",
          stage: "render",
          status: "failed",
          errorName: error instanceof Error ? error.name : undefined,
          errorMessage: error instanceof Error ? error.message : String(error),
        },
        { level: "error" }
      );
      throw error;
    }
  },
});
