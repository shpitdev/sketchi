"use node";
import { v } from "convex/values";
import type { Diagram } from "../lib/diagram-structure";
import { renderDiagramToPngRemote } from "../lib/render-png";
import { action } from "./_generated/server";

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
    const result = await renderDiagramToPngRemote(
      args.diagram as Diagram,
      args.options ?? {}
    );

    // Return PNG as base64 (can't return raw Buffer from action)
    return {
      pngBase64: result.png.toString("base64"),
      durationMs: result.durationMs,
    };
  },
});
