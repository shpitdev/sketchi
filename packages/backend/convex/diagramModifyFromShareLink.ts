"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { modifyElementsWithAgent } from "./diagramModifyElements";
import {
  createExcalidrawShareLink,
  detectShareUrlType,
  parseExcalidrawUrl,
} from "./lib/excalidrawShareLinks";
import { hashString, logEventSafely } from "./lib/observability";

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
    traceId: v.optional(v.string()),
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
    const traceId = args.traceId ?? crypto.randomUUID();
    const outputMode = normalizeOutputMode(args.output);

    logEventSafely({
      traceId,
      actionName: "diagramModifyFromShareLink",
      op: "pipeline.start",
      stage: "input",
      status: "success",
      requestLength: args.request.length,
      requestHash: hashString(args.request),
      outputMode,
    });

    let parsed: Awaited<ReturnType<typeof parseExcalidrawUrl>>;
    try {
      parsed = await parseExcalidrawUrl(args.url);
      logEventSafely({
        traceId,
        actionName: "diagramModifyFromShareLink",
        op: "pipeline.parseShareLink",
        stage: "share.parse",
        status: "success",
        shareUrlType:
          parsed.source === "excalidraw-share"
            ? parsed.metadata.shareUrlType
            : undefined,
        excalidrawSource: parsed.source,
        excalidrawPermission: parsed.permission,
        elementCount: parsed.payload.elements.length,
      });
    } catch (error) {
      logEventSafely(
        {
          traceId,
          actionName: "diagramModifyFromShareLink",
          op: "pipeline.parseShareLink",
          stage: "share.parse",
          status: "failed",
          shareUrlType: detectShareUrlType(args.url),
          errorName: error instanceof Error ? error.name : undefined,
          errorMessage: error instanceof Error ? error.message : String(error),
        },
        { level: "error" }
      );
      throw error;
    }

    const modified = await modifyElementsWithAgent(
      {
        elements: parsed.payload.elements,
        appState: parsed.payload.appState,
        request: args.request,
        options: args.options ?? undefined,
      },
      traceId
    );

    if (modified.status !== "success") {
      logEventSafely(
        {
          traceId,
          actionName: "diagramModifyFromShareLink",
          op: "pipeline.complete",
          stage: "complete",
          status: "failed",
          durationMs: modified.stats.durationMs,
          iterations: modified.stats.iterations,
          tokens: modified.stats.tokens,
          issuesCount: modified.issues?.length ?? 0,
        },
        { level: "error" }
      );
      return modified;
    }

    if (outputMode === "elements") {
      logEventSafely({
        traceId,
        actionName: "diagramModifyFromShareLink",
        op: "pipeline.complete",
        stage: "complete",
        status: "success",
        durationMs: modified.stats.durationMs,
        iterations: modified.stats.iterations,
        tokens: modified.stats.tokens,
      });
      return modified;
    }

    let shareLink: {
      url: string;
      shareId: string;
      encryptionKey: string;
    };
    try {
      shareLink = await createExcalidrawShareLink(
        modified.elements ?? [],
        modified.appState ?? {}
      );
      logEventSafely({
        traceId,
        actionName: "diagramModifyFromShareLink",
        op: "pipeline.share",
        stage: "share",
        status: "success",
        shareUrlType: "v2",
        elementCount: modified.elements?.length ?? 0,
      });
    } catch (error) {
      logEventSafely(
        {
          traceId,
          actionName: "diagramModifyFromShareLink",
          op: "pipeline.share",
          stage: "share",
          status: "failed",
          errorName: error instanceof Error ? error.name : undefined,
          errorMessage: error instanceof Error ? error.message : String(error),
        },
        { level: "error" }
      );
      throw error;
    }

    if (outputMode === "shareLink") {
      logEventSafely({
        traceId,
        actionName: "diagramModifyFromShareLink",
        op: "pipeline.complete",
        stage: "complete",
        status: "success",
        durationMs: modified.stats.durationMs,
        iterations: modified.stats.iterations,
        tokens: modified.stats.tokens,
      });
      return {
        ...modified,
        elements: undefined,
        appState: undefined,
        shareLink,
      };
    }

    logEventSafely({
      traceId,
      actionName: "diagramModifyFromShareLink",
      op: "pipeline.complete",
      stage: "complete",
      status: "success",
      durationMs: modified.stats.durationMs,
      iterations: modified.stats.iterations,
      tokens: modified.stats.tokens,
    });
    return {
      ...modified,
      shareLink,
    };
  },
});
