import { pathToFileURL } from "node:url";
import type { PluginInput } from "@opencode-ai/plugin";

import { shareElements } from "./api";
import type { ExcalidrawFile, ExcalidrawSummary } from "./excalidraw";
import {
  extractShareLink,
  readExcalidrawFile,
  summarizeElements,
} from "./excalidraw";
import { buildDefaultPngPath, resolveOutputPath, writePng } from "./output";
import {
  closeBrowser,
  type RenderOptions,
  renderElementsToPng,
} from "./render";
import { resolveExcalidrawFromShareUrl } from "./resolve-share-url";

export interface DiagramGradeInput {
  prompt: string;
  expectedDiagramType?: string;
  shareUrl?: string;
  excalidrawPath?: string;
  excalidraw?: ExcalidrawFile;
  pngPath?: string;
  outputPath?: string;
  renderOptions: RenderOptions;
  apiBase: string;
  baseDir: string;
  abort?: AbortSignal;
  traceId?: string;
}

export interface DiagramGradeResult {
  shareLink?: { url: string; shareId?: string; encryptionKey?: string };
  pngPath: string | null;
  pngBytes?: number;
  pngDurationMs?: number;
  summary?: ExcalidrawSummary;
  grade: Record<string, unknown>;
  raw: string;
}

function toAttachmentUrl(value: string): string {
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol === "http:" ||
      parsed.protocol === "https:" ||
      parsed.protocol === "file:"
    ) {
      return parsed.href;
    }
  } catch {
    // Fall through to treat as a file path.
  }
  return pathToFileURL(value).href;
}

function buildGradePrompt(input: {
  prompt: string;
  expectedDiagramType?: string;
  shareUrl?: string;
  summary?: ExcalidrawSummary;
}): string {
  const lines = [
    "You are grading an Excalidraw diagram.",
    "Return ONLY valid JSON and nothing else.",
    "",
    "JSON schema:",
    "{",
    '  "diagramType": { "expected": string | null, "actual": string | null, "matches": boolean, "notes": string[] },',
    '  "arrowDirectionality": { "score": number, "issues": string[] },',
    '  "layout": { "score": number, "issues": string[] },',
    '  "visualQuality": { "score": number, "issues": string[] },',
    '  "accuracy": { "score": number, "issues": string[] },',
    '  "completeness": { "score": number, "issues": string[] },',
    '  "overallScore": number,',
    '  "notes": string[]',
    "}",
    "",
    "Scoring: 1 (poor) to 5 (excellent).",
    "",
    `Prompt: ${input.prompt}`,
  ];

  if (input.expectedDiagramType) {
    lines.push(`Expected diagram type: ${input.expectedDiagramType}`);
  }
  if (input.shareUrl) {
    lines.push(`Share URL: ${input.shareUrl}`);
  }
  if (input.summary) {
    lines.push(`Summary: ${JSON.stringify(input.summary)}`);
  }

  lines.push(
    "",
    "Consider:",
    "- Diagram type suitability for the prompt",
    "- Arrow directionality and logical flow",
    "- Layout quality (spacing, overlaps, alignment)",
    "- Visual quality (clipping, overlaps, aesthetics)",
    "- Accuracy to prompt",
    "- Completeness of required elements"
  );

  return lines.join("\n");
}

function extractJson(text: string): Record<string, unknown> {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Grade response did not include JSON object");
  }
  const jsonSlice = text.slice(start, end + 1);
  return JSON.parse(jsonSlice) as Record<string, unknown>;
}

async function resolveExcalidraw(input: DiagramGradeInput): Promise<{
  excalidraw: ExcalidrawFile | null;
  shareLink?: { url: string; shareId?: string; encryptionKey?: string };
}> {
  if (input.shareUrl) {
    const resolved = await resolveExcalidrawFromShareUrl({
      shareUrl: input.shareUrl,
      apiBase: input.apiBase,
      traceId: input.traceId,
      abort: input.abort,
    });
    return {
      excalidraw: {
        elements: resolved.elements,
        appState: resolved.appState ?? {},
      },
      shareLink: extractShareLink(input.shareUrl),
    };
  }

  if (input.excalidraw) {
    return { excalidraw: input.excalidraw };
  }

  if (input.excalidrawPath) {
    const excalidraw = await readExcalidrawFile(
      input.excalidrawPath,
      input.baseDir
    );
    return { excalidraw };
  }

  return { excalidraw: null };
}

async function ensurePng(
  excalidraw: ExcalidrawFile | null,
  input: DiagramGradeInput
): Promise<{
  pngPath: string | null;
  pngBytes?: number;
  pngDurationMs?: number;
}> {
  if (input.pngPath) {
    return { pngPath: resolveOutputPath(input.pngPath, input.baseDir) };
  }

  if (!excalidraw) {
    return { pngPath: null };
  }

  const outputPath = input.outputPath
    ? resolveOutputPath(input.outputPath, input.baseDir)
    : buildDefaultPngPath("diagram-grade", input.baseDir);

  const pngResult = await renderElementsToPng(
    excalidraw.elements,
    input.renderOptions
  );
  const pngPath = await writePng(outputPath, pngResult.png);

  return {
    pngPath,
    pngBytes: pngResult.png.length,
    pngDurationMs: pngResult.durationMs,
  };
}

export async function gradeDiagram(
  client: PluginInput["client"],
  context: { sessionID: string; agent: string; messageID: string },
  input: DiagramGradeInput
): Promise<DiagramGradeResult> {
  if (!client) {
    throw new Error(
      "diagram_grade requires OpenCode client (run via OpenCode)."
    );
  }

  const resolved = await resolveExcalidraw(input);
  let shareLink = resolved.shareLink;
  const summary = resolved.excalidraw
    ? summarizeElements(resolved.excalidraw.elements)
    : undefined;

  if (!shareLink && resolved.excalidraw) {
    const shared = await shareElements(
      input.apiBase,
      {
        elements: resolved.excalidraw.elements,
        appState: resolved.excalidraw.appState,
      },
      input.abort,
      undefined,
      input.traceId
    );
    shareLink = shared;
  }

  let pngPath: string | null = null;
  let pngBytes: number | undefined;
  let pngDurationMs: number | undefined;

  try {
    const pngResult = await ensurePng(resolved.excalidraw, input);
    pngPath = pngResult.pngPath;
    pngBytes = pngResult.pngBytes;
    pngDurationMs = pngResult.pngDurationMs;

    const prompt = buildGradePrompt({
      prompt: input.prompt,
      expectedDiagramType: input.expectedDiagramType,
      shareUrl: shareLink?.url,
      summary,
    });

    const parts: Array<
      | { type: "text"; text: string }
      | { type: "file"; url: string; mime: string; filename: string }
    > = [{ type: "text", text: prompt }];

    if (pngPath) {
      parts.push({
        type: "file",
        url: toAttachmentUrl(pngPath),
        mime: "image/png",
        filename: "diagram.png",
      });
    }

    const response = await client.session.prompt({
      path: { id: context.sessionID },
      body: {
        messageID: context.messageID,
        agent: context.agent,
        parts,
      },
      responseStyle: "data",
      throwOnError: true,
    });

    const raw = Array.isArray(response.data.parts)
      ? response.data.parts
          .map((part: { type?: string; text?: string }) =>
            part.type === "text" ? (part.text ?? "") : ""
          )
          .join("")
      : "";
    const grade = extractJson(raw);

    return {
      shareLink,
      pngPath,
      pngBytes,
      pngDurationMs,
      summary,
      grade,
      raw,
    };
  } finally {
    await closeBrowser();
  }
}
