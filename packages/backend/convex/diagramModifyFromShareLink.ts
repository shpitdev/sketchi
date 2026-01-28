"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { modifyElementsWithAgent } from "./diagramModifyElements";
import {
  createExcalidrawShareLink,
  parseExcalidrawShareLink,
} from "./lib/excalidrawShareLinks";

type OutputMode = "elements" | "shareLink" | "both";

function normalizeOutputMode(value?: string): OutputMode {
  if (value === "elements" || value === "shareLink" || value === "both") {
    return value;
  }
  return "both";
}

export const diagramModifyFromShareLink = action({
  args: {
    url: v.string(),
    request: v.string(),
    output: v.optional(v.string()),
    options: v.optional(
      v.object({
        maxSteps: v.optional(v.number()),
        timeoutMs: v.optional(v.number()),
        preferExplicitEdits: v.optional(v.boolean()),
      })
    ),
  },
  handler: async (_ctx, args) => {
    const traceId = crypto.randomUUID();
    const outputMode = normalizeOutputMode(args.output);

    const parsed = await parseExcalidrawShareLink(args.url);

    const modified = await modifyElementsWithAgent(
      {
        elements: parsed.elements,
        appState: parsed.appState,
        request: args.request,
        options: args.options ?? undefined,
      },
      traceId
    );

    if (modified.status !== "success") {
      return modified;
    }

    if (outputMode === "elements") {
      return modified;
    }

    const shareLink = await createExcalidrawShareLink(
      modified.elements ?? [],
      modified.appState ?? {}
    );

    if (outputMode === "shareLink") {
      return {
        ...modified,
        elements: undefined,
        appState: undefined,
        shareLink,
      };
    }

    return {
      ...modified,
      shareLink,
    };
  },
});
