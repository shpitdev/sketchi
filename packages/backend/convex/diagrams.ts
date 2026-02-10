"use node";

import { v } from "convex/values";
import { generateIntermediate, modifyIntermediate } from "../lib/agents";
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

interface RestructureStats extends GenerateStats {
  strategy: "restructure";
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

const tweakDiagramAction = createLoggedAction<
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
    reason?:
      | "invalid-elements"
      | "invalid-diff"
      | "unsupported-request"
      | "error";
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
      strategy: "tweak";
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
>("diagrams.tweakDiagram", {
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

const restructureDiagramAction = createLoggedAction<
  {
    shareUrl: string;
    prompt: string;
    traceId?: string;
    options?: {
      profileId?: string;
      timeoutMs?: number;
      maxSteps?: number;
    };
  },
  {
    status: "success" | "failed";
    reason?: "invalid-elements" | "invalid-intermediate" | "error";
    elements?: unknown[];
    appState?: Record<string, unknown>;
    issues?: Array<{ code: string; message: string; elementId?: string }>;
    stats: RestructureStats;
    shareLink?: {
      url: string;
      shareId: string;
      encryptionKey: string;
    };
  }
>("diagrams.restructureDiagram", {
  formatArgs: (args) => ({
    traceId: args.traceId ?? null,
    promptLength: args.prompt.length,
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

const tweakDiagramImpl = tweakDiagramAction({
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
      actionName: "diagrams.tweakDiagram",
      op: "pipeline.start",
      stage: "input",
      status: "success",
      requestLength,
      requestHash,
      strategy: "tweak",
    });

    let parsed: Awaited<ReturnType<typeof parseExcalidrawUrl>>;
    try {
      parsed = await parseExcalidrawUrl(args.shareUrl);
      logEventSafely({
        traceId,
        actionName: "diagrams.tweakDiagram",
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
        strategy: "tweak",
      });
    } catch (error) {
      logEventSafely(
        {
          traceId,
          actionName: "diagrams.tweakDiagram",
          op: "pipeline.parseShareLink",
          stage: "share.parse",
          status: "failed",
          shareUrlType: detectShareUrlType(args.shareUrl),
          errorName: error instanceof Error ? error.name : undefined,
          errorMessage: error instanceof Error ? error.message : String(error),
          strategy: "tweak",
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

    const modifiedWithStrategy = {
      ...modified,
      stats: { ...modified.stats, strategy: "tweak" as const },
    };

    if (modified.status !== "success") {
      logEventSafely(
        {
          traceId,
          actionName: "diagrams.tweakDiagram",
          op: "pipeline.failed",
          stage: "complete",
          status: "failed",
          durationMs: modified.stats.durationMs,
          iterations: modified.stats.iterations,
          tokens: modified.stats.tokens,
          issuesCount: modified.issues?.length ?? 0,
          strategy: "tweak",
        },
        { level: "error" }
      );
      return modifiedWithStrategy;
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
        actionName: "diagrams.tweakDiagram",
        op: "pipeline.share",
        stage: "share",
        status: "success",
        shareUrlType: "v2",
        elementCount: modified.elements?.length ?? 0,
        strategy: "tweak",
      });
    } catch (error) {
      logEventSafely(
        {
          traceId,
          actionName: "diagrams.tweakDiagram",
          op: "pipeline.share",
          stage: "share",
          status: "failed",
          errorName: error instanceof Error ? error.name : undefined,
          errorMessage: error instanceof Error ? error.message : String(error),
          strategy: "tweak",
        },
        { level: "error" }
      );
      throw error;
    }
    logEventSafely({
      traceId,
      actionName: "diagrams.tweakDiagram",
      op: "pipeline.complete",
      stage: "complete",
      status: "success",
      durationMs: modified.stats.durationMs,
      iterations: modified.stats.iterations,
      tokens: modified.stats.tokens,
      strategy: "tweak",
    });

    return {
      ...modifiedWithStrategy,
      shareLink,
    };
  },
});

export const tweakDiagram = tweakDiagramImpl;

async function parseShareUrlForRestructure(params: {
  traceId: string;
  shareUrl: string;
}): Promise<Awaited<ReturnType<typeof parseExcalidrawUrl>>> {
  try {
    const parsed = await parseExcalidrawUrl(params.shareUrl);
    logEventSafely({
      traceId: params.traceId,
      actionName: "diagrams.restructureDiagram",
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
      strategy: "restructure",
    });
    return parsed;
  } catch (error) {
    logEventSafely(
      {
        traceId: params.traceId,
        actionName: "diagrams.restructureDiagram",
        op: "pipeline.parseShareLink",
        stage: "share.parse",
        status: "failed",
        shareUrlType: detectShareUrlType(params.shareUrl),
        errorName: error instanceof Error ? error.name : undefined,
        errorMessage: error instanceof Error ? error.message : String(error),
        strategy: "restructure",
      },
      { level: "error" }
    );
    throw error;
  }
}

const restructureFromSceneAction = createLoggedAction<
  {
    elements: unknown[];
    appState?: Record<string, unknown>;
    prompt: string;
    traceId?: string;
    options?: {
      profileId?: string;
      timeoutMs?: number;
      maxSteps?: number;
    };
    sessionId?: string;
  },
  {
    status: "success" | "failed";
    reason?: "invalid-elements" | "invalid-intermediate" | "error";
    elements?: unknown[];
    appState?: Record<string, unknown>;
    issues?: Array<{ code: string; message: string; elementId?: string }>;
    stats: RestructureStats;
  }
>("diagrams.restructureFromScene", {
  formatArgs: (args) => ({
    traceId: args.traceId ?? null,
    promptLength: args.prompt.length,
    elementCount: Array.isArray(args.elements) ? args.elements.length : 0,
    options: args.options ?? null,
    sessionId: args.sessionId ?? null,
  }),
  formatResult: (result) => ({
    status: result.status,
    elementCount: result.elements?.length ?? 0,
  }),
});

export const restructureDiagram = restructureDiagramAction({
  args: {
    shareUrl: v.string(),
    prompt: v.string(),
    traceId: v.optional(v.string()),
    options: v.optional(
      v.object({
        profileId: v.optional(v.string()),
        timeoutMs: v.optional(v.number()),
        maxSteps: v.optional(v.number()),
      })
    ),
  },
  handler: async (_ctx, args) => {
    const startedAt = Date.now();
    const traceId = args.traceId ?? crypto.randomUUID();
    const promptLength = args.prompt.length;
    const promptHash = hashString(args.prompt);

    logEventSafely({
      traceId,
      actionName: "diagrams.restructureDiagram",
      op: "pipeline.start",
      stage: "input",
      status: "success",
      promptLength,
      promptHash,
      strategy: "restructure",
    });

    const parsed = await parseShareUrlForRestructure({
      traceId,
      shareUrl: args.shareUrl,
    });

    const simplified = simplifyDiagramElements(parsed.payload.elements);
    logEventSafely({
      traceId,
      actionName: "diagrams.restructureDiagram",
      op: "pipeline.simplify",
      stage: "intermediate.simplify",
      status: "success",
      elementCount: simplified.stats.elementCount,
      intermediateNodeCount: simplified.stats.nodeCount,
      intermediateEdgeCount: simplified.stats.edgeCount,
      strategy: "restructure",
    });

    let modifiedIntermediate: Awaited<ReturnType<typeof modifyIntermediate>>;
    try {
      modifiedIntermediate = await modifyIntermediate(
        simplified.intermediate,
        args.prompt,
        {
          profileId: args.options?.profileId,
          traceId,
          timeoutMs: args.options?.timeoutMs,
          maxSteps: args.options?.maxSteps,
        }
      );
    } catch (error) {
      logEventSafely(
        {
          traceId,
          actionName: "diagrams.restructureDiagram",
          op: "pipeline.modifyIntermediate",
          stage: "intermediate.modify",
          status: "failed",
          errorName: error instanceof Error ? error.name : undefined,
          errorMessage: error instanceof Error ? error.message : String(error),
          strategy: "restructure",
        },
        { level: "error" }
      );
      return {
        status: "failed",
        reason: "error",
        issues: [
          {
            code: "ai-error",
            message: error instanceof Error ? error.message : String(error),
          },
        ],
        stats: {
          strategy: "restructure",
          traceId,
          iterations: 0,
          tokens: 0,
          durationMs: Date.now() - startedAt,
          nodeCount: simplified.stats.nodeCount,
          edgeCount: simplified.stats.edgeCount,
          shapeCount: 0,
          arrowCount: 0,
        },
      };
    }

    const edgeErrors = validateEdgeReferences(
      modifiedIntermediate.intermediate.nodes,
      modifiedIntermediate.intermediate.edges
    );
    if (edgeErrors.length > 0) {
      logEventSafely(
        {
          traceId,
          actionName: "diagrams.restructureDiagram",
          op: "pipeline.intermediate",
          stage: "intermediate.validate",
          status: "failed",
          errorName: "InvalidEdgeReferences",
          errorMessage: edgeErrors.join(", "),
          strategy: "restructure",
        },
        { level: "error" }
      );
      return {
        status: "failed",
        reason: "invalid-intermediate",
        issues: edgeErrors.map((message) => ({
          code: "invalid-edge-reference",
          message,
        })),
        stats: {
          strategy: "restructure",
          traceId,
          iterations: modifiedIntermediate.iterations,
          tokens: modifiedIntermediate.tokens,
          durationMs: modifiedIntermediate.durationMs,
          nodeCount: modifiedIntermediate.intermediate.nodes.length,
          edgeCount: modifiedIntermediate.intermediate.edges.length,
          shapeCount: 0,
          arrowCount: 0,
        },
      };
    }

    const rendered = renderIntermediateDiagram(
      modifiedIntermediate.intermediate
    );
    logEventSafely({
      traceId,
      actionName: "diagrams.restructureDiagram",
      op: "pipeline.render",
      stage: "render",
      status: "success",
      intermediateNodeCount: rendered.stats.nodeCount,
      intermediateEdgeCount: rendered.stats.edgeCount,
      elementCount: rendered.elements.length,
      shapeCount: rendered.stats.shapeCount,
      arrowCount: rendered.stats.arrowCount,
      strategy: "restructure",
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
        actionName: "diagrams.restructureDiagram",
        op: "pipeline.share",
        stage: "share",
        status: "success",
        shareUrlType: "v2",
        elementCount: rendered.elements.length,
        strategy: "restructure",
      });
    } catch (error) {
      logEventSafely(
        {
          traceId,
          actionName: "diagrams.restructureDiagram",
          op: "pipeline.share",
          stage: "share",
          status: "failed",
          errorName: error instanceof Error ? error.name : undefined,
          errorMessage: error instanceof Error ? error.message : String(error),
          strategy: "restructure",
        },
        { level: "error" }
      );
      throw error;
    }

    logEventSafely({
      traceId,
      actionName: "diagrams.restructureDiagram",
      op: "pipeline.complete",
      stage: "complete",
      status: "success",
      durationMs: Date.now() - startedAt,
      iterations: modifiedIntermediate.iterations,
      tokens: modifiedIntermediate.tokens,
      strategy: "restructure",
    });

    return {
      status: "success",
      elements: rendered.elements,
      appState: parsed.payload.appState ?? {},
      shareLink,
      stats: {
        strategy: "restructure",
        traceId,
        iterations: modifiedIntermediate.iterations,
        tokens: modifiedIntermediate.tokens,
        durationMs: Date.now() - startedAt,
        nodeCount: rendered.stats.nodeCount,
        edgeCount: rendered.stats.edgeCount,
        shapeCount: rendered.stats.shapeCount,
        arrowCount: rendered.stats.arrowCount,
      },
    };
  },
});

export const restructureFromScene = restructureFromSceneAction({
  args: {
    elements: v.array(v.any()),
    appState: v.optional(v.any()),
    prompt: v.string(),
    traceId: v.optional(v.string()),
    options: v.optional(
      v.object({
        profileId: v.optional(v.string()),
        timeoutMs: v.optional(v.number()),
        maxSteps: v.optional(v.number()),
      })
    ),
    sessionId: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    const startedAt = Date.now();
    const traceId = args.traceId ?? crypto.randomUUID();
    const promptLength = args.prompt.length;
    const promptHash = hashString(args.prompt);

    logEventSafely({
      traceId,
      actionName: "diagrams.restructureFromScene",
      op: "pipeline.start",
      stage: "input",
      status: "success",
      promptLength,
      promptHash,
      elementCount: Array.isArray(args.elements) ? args.elements.length : 0,
      strategy: "restructure-from-scene",
    });

    const simplified = simplifyDiagramElements(args.elements);
    logEventSafely({
      traceId,
      actionName: "diagrams.restructureFromScene",
      op: "pipeline.simplify",
      stage: "intermediate.simplify",
      status: "success",
      elementCount: simplified.stats.elementCount,
      intermediateNodeCount: simplified.stats.nodeCount,
      intermediateEdgeCount: simplified.stats.edgeCount,
      strategy: "restructure-from-scene",
    });

    let modifiedResult: Awaited<ReturnType<typeof modifyIntermediate>>;
    try {
      modifiedResult = await modifyIntermediate(
        simplified.intermediate,
        args.prompt,
        {
          profileId: args.options?.profileId,
          traceId,
          timeoutMs: args.options?.timeoutMs,
          maxSteps: args.options?.maxSteps,
        }
      );
    } catch (error) {
      logEventSafely(
        {
          traceId,
          actionName: "diagrams.restructureFromScene",
          op: "pipeline.modifyIntermediate",
          stage: "intermediate.modify",
          status: "failed",
          errorName: error instanceof Error ? error.name : undefined,
          errorMessage: error instanceof Error ? error.message : String(error),
          strategy: "restructure-from-scene",
        },
        { level: "error" }
      );
      return {
        status: "failed",
        reason: "error",
        issues: [
          {
            code: "ai-error",
            message: error instanceof Error ? error.message : String(error),
          },
        ],
        stats: {
          strategy: "restructure",
          traceId,
          iterations: 0,
          tokens: 0,
          durationMs: Date.now() - startedAt,
          nodeCount: simplified.stats.nodeCount,
          edgeCount: simplified.stats.edgeCount,
          shapeCount: 0,
          arrowCount: 0,
        },
      };
    }

    const edgeErrors = validateEdgeReferences(
      modifiedResult.intermediate.nodes,
      modifiedResult.intermediate.edges
    );
    if (edgeErrors.length > 0) {
      logEventSafely(
        {
          traceId,
          actionName: "diagrams.restructureFromScene",
          op: "pipeline.intermediate",
          stage: "intermediate.validate",
          status: "failed",
          errorName: "InvalidEdgeReferences",
          errorMessage: edgeErrors.join(", "),
          strategy: "restructure-from-scene",
        },
        { level: "error" }
      );
      return {
        status: "failed",
        reason: "invalid-intermediate",
        issues: edgeErrors.map((message) => ({
          code: "invalid-edge-reference",
          message,
        })),
        stats: {
          strategy: "restructure",
          traceId,
          iterations: modifiedResult.iterations,
          tokens: modifiedResult.tokens,
          durationMs: modifiedResult.durationMs,
          nodeCount: modifiedResult.intermediate.nodes.length,
          edgeCount: modifiedResult.intermediate.edges.length,
          shapeCount: 0,
          arrowCount: 0,
        },
      };
    }

    const rendered = renderIntermediateDiagram(modifiedResult.intermediate);
    logEventSafely({
      traceId,
      actionName: "diagrams.restructureFromScene",
      op: "pipeline.render",
      stage: "render",
      status: "success",
      intermediateNodeCount: rendered.stats.nodeCount,
      intermediateEdgeCount: rendered.stats.edgeCount,
      elementCount: rendered.elements.length,
      shapeCount: rendered.stats.shapeCount,
      arrowCount: rendered.stats.arrowCount,
      strategy: "restructure-from-scene",
    });

    logEventSafely({
      traceId,
      actionName: "diagrams.restructureFromScene",
      op: "pipeline.complete",
      stage: "complete",
      status: "success",
      durationMs: Date.now() - startedAt,
      iterations: modifiedResult.iterations,
      tokens: modifiedResult.tokens,
      strategy: "restructure-from-scene",
    });

    return {
      status: "success",
      elements: rendered.elements,
      appState: (args.appState as Record<string, unknown> | undefined) ?? {},
      stats: {
        strategy: "restructure",
        traceId,
        iterations: modifiedResult.iterations,
        tokens: modifiedResult.tokens,
        durationMs: Date.now() - startedAt,
        nodeCount: rendered.stats.nodeCount,
        edgeCount: rendered.stats.edgeCount,
        shapeCount: rendered.stats.shapeCount,
        arrowCount: rendered.stats.arrowCount,
      },
    };
  },
});

const generateFromPromptForStudioAction = createLoggedAction<
  {
    prompt: string;
    traceId?: string;
    sessionId?: string;
  },
  {
    status: "success" | "failed";
    reason?: "invalid-intermediate" | "error";
    elements?: unknown[];
    appState?: Record<string, unknown>;
    issues?: Array<{ code: string; message: string; elementId?: string }>;
    stats: GenerateStats;
  }
>("diagrams.generateFromPromptForStudio", {
  formatArgs: (args) => ({
    promptLength: args.prompt.length,
    traceId: args.traceId ?? null,
    sessionId: args.sessionId ?? null,
  }),
  formatResult: (result) => ({
    status: result.status,
    elementCount: result.elements?.length ?? 0,
  }),
});

export const generateFromPromptForStudio = generateFromPromptForStudioAction({
  args: {
    prompt: v.string(),
    traceId: v.optional(v.string()),
    sessionId: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    const startedAt = Date.now();
    let traceId: string = args.traceId ?? crypto.randomUUID();
    const promptLength = args.prompt.length;
    const promptHash = hashString(args.prompt);

    logEventSafely({
      traceId,
      actionName: "diagrams.generateFromPromptForStudio",
      op: "pipeline.start",
      stage: "input",
      status: "success",
      promptLength,
      promptHash,
      sessionId: args.sessionId ?? undefined,
    });

    let generationResult: Awaited<ReturnType<typeof generateIntermediate>>;
    try {
      generationResult = await generateIntermediate(args.prompt, {
        traceId,
      });
    } catch (error) {
      logEventSafely(
        {
          traceId,
          actionName: "diagrams.generateFromPromptForStudio",
          op: "pipeline.generateIntermediate",
          stage: "intermediate.generate",
          status: "failed",
          errorName: error instanceof Error ? error.name : undefined,
          errorMessage: error instanceof Error ? error.message : String(error),
        },
        { level: "error" }
      );
      return {
        status: "failed",
        reason: "error",
        issues: [
          {
            code: "ai-error",
            message: error instanceof Error ? error.message : String(error),
          },
        ],
        stats: {
          traceId,
          iterations: 0,
          tokens: 0,
          durationMs: Date.now() - startedAt,
          nodeCount: 0,
          edgeCount: 0,
          shapeCount: 0,
          arrowCount: 0,
        },
      };
    }

    const intermediate = generationResult.intermediate;
    traceId = generationResult.traceId;

    const parsed = IntermediateFormatSchema.safeParse(intermediate);
    if (!parsed.success) {
      logEventSafely(
        {
          traceId,
          actionName: "diagrams.generateFromPromptForStudio",
          op: "pipeline.intermediate",
          stage: "intermediate.validate",
          status: "failed",
          errorName: "IntermediateValidationError",
          errorMessage: parsed.error.message,
        },
        { level: "error" }
      );
      return {
        status: "failed",
        reason: "invalid-intermediate",
        issues: parsed.error.issues.map((issue) => ({
          code: "invalid-intermediate",
          message: `${issue.path.join(".")}: ${issue.message}`,
        })),
        stats: {
          traceId,
          iterations: generationResult.iterations,
          tokens: generationResult.tokens,
          durationMs: Date.now() - startedAt,
          nodeCount: 0,
          edgeCount: 0,
          shapeCount: 0,
          arrowCount: 0,
        },
      };
    }

    const edgeErrors = validateEdgeReferences(
      parsed.data.nodes,
      parsed.data.edges
    );
    if (edgeErrors.length > 0) {
      logEventSafely(
        {
          traceId,
          actionName: "diagrams.generateFromPromptForStudio",
          op: "pipeline.intermediate",
          stage: "intermediate.validate",
          status: "failed",
          errorName: "InvalidEdgeReferences",
          errorMessage: edgeErrors.join(", "),
        },
        { level: "error" }
      );
      return {
        status: "failed",
        reason: "invalid-intermediate",
        issues: edgeErrors.map((message) => ({
          code: "invalid-edge-reference",
          message,
        })),
        stats: {
          traceId,
          iterations: generationResult.iterations,
          tokens: generationResult.tokens,
          durationMs: Date.now() - startedAt,
          nodeCount: parsed.data.nodes.length,
          edgeCount: parsed.data.edges.length,
          shapeCount: 0,
          arrowCount: 0,
        },
      };
    }

    const rendered = renderIntermediateDiagram(parsed.data);
    logEventSafely({
      traceId,
      actionName: "diagrams.generateFromPromptForStudio",
      op: "pipeline.render",
      stage: "render",
      status: "success",
      intermediateNodeCount: rendered.stats.nodeCount,
      intermediateEdgeCount: rendered.stats.edgeCount,
      elementCount: rendered.elements.length,
      shapeCount: rendered.stats.shapeCount,
      arrowCount: rendered.stats.arrowCount,
    });

    logEventSafely({
      traceId,
      actionName: "diagrams.generateFromPromptForStudio",
      op: "pipeline.complete",
      stage: "complete",
      status: "success",
      durationMs: Date.now() - startedAt,
      iterations: generationResult.iterations,
      tokens: generationResult.tokens,
    });

    return {
      status: "success",
      elements: rendered.elements,
      appState: {},
      stats: {
        traceId,
        iterations: generationResult.iterations,
        tokens: generationResult.tokens,
        durationMs: Date.now() - startedAt,
        nodeCount: rendered.stats.nodeCount,
        edgeCount: rendered.stats.edgeCount,
        shapeCount: rendered.stats.shapeCount,
        arrowCount: rendered.stats.arrowCount,
      },
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
