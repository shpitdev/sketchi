"use node";

import { v } from "convex/values";
import { generateIntermediate } from "../lib/agents";
import { IntermediateFormatSchema } from "../lib/diagram-intermediate";
import {
  renderIntermediateDiagram,
  validateEdgeReferences,
} from "../lib/diagram-renderer";
import { simplifyDiagramElements } from "../lib/diagram-simplify";
import { modifyElementsWithAgent } from "./diagramModifyElements";
import {
  createExcalidrawShareLink,
  detectShareUrlType,
  parseExcalidrawUrl,
} from "./lib/excalidrawShareLinks";
import { createLoggedAction } from "./lib/logging";
import { hashString, logEventSafely } from "./lib/observability";

interface GenerateStats {
  traceId: string;
  iterations: number;
  tokens: number;
  durationMs: number;
  nodeCount: number;
  edgeCount: number;
  shapeCount: number;
  arrowCount: number;
}

const generateDiagramAction = createLoggedAction<
  {
    prompt?: string;
    profileId?: string;
    intermediate?: unknown;
    traceId?: string;
  },
  {
    status: "success";
    intermediate: unknown;
    diagram: unknown;
    elements: unknown[];
    shareLink: {
      url: string;
      shareId: string;
      encryptionKey: string;
    };
    stats: GenerateStats;
  }
>("diagrams.generateDiagram", {
  formatArgs: (args) => ({
    hasPrompt: Boolean(args.prompt),
    hasIntermediate: Boolean(args.intermediate),
    profileId: args.profileId ?? null,
  }),
  formatResult: (result) => ({
    shareId: result.shareLink.shareId,
    nodeCount: result.stats.nodeCount,
    edgeCount: result.stats.edgeCount,
  }),
});

const modifyDiagramAction = createLoggedAction<
  {
    shareUrl: string;
    request: string;
    traceId?: string;
    options?: {
      maxSteps?: number;
      timeoutMs?: number;
      preferExplicitEdits?: boolean;
    };
  },
  {
    status: "success" | "failed";
    reason?: "invalid-elements" | "invalid-diff" | "error";
    elements?: unknown[];
    appState?: Record<string, unknown>;
    changes?: {
      diff?: unknown;
      addedIds?: string[];
      removedIds?: string[];
      modifiedIds?: string[];
    };
    issues?: Array<{ code: string; message: string; elementId?: string }>;
    stats: {
      iterations: number;
      tokens: number;
      durationMs: number;
      traceId: string;
    };
    shareLink?: {
      url: string;
      shareId: string;
      encryptionKey: string;
    };
  }
>("diagrams.modifyDiagram", {
  formatArgs: (args) => ({
    traceId: args.traceId ?? null,
    requestLength: args.request.length,
    shareUrl: args.shareUrl,
    options: args.options ?? null,
  }),
  formatResult: (result) => ({
    status: result.status,
    shareId: result.shareLink?.shareId ?? null,
  }),
});

const parseDiagramAction = createLoggedAction<
  {
    shareUrl: string;
    traceId?: string;
  },
  {
    elements: unknown[];
    appState: Record<string, unknown>;
    source: string;
    permission: string;
    metadata: unknown;
    intermediate: unknown;
    stats: {
      elementCount: number;
      nodeCount: number;
      edgeCount: number;
      traceId: string;
    };
  }
>("diagrams.parseDiagram", {
  formatArgs: (args) => ({
    shareUrl: args.shareUrl,
    traceId: args.traceId ?? null,
  }),
  formatResult: (result) => ({
    elementCount: result.stats.elementCount,
    nodeCount: result.stats.nodeCount,
    edgeCount: result.stats.edgeCount,
    traceId: result.stats.traceId,
  }),
});

const shareDiagramAction = createLoggedAction<
  {
    elements: unknown[];
    appState?: Record<string, unknown>;
    traceId?: string;
  },
  {
    url: string;
    shareId: string;
    encryptionKey: string;
  }
>("diagrams.shareDiagram", {
  formatArgs: (args) => ({
    elementsCount: Array.isArray(args.elements) ? args.elements.length : 0,
    appStateKeys: Object.keys(args.appState ?? {}),
    traceId: args.traceId ?? null,
  }),
  formatResult: (result) => ({ shareId: result.shareId }),
});

export const generateDiagram = generateDiagramAction({
  args: {
    prompt: v.optional(v.string()),
    profileId: v.optional(v.string()),
    intermediate: v.optional(v.any()),
    traceId: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    if (!(args.prompt || args.intermediate)) {
      throw new Error("Either prompt or intermediate is required.");
    }

    const startedAt = Date.now();
    let traceId: string = args.traceId ?? crypto.randomUUID();
    const promptLength = args.prompt?.length ?? 0;
    const promptHash = hashString(args.prompt ?? undefined);

    logEventSafely({
      traceId,
      actionName: "diagrams.generateDiagram",
      op: "pipeline.start",
      stage: "input",
      status: "success",
      promptLength,
      promptHash,
      hasIntermediate: Boolean(args.intermediate),
    });

    let intermediate = args.intermediate;
    let iterations = 0;
    let tokens = 0;

    if (!intermediate) {
      const result = await generateIntermediate(args.prompt ?? "", {
        profileId: args.profileId,
        traceId,
      });
      intermediate = result.intermediate;
      iterations = result.iterations;
      tokens = result.tokens;
      // Use the traceId from generation to keep downstream logs aligned.
      traceId = result.traceId;
    }

    const parsed = IntermediateFormatSchema.safeParse(intermediate);
    if (!parsed.success) {
      logEventSafely(
        {
          traceId,
          actionName: "diagrams.generateDiagram",
          op: "pipeline.intermediate",
          stage: "intermediate.validate",
          status: "failed",
          errorName: "IntermediateValidationError",
          errorMessage: parsed.error.message,
        },
        { level: "error" }
      );
      throw new Error(
        `Invalid IntermediateFormat: ${parsed.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; ")}`
      );
    }

    const edgeErrors = validateEdgeReferences(
      parsed.data.nodes,
      parsed.data.edges
    );
    if (edgeErrors.length > 0) {
      logEventSafely(
        {
          traceId,
          actionName: "diagrams.generateDiagram",
          op: "pipeline.intermediate",
          stage: "intermediate.validate",
          status: "failed",
          errorName: "InvalidEdgeReferences",
          errorMessage: edgeErrors.join(", "),
        },
        { level: "error" }
      );
      throw new Error(`Invalid edge references: ${edgeErrors.join(", ")}`);
    }

    const rendered = renderIntermediateDiagram(parsed.data);
    logEventSafely({
      traceId,
      actionName: "diagrams.generateDiagram",
      op: "pipeline.render",
      stage: "render",
      status: "success",
      intermediateNodeCount: rendered.stats.nodeCount,
      intermediateEdgeCount: rendered.stats.edgeCount,
      elementCount: rendered.elements.length,
      shapeCount: rendered.stats.shapeCount,
      arrowCount: rendered.stats.arrowCount,
    });
    let shareLink: {
      url: string;
      shareId: string;
      encryptionKey: string;
    };
    try {
      shareLink = await createExcalidrawShareLink(rendered.elements, {});
      logEventSafely({
        traceId,
        actionName: "diagrams.generateDiagram",
        op: "pipeline.share",
        stage: "share",
        status: "success",
        shareUrlType: "v2",
        elementCount: rendered.elements.length,
      });
    } catch (error) {
      logEventSafely(
        {
          traceId,
          actionName: "diagrams.generateDiagram",
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
    logEventSafely({
      traceId,
      actionName: "diagrams.generateDiagram",
      op: "pipeline.complete",
      stage: "complete",
      status: "success",
      durationMs: Date.now() - startedAt,
      iterations,
      tokens,
      intermediateNodeCount: rendered.stats.nodeCount,
      intermediateEdgeCount: rendered.stats.edgeCount,
      shapeCount: rendered.stats.shapeCount,
      arrowCount: rendered.stats.arrowCount,
    });

    return {
      status: "success",
      intermediate: parsed.data,
      diagram: rendered.diagram,
      elements: rendered.elements,
      shareLink,
      stats: {
        traceId,
        iterations,
        tokens,
        durationMs: Date.now() - startedAt,
        nodeCount: rendered.stats.nodeCount,
        edgeCount: rendered.stats.edgeCount,
        shapeCount: rendered.stats.shapeCount,
        arrowCount: rendered.stats.arrowCount,
      },
    };
  },
});

export const modifyDiagram = modifyDiagramAction({
  args: {
    shareUrl: v.string(),
    request: v.string(),
    traceId: v.optional(v.string()),
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
    const requestLength = args.request.length;
    const requestHash = hashString(args.request);

    logEventSafely({
      traceId,
      actionName: "diagrams.modifyDiagram",
      op: "pipeline.start",
      stage: "input",
      status: "success",
      requestLength,
      requestHash,
    });

    let parsed: Awaited<ReturnType<typeof parseExcalidrawUrl>>;
    try {
      parsed = await parseExcalidrawUrl(args.shareUrl);
      logEventSafely({
        traceId,
        actionName: "diagrams.modifyDiagram",
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
          actionName: "diagrams.modifyDiagram",
          op: "pipeline.parseShareLink",
          stage: "share.parse",
          status: "failed",
          shareUrlType: detectShareUrlType(args.shareUrl),
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
          actionName: "diagrams.modifyDiagram",
          op: "pipeline.failed",
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
        actionName: "diagrams.modifyDiagram",
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
          actionName: "diagrams.modifyDiagram",
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
    logEventSafely({
      traceId,
      actionName: "diagrams.modifyDiagram",
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

export const parseDiagram = parseDiagramAction({
  args: {
    shareUrl: v.string(),
    traceId: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    const traceId = args.traceId ?? crypto.randomUUID();
    logEventSafely({
      traceId,
      actionName: "diagrams.parseDiagram",
      op: "pipeline.start",
      stage: "input",
      status: "success",
    });

    let parsed: Awaited<ReturnType<typeof parseExcalidrawUrl>>;
    try {
      parsed = await parseExcalidrawUrl(args.shareUrl);
      logEventSafely({
        traceId,
        actionName: "diagrams.parseDiagram",
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
          actionName: "diagrams.parseDiagram",
          op: "pipeline.parseShareLink",
          stage: "share.parse",
          status: "failed",
          shareUrlType: detectShareUrlType(args.shareUrl),
          errorName: error instanceof Error ? error.name : undefined,
          errorMessage: error instanceof Error ? error.message : String(error),
        },
        { level: "error" }
      );
      throw error;
    }

    const simplified = simplifyDiagramElements(parsed.payload.elements);
    logEventSafely({
      traceId,
      actionName: "diagrams.parseDiagram",
      op: "pipeline.complete",
      stage: "complete",
      status: "success",
      elementCount: simplified.stats.elementCount,
      intermediateNodeCount: simplified.stats.nodeCount,
      intermediateEdgeCount: simplified.stats.edgeCount,
    });

    return {
      elements: parsed.payload.elements,
      appState: parsed.payload.appState ?? {},
      source: parsed.source,
      permission: parsed.permission,
      metadata: parsed.metadata,
      intermediate: simplified.intermediate,
      stats: { ...simplified.stats, traceId },
    };
  },
});

export const shareDiagram = shareDiagramAction({
  args: {
    elements: v.array(v.any()),
    appState: v.optional(v.any()),
    traceId: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    const traceId = args.traceId ?? crypto.randomUUID();
    const elementCount = Array.isArray(args.elements)
      ? args.elements.length
      : 0;
    logEventSafely({
      traceId,
      actionName: "diagrams.shareDiagram",
      op: "pipeline.start",
      stage: "input",
      status: "success",
      elementCount,
    });

    try {
      const shareLink = await createExcalidrawShareLink(
        args.elements,
        (args.appState as Record<string, unknown> | undefined) ?? {}
      );
      logEventSafely({
        traceId,
        actionName: "diagrams.shareDiagram",
        op: "pipeline.share",
        stage: "share",
        status: "success",
        shareUrlType: "v2",
        elementCount,
      });
      return shareLink;
    } catch (error) {
      logEventSafely(
        {
          traceId,
          actionName: "diagrams.shareDiagram",
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
  },
});
