import { type Plugin, tool } from "@opencode-ai/plugin";

import { applySketchiDiagramAgentConfig } from "./lib/agent-config";
import {
  appendSketchiDiagramSystemPrompt,
  shouldInjectSketchiDiagramSystemHints,
} from "./lib/agent-hints";
import { fetchJson, shareElements } from "./lib/api";
import { extractShareLink, readExcalidrawFile } from "./lib/excalidraw";
import { gradeDiagram } from "./lib/grade";
import { buildDefaultPngPath, resolveOutputPath, writePng } from "./lib/output";
import { closeBrowser, renderElementsToPng } from "./lib/render";
import { resolveExcalidrawFromShareUrl } from "./lib/resolve-share-url";
import { createToolTraceId } from "./lib/trace";

const DEFAULT_API_BASE = "https://sketchi.app";
const TRAILING_SLASH_PATTERN = /\/$/;

function normalizeApiBase(value: string): string {
  return value.replace(TRAILING_SLASH_PATTERN, "");
}

function extractMessageText(
  parts: Array<{ type: string; text?: string }>
): string {
  const textParts: string[] = [];
  for (const part of parts) {
    if (part.type === "text" && part.text) {
      textParts.push(part.text);
    }
  }
  return textParts.join("\n");
}

export const SketchiPlugin: Plugin = (input) => {
  const apiBase = normalizeApiBase(
    process.env.SKETCHI_API_URL ?? DEFAULT_API_BASE
  );

  return Promise.resolve({
    tool: {
      diagram_from_prompt: tool({
        description:
          "Generate an Excalidraw diagram from a prompt, returning a share link and local PNG. Prefer this over Mermaid text when diagram tools are available.",
        args: {
          prompt: tool.schema.string().describe("What to diagram"),
          outputPath: tool.schema
            .string()
            .optional()
            .describe("Optional PNG output path"),
          scale: tool.schema
            .number()
            .optional()
            .describe("PNG export scale factor"),
          padding: tool.schema
            .number()
            .optional()
            .describe("PNG export padding in pixels"),
          background: tool.schema
            .boolean()
            .optional()
            .describe("Include white background in PNG"),
        },
        async execute(args, context) {
          const traceId = createToolTraceId();
          const response = await fetchJson<{
            shareLink: { url: string; shareId: string; encryptionKey: string };
            elements: Record<string, unknown>[];
            intermediate: unknown;
            stats: Record<string, unknown>;
          }>(
            `${apiBase}/api/diagrams/generate`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-trace-id": traceId,
              },
              body: JSON.stringify({
                prompt: args.prompt,
              }),
            },
            context.abort
          );

          const outputPath = args.outputPath
            ? resolveOutputPath(args.outputPath, context.directory)
            : buildDefaultPngPath("diagram-generate", context.directory);

          try {
            const elements = response.elements?.length
              ? response.elements
              : (
                  await resolveExcalidrawFromShareUrl({
                    shareUrl: response.shareLink.url,
                    apiBase,
                    traceId,
                    abort: context.abort,
                  })
                ).elements;
            const pngResult = await renderElementsToPng(elements, {
              scale: args.scale,
              padding: args.padding,
              background: args.background,
            });

            const pngPath = await writePng(outputPath, pngResult.png);

            return JSON.stringify(
              {
                shareLink: response.shareLink,
                pngPath,
                pngBytes: pngResult.png.length,
                pngDurationMs: pngResult.durationMs,
                stats: response.stats,
              },
              null,
              2
            );
          } finally {
            await closeBrowser();
          }
        },
      }),
      diagram_tweak: tool({
        description:
          "Apply a tactical tweak to an existing Excalidraw diagram (text/colors/flip existing arrow direction). Prefer this over Mermaid rewrites for small edits. No add/remove or layout control; for structural changes use diagram_restructure or the Excalidraw UI.",
        args: {
          shareUrl: tool.schema
            .string()
            .optional()
            .describe("Excalidraw share URL to tweak"),
          excalidrawPath: tool.schema
            .string()
            .optional()
            .describe("Path to .excalidraw JSON file"),
          excalidraw: tool.schema
            .object({
              elements: tool.schema.array(tool.schema.any()),
              appState: tool.schema.object({}).passthrough().optional(),
            })
            .optional()
            .describe("Excalidraw JSON blob"),
          request: tool.schema.string().describe("Tweak request to apply"),
          options: tool.schema
            .object({
              maxSteps: tool.schema.number().optional(),
              timeoutMs: tool.schema.number().optional(),
              preferExplicitEdits: tool.schema.boolean().optional(),
            })
            .optional()
            .describe("Optional tweak options (server-side)"),
          outputPath: tool.schema
            .string()
            .optional()
            .describe("Optional PNG output path"),
          scale: tool.schema
            .number()
            .optional()
            .describe("PNG export scale factor"),
          padding: tool.schema
            .number()
            .optional()
            .describe("PNG export padding in pixels"),
          background: tool.schema
            .boolean()
            .optional()
            .describe("Include white background in PNG"),
        },
        async execute(args, context) {
          const serverTimeoutMs = args.options?.timeoutMs ?? 60_000;
          const requestTimeoutMs = Math.max(5000, serverTimeoutMs + 5000);
          const traceId = createToolTraceId();

          let shareUrl = args.shareUrl;
          if (!shareUrl) {
            const excalidraw =
              args.excalidraw ??
              (args.excalidrawPath
                ? await readExcalidrawFile(
                    args.excalidrawPath,
                    context.directory
                  )
                : undefined);

            if (!excalidraw) {
              throw new Error("Provide shareUrl or excalidraw input");
            }

            const shared = await shareElements(
              apiBase,
              {
                elements: excalidraw.elements,
                appState: excalidraw.appState,
              },
              context.abort,
              requestTimeoutMs,
              traceId
            );

            shareUrl = shared.url;
          }

          const response = await fetchJson<{
            status: "success" | "failed";
            reason?: string;
            elements?: Record<string, unknown>[];
            shareLink?: {
              url: string;
              shareId: string;
              encryptionKey: string;
            };
            stats: Record<string, unknown>;
          }>(
            `${apiBase}/api/diagrams/tweak`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-trace-id": traceId,
              },
              body: JSON.stringify({
                shareUrl,
                request: args.request,
                traceId,
                options: args.options,
              }),
            },
            context.abort,
            requestTimeoutMs
          );

          if (response.status !== "success") {
            throw new Error(response.reason ?? "Diagram tweak failed");
          }

          if (!response.shareLink?.url) {
            throw new Error("Missing shareLink in tweak response");
          }

          const outputPath = args.outputPath
            ? resolveOutputPath(args.outputPath, context.directory)
            : buildDefaultPngPath("diagram-tweak", context.directory);

          try {
            const elements = response.elements?.length
              ? response.elements
              : (
                  await resolveExcalidrawFromShareUrl({
                    shareUrl: response.shareLink.url,
                    apiBase,
                    traceId,
                    abort: context.abort,
                  })
                ).elements;
            const pngResult = await renderElementsToPng(elements, {
              scale: args.scale,
              padding: args.padding,
              background: args.background,
            });

            const pngPath = await writePng(outputPath, pngResult.png);

            return JSON.stringify(
              {
                shareLink: response.shareLink,
                pngPath,
                pngBytes: pngResult.png.length,
                pngDurationMs: pngResult.durationMs,
                stats: response.stats,
              },
              null,
              2
            );
          } finally {
            await closeBrowser();
          }
        },
      }),
      diagram_restructure: tool({
        description:
          "Restructure an Excalidraw diagram (add/remove nodes/edges, change flow). Prefer this over Mermaid rewrites for structural edits; this re-renders with automatic layout.",
        args: {
          shareUrl: tool.schema
            .string()
            .optional()
            .describe("Excalidraw share URL to restructure"),
          excalidrawPath: tool.schema
            .string()
            .optional()
            .describe("Path to .excalidraw JSON file"),
          excalidraw: tool.schema
            .object({
              elements: tool.schema.array(tool.schema.any()),
              appState: tool.schema.object({}).passthrough().optional(),
            })
            .optional()
            .describe("Excalidraw JSON blob"),
          prompt: tool.schema
            .string()
            .describe("Structural request (what the new diagram should be)"),
          options: tool.schema
            .object({
              profileId: tool.schema.string().optional(),
              timeoutMs: tool.schema.number().optional(),
              maxSteps: tool.schema.number().optional(),
            })
            .optional()
            .describe("Optional restructure options (client + server)"),
          outputPath: tool.schema
            .string()
            .optional()
            .describe("Optional PNG output path"),
          scale: tool.schema
            .number()
            .optional()
            .describe("PNG export scale factor"),
          padding: tool.schema
            .number()
            .optional()
            .describe("PNG export padding in pixels"),
          background: tool.schema
            .boolean()
            .optional()
            .describe("Include white background in PNG"),
        },
        async execute(args, context) {
          const serverTimeoutMs = args.options?.timeoutMs ?? 240_000;
          const requestTimeoutMs = Math.max(5000, serverTimeoutMs + 5000);
          const traceId = createToolTraceId();

          let shareUrl = args.shareUrl;
          if (!shareUrl) {
            const excalidraw =
              args.excalidraw ??
              (args.excalidrawPath
                ? await readExcalidrawFile(
                    args.excalidrawPath,
                    context.directory
                  )
                : undefined);

            if (!excalidraw) {
              throw new Error("Provide shareUrl or excalidraw input");
            }

            const shared = await shareElements(
              apiBase,
              {
                elements: excalidraw.elements,
                appState: excalidraw.appState,
              },
              context.abort,
              requestTimeoutMs,
              traceId
            );

            shareUrl = shared.url;
          }

          const response = await fetchJson<{
            status: "success" | "failed";
            reason?: string;
            elements?: Record<string, unknown>[];
            shareLink?: {
              url: string;
              shareId: string;
              encryptionKey: string;
            };
            stats: Record<string, unknown>;
          }>(
            `${apiBase}/api/diagrams/restructure`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-trace-id": traceId,
              },
              body: JSON.stringify({
                shareUrl,
                prompt: args.prompt,
                traceId,
                options: args.options,
              }),
            },
            context.abort,
            requestTimeoutMs
          );

          if (response.status !== "success") {
            throw new Error(response.reason ?? "Diagram restructure failed");
          }

          if (!response.shareLink?.url) {
            throw new Error("Missing shareLink in restructure response");
          }

          const outputPath = args.outputPath
            ? resolveOutputPath(args.outputPath, context.directory)
            : buildDefaultPngPath("diagram-restructure", context.directory);

          try {
            const elements = response.elements?.length
              ? response.elements
              : (
                  await resolveExcalidrawFromShareUrl({
                    shareUrl: response.shareLink.url,
                    apiBase,
                    traceId,
                    abort: context.abort,
                  })
                ).elements;
            const pngResult = await renderElementsToPng(elements, {
              scale: args.scale,
              padding: args.padding,
              background: args.background,
            });

            const pngPath = await writePng(outputPath, pngResult.png);

            return JSON.stringify(
              {
                shareLink: response.shareLink,
                pngPath,
                pngBytes: pngResult.png.length,
                pngDurationMs: pngResult.durationMs,
                stats: response.stats,
              },
              null,
              2
            );
          } finally {
            await closeBrowser();
          }
        },
      }),
      diagram_to_png: tool({
        description:
          "Render a PNG locally from an Excalidraw share link or file. Use this for diagram exports instead of code-block diagrams.",
        args: {
          shareUrl: tool.schema
            .string()
            .optional()
            .describe("Excalidraw share URL to render"),
          excalidrawPath: tool.schema
            .string()
            .optional()
            .describe("Path to .excalidraw JSON file"),
          excalidraw: tool.schema
            .object({
              elements: tool.schema.array(tool.schema.any()),
              appState: tool.schema.object({}).passthrough().optional(),
            })
            .optional()
            .describe("Excalidraw JSON blob"),
          outputPath: tool.schema
            .string()
            .optional()
            .describe("Optional PNG output path"),
          scale: tool.schema
            .number()
            .optional()
            .describe("PNG export scale factor"),
          padding: tool.schema
            .number()
            .optional()
            .describe("PNG export padding in pixels"),
          background: tool.schema
            .boolean()
            .optional()
            .describe("Include white background in PNG"),
        },
        async execute(args, context) {
          const traceId = createToolTraceId();
          const excalidraw =
            args.excalidraw ??
            (args.excalidrawPath
              ? await readExcalidrawFile(args.excalidrawPath, context.directory)
              : undefined);

          if (!(args.shareUrl || excalidraw)) {
            throw new Error("Provide shareUrl or excalidraw input");
          }

          const outputPath = args.outputPath
            ? resolveOutputPath(args.outputPath, context.directory)
            : buildDefaultPngPath("diagram-to-png", context.directory);

          try {
            let shareLink:
              | { url: string; shareId?: string; encryptionKey?: string }
              | undefined;
            let elements: Record<string, unknown>[] = [];

            if (args.shareUrl) {
              shareLink = extractShareLink(args.shareUrl);
              const resolved = await resolveExcalidrawFromShareUrl({
                shareUrl: args.shareUrl,
                apiBase,
                traceId,
                abort: context.abort,
              });
              elements = resolved.elements;
            } else if (excalidraw) {
              const shared = await shareElements(
                apiBase,
                {
                  elements: excalidraw.elements,
                  appState: excalidraw.appState,
                },
                context.abort,
                undefined,
                traceId
              );
              shareLink = shared;
              elements = excalidraw.elements;
            }

            const pngResult = await renderElementsToPng(elements, {
              scale: args.scale,
              padding: args.padding,
              background: args.background,
            });

            const pngPath = await writePng(outputPath, pngResult.png);

            return JSON.stringify(
              {
                shareLink,
                pngPath,
                pngBytes: pngResult.png.length,
                pngDurationMs: pngResult.durationMs,
              },
              null,
              2
            );
          } finally {
            await closeBrowser();
          }
        },
      }),
      diagram_grade: tool({
        description:
          "Grade an Excalidraw diagram for type, layout, directionality, visual quality, accuracy, and completeness.",
        args: {
          prompt: tool.schema
            .string()
            .describe("Original prompt or requirement for the diagram"),
          expectedDiagramType: tool.schema
            .string()
            .optional()
            .describe("Expected diagram type (optional)"),
          shareUrl: tool.schema
            .string()
            .optional()
            .describe("Excalidraw share URL to grade"),
          excalidrawPath: tool.schema
            .string()
            .optional()
            .describe("Path to .excalidraw JSON file"),
          excalidraw: tool.schema
            .object({
              elements: tool.schema.array(tool.schema.any()),
              appState: tool.schema.object({}).passthrough().optional(),
            })
            .optional()
            .describe("Excalidraw JSON blob"),
          pngPath: tool.schema
            .string()
            .optional()
            .describe("Optional existing PNG path to grade"),
          outputPath: tool.schema
            .string()
            .optional()
            .describe("Optional path to write PNG (if generated)"),
          scale: tool.schema
            .number()
            .optional()
            .describe("PNG export scale factor"),
          padding: tool.schema
            .number()
            .optional()
            .describe("PNG export padding in pixels"),
          background: tool.schema
            .boolean()
            .optional()
            .describe("Include white background in PNG"),
        },
        async execute(args, context) {
          const traceId = createToolTraceId();
          const excalidraw = args.excalidraw
            ? {
                elements: args.excalidraw.elements,
                appState: args.excalidraw.appState ?? {},
              }
            : undefined;

          const result = await gradeDiagram(
            input.client,
            {
              sessionID: context.sessionID,
              agent: context.agent,
              messageID: context.messageID,
            },
            {
              prompt: args.prompt,
              expectedDiagramType: args.expectedDiagramType,
              shareUrl: args.shareUrl,
              excalidrawPath: args.excalidrawPath,
              excalidraw,
              pngPath: args.pngPath,
              outputPath: args.outputPath,
              renderOptions: {
                scale: args.scale,
                padding: args.padding,
                background: args.background,
              },
              apiBase,
              baseDir: context.directory,
              abort: context.abort,
              traceId,
            }
          );

          return JSON.stringify(result, null, 2);
        },
      }),
    },
    config: (config) => {
      applySketchiDiagramAgentConfig(config);
      return Promise.resolve();
    },
    "chat.message": (_input, output) => {
      const messageText = extractMessageText(
        output.parts as Array<{ type: string; text?: string }>
      );

      if (!shouldInjectSketchiDiagramSystemHints(messageText)) {
        return Promise.resolve();
      }

      output.message.system = appendSketchiDiagramSystemPrompt(
        output.message.system
      );
      return Promise.resolve();
    },
  });
};

export default SketchiPlugin;
