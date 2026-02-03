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
  parseExcalidrawShareLink,
} from "./lib/excalidrawShareLinks";
import { createLoggedAction } from "./lib/logging";

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
  },
  {
    elements: unknown[];
    appState: Record<string, unknown>;
    intermediate: unknown;
    stats: {
      elementCount: number;
      nodeCount: number;
      edgeCount: number;
    };
  }
>("diagrams.parseDiagram", {
  formatArgs: (args) => ({ shareUrl: args.shareUrl }),
  formatResult: (result) => ({
    elementCount: result.stats.elementCount,
    nodeCount: result.stats.nodeCount,
    edgeCount: result.stats.edgeCount,
  }),
});

const shareDiagramAction = createLoggedAction<
  {
    elements: unknown[];
    appState?: Record<string, unknown>;
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
      traceId = result.traceId;
    }

    const parsed = IntermediateFormatSchema.safeParse(intermediate);
    if (!parsed.success) {
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
      throw new Error(`Invalid edge references: ${edgeErrors.join(", ")}`);
    }

    const rendered = renderIntermediateDiagram(parsed.data);
    const shareLink = await createExcalidrawShareLink(rendered.elements, {});

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
    const parsed = await parseExcalidrawShareLink(args.shareUrl);
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

    const shareLink = await createExcalidrawShareLink(
      modified.elements ?? [],
      modified.appState ?? {}
    );

    return {
      ...modified,
      shareLink,
    };
  },
});

export const parseDiagram = parseDiagramAction({
  args: {
    shareUrl: v.string(),
  },
  handler: async (_ctx, args) => {
    const parsed = await parseExcalidrawShareLink(args.shareUrl);
    const simplified = simplifyDiagramElements(parsed.elements);

    return {
      elements: parsed.elements,
      appState: parsed.appState ?? {},
      intermediate: simplified.intermediate,
      stats: simplified.stats,
    };
  },
});

export const shareDiagram = shareDiagramAction({
  args: {
    elements: v.array(v.any()),
    appState: v.optional(v.any()),
  },
  handler: async (_ctx, args) => {
    return await createExcalidrawShareLink(
      args.elements,
      (args.appState as Record<string, unknown> | undefined) ?? {}
    );
  },
});
