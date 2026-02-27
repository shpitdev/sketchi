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
  abort?: AbortSignal;
  apiBase: string;
  baseDir: string;
  excalidraw?: ExcalidrawFile;
  excalidrawPath?: string;
  expectedDiagramType?: string;
  outputPath?: string;
  pngPath?: string;
  prompt: string;
  promptTimeoutMs?: number;
  renderOptions: RenderOptions;
  shareUrl?: string;
  traceId?: string;
}

export interface DiagramGradeResult {
  grade: Record<string, unknown>;
  pngBytes?: number;
  pngDurationMs?: number;
  pngPath: string | null;
  raw: string;
  shareLink?: { url: string; shareId?: string; encryptionKey?: string };
  summary?: ExcalidrawSummary;
}

const DEFAULT_GRADE_PROMPT_TIMEOUT_MS = 60_000;
const GRADER_SESSION_CACHE_LIMIT = 256;
const graderSessionByParentSession = new Map<string, string>();

type PromptPart =
  | { type: "text"; text: string }
  | { type: "file"; url: string; mime: string; filename: string };

interface PromptResponsePart {
  text?: string;
  type?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function extractSessionIdFromCreateResult(result: unknown): string | null {
  if (!isRecord(result)) {
    return null;
  }

  if (typeof result.id === "string" && result.id.length > 0) {
    return result.id;
  }

  const data = result.data;
  if (!isRecord(data)) {
    return null;
  }

  if (typeof data.id === "string" && data.id.length > 0) {
    return data.id;
  }

  return null;
}

function cacheGraderSession(parentSessionID: string, sessionID: string): void {
  while (graderSessionByParentSession.size >= GRADER_SESSION_CACHE_LIMIT) {
    const oldestKey = graderSessionByParentSession.keys().next().value;
    if (!oldestKey) {
      break;
    }
    graderSessionByParentSession.delete(oldestKey);
  }

  graderSessionByParentSession.set(parentSessionID, sessionID);
}

async function resolvePromptSessionID(
  client: PluginInput["client"],
  parentSessionID: string
): Promise<string> {
  const cached = graderSessionByParentSession.get(parentSessionID);
  if (cached) {
    return cached;
  }

  const sessionClient = client.session as {
    create?: () => Promise<unknown>;
  };

  if (!sessionClient.create) {
    return parentSessionID;
  }

  try {
    const created = await sessionClient.create();
    const sessionID = extractSessionIdFromCreateResult(created);
    if (!sessionID) {
      return parentSessionID;
    }

    cacheGraderSession(parentSessionID, sessionID);
    return sessionID;
  } catch {
    return parentSessionID;
  }
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
    const snippet = text.replace(/\s+/g, " ").trim().slice(0, 240);
    const detail = snippet.length > 0 ? snippet : "<empty response>";
    throw new Error(`Grade response did not include JSON object: ${detail}`);
  }
  const jsonSlice = text.slice(start, end + 1);
  return JSON.parse(jsonSlice) as Record<string, unknown>;
}

function extractPromptResponseParts(response: unknown): PromptResponsePart[] {
  if (!isRecord(response)) {
    return [];
  }

  const topLevelParts = response.parts;
  if (Array.isArray(topLevelParts)) {
    return topLevelParts as PromptResponsePart[];
  }

  const data = response.data;
  if (!isRecord(data)) {
    return [];
  }

  const nestedParts = data.parts;
  if (!Array.isArray(nestedParts)) {
    return [];
  }

  return nestedParts as PromptResponsePart[];
}

function createGradePromptTimeoutError(timeoutMs: number): Error {
  return new Error(
    `diagram_grade timed out after ${timeoutMs}ms while waiting for the grading response. Retry with one diagram per grade call.`
  );
}

function createGradePromptAbortError(): Error {
  return new Error(
    "diagram_grade was aborted while waiting for the grading response."
  );
}

function resolvedPromptTimeoutMs(input: DiagramGradeInput): number {
  return Math.max(
    1000,
    input.promptTimeoutMs ?? DEFAULT_GRADE_PROMPT_TIMEOUT_MS
  );
}

async function promptForGrade(
  client: PluginInput["client"],
  context: { sessionID: string; agent: string; messageID: string },
  parts: PromptPart[],
  input: DiagramGradeInput
): Promise<Awaited<ReturnType<PluginInput["client"]["session"]["prompt"]>>> {
  const timeoutMs = resolvedPromptTimeoutMs(input);
  const promptSessionID = await resolvePromptSessionID(
    client,
    context.sessionID
  );
  const requestBody: {
    agent: string;
    parts: PromptPart[];
    messageID?: string;
  } = {
    agent: context.agent,
    parts,
  };

  if (promptSessionID === context.sessionID) {
    requestBody.messageID = context.messageID;
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;
  let removeAbortListener: (() => void) | undefined;

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(
      () => reject(createGradePromptTimeoutError(timeoutMs)),
      timeoutMs
    );
  });

  const abortPromise = input.abort
    ? new Promise<never>((_resolve, reject) => {
        if (!input.abort) {
          return;
        }

        if (input.abort.aborted) {
          reject(createGradePromptAbortError());
          return;
        }

        const onAbort = () => {
          reject(createGradePromptAbortError());
        };

        input.abort.addEventListener("abort", onAbort, { once: true });
        removeAbortListener = () => {
          input.abort?.removeEventListener("abort", onAbort);
        };
      })
    : null;

  try {
    return await Promise.race([
      client.session.prompt({
        path: { id: promptSessionID },
        body: requestBody,
        responseStyle: "data",
        throwOnError: true,
      }),
      timeoutPromise,
      ...(abortPromise ? [abortPromise] : []),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
    if (removeAbortListener) {
      removeAbortListener();
    }
  }
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

    const response = await promptForGrade(client, context, parts, input);

    const responseParts = extractPromptResponseParts(response);
    const responsePartTypes =
      responseParts.length > 0
        ? responseParts
            .map((part) =>
              typeof part.type === "string" && part.type.length > 0
                ? part.type
                : "unknown"
            )
            .join(",")
        : "none";

    const raw = responseParts
      .map((part) => (part.type === "text" ? (part.text ?? "") : ""))
      .join("");

    if (raw.trim().length === 0) {
      throw new Error(
        `Grade response contained no text content (part types: ${responsePartTypes}).`
      );
    }

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
