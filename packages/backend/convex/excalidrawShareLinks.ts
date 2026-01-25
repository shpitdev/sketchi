"use node";

import { v } from "convex/values";
import {
  createExcalidrawShareLink,
  parseExcalidrawShareLink,
} from "./lib/excalidrawShareLinks";
import { createLoggedAction } from "./lib/logging";

interface CreateShareLinkArgs {
  elements: unknown[];
  appState?: Record<string, unknown>;
}

interface ParseShareLinkArgs {
  url: string;
}

const createShareLinkAction = createLoggedAction<
  CreateShareLinkArgs,
  {
    url: string;
    shareId: string;
    encryptionKey: string;
  }
>("excalidrawShareLinks.createShareLinkFromElements", {
  formatArgs: (args) => ({
    elementsCount: Array.isArray(args.elements) ? args.elements.length : 0,
    appStateKeys: Object.keys(args.appState ?? {}),
  }),
  formatResult: (result) => ({ shareId: result.shareId }),
});

const parseShareLinkAction = createLoggedAction<
  ParseShareLinkArgs,
  { elements: unknown[]; appState: Record<string, unknown> }
>("excalidrawShareLinks.parseShareLinkToElements", {
  formatArgs: (args) => ({ url: args.url ?? "" }),
  formatResult: (result) => ({
    elementsCount: result.elements.length,
    appStateKeys: Object.keys(result.appState ?? {}),
  }),
});

export const createShareLinkFromElements = createShareLinkAction({
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

export const parseShareLinkToElements = parseShareLinkAction({
  args: {
    url: v.string(),
  },
  handler: async (_ctx, args) => {
    return await parseExcalidrawShareLink(args.url);
  },
});
