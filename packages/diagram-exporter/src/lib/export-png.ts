import { shareElements } from "./api.js";
import type { ExcalidrawFile, ExcalidrawSummary } from "./excalidraw.js";
import {
  extractShareLink,
  readExcalidrawFile,
  summarizeElements,
} from "./excalidraw.js";
import { buildDefaultPngPath, resolveOutputPath, writePng } from "./output.js";
import type { RenderOptions } from "./render.js";
import { closeBrowser, renderElementsToPng } from "./render.js";
import { resolveExcalidrawFromShareUrl } from "./resolve-share-url.js";

export interface DiagramPngExportInput {
  abort?: AbortSignal;
  allowUnsafeOutputPath?: boolean;
  apiBase: string;
  authorizationHeader?: string | null;
  baseDir: string;
  excalidraw?: ExcalidrawFile;
  excalidrawPath?: string;
  outputPath?: string;
  renderOptions?: RenderOptions;
  sessionId: string;
  shareUrl?: string;
  skipRender?: boolean;
  traceId?: string;
}

export interface DiagramPngExportResult {
  pngBytes?: number;
  pngDurationMs?: number;
  pngPath: string | null;
  pngSkipped?: true;
  shareLink?: { url: string; shareId?: string; encryptionKey?: string };
  summary: ExcalidrawSummary;
}

export interface DiagramPngExportDeps {
  closeBrowser?: typeof closeBrowser;
  readExcalidrawFile?: typeof readExcalidrawFile;
  renderElementsToPng?: typeof renderElementsToPng;
  resolveExcalidrawFromShareUrl?: typeof resolveExcalidrawFromShareUrl;
  shareElements?: typeof shareElements;
  writePng?: typeof writePng;
}

interface ResolvedScene {
  appState: Record<string, unknown>;
  elements: Record<string, unknown>[];
  shareLink?: { url: string; shareId?: string; encryptionKey?: string };
}

async function resolveScene(
  input: DiagramPngExportInput,
  deps: Required<
    Omit<
      DiagramPngExportDeps,
      "closeBrowser" | "renderElementsToPng" | "writePng"
    >
  >
): Promise<ResolvedScene> {
  if (input.shareUrl) {
    const resolved = await deps.resolveExcalidrawFromShareUrl({
      shareUrl: input.shareUrl,
      apiBase: input.apiBase,
      ...(input.traceId ? { traceId: input.traceId } : {}),
      ...(input.authorizationHeader === undefined
        ? {}
        : { authorizationHeader: input.authorizationHeader }),
      ...(input.abort ? { abort: input.abort } : {}),
    });
    return {
      elements: resolved.elements,
      appState: resolved.appState,
      shareLink: extractShareLink(input.shareUrl),
    };
  }

  const scene = input.excalidrawPath
    ? await deps.readExcalidrawFile(input.excalidrawPath, input.baseDir)
    : input.excalidraw;

  if (!scene) {
    throw new Error("Provide shareUrl, excalidrawPath, or excalidraw input.");
  }

  const shared = await deps.shareElements(
    input.apiBase,
    {
      elements: scene.elements,
      appState: scene.appState,
    },
    input.abort,
    undefined,
    input.traceId,
    input.authorizationHeader
  );

  return {
    elements: scene.elements,
    appState: scene.appState ?? {},
    shareLink: shared,
  };
}

function resultShareLink(
  shareLink: ResolvedScene["shareLink"]
): Pick<DiagramPngExportResult, "shareLink"> {
  return shareLink ? { shareLink } : {};
}

export async function exportDiagramToPng(
  input: DiagramPngExportInput,
  deps: DiagramPngExportDeps = {}
): Promise<DiagramPngExportResult> {
  const resolvedDeps = {
    closeBrowser: deps.closeBrowser ?? closeBrowser,
    readExcalidrawFile: deps.readExcalidrawFile ?? readExcalidrawFile,
    renderElementsToPng: deps.renderElementsToPng ?? renderElementsToPng,
    resolveExcalidrawFromShareUrl:
      deps.resolveExcalidrawFromShareUrl ?? resolveExcalidrawFromShareUrl,
    shareElements: deps.shareElements ?? shareElements,
    writePng: deps.writePng ?? writePng,
  };
  const scene = await resolveScene(input, resolvedDeps);
  const summary = summarizeElements(scene.elements);

  if (input.skipRender) {
    return {
      pngPath: null,
      pngSkipped: true,
      summary,
      ...resultShareLink(scene.shareLink),
    };
  }

  const outputPath = input.outputPath
    ? resolveOutputPath(input.outputPath, input.baseDir, input.sessionId, {
        ...(input.allowUnsafeOutputPath === undefined
          ? {}
          : { allowUnsafeOutputPath: input.allowUnsafeOutputPath }),
      })
    : buildDefaultPngPath("diagram-to-png", input.baseDir, input.sessionId);

  try {
    const pngResult = await resolvedDeps.renderElementsToPng(
      scene.elements,
      input.renderOptions ?? {}
    );
    const pngPath = await resolvedDeps.writePng(outputPath, pngResult.png);

    return {
      pngPath,
      pngBytes: pngResult.png.length,
      pngDurationMs: pngResult.durationMs,
      summary,
      ...resultShareLink(scene.shareLink),
    };
  } finally {
    await resolvedDeps.closeBrowser();
  }
}
