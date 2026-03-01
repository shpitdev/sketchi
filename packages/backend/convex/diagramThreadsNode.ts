"use node";

import { stepCountIs, streamText, tool } from "ai";
import { v } from "convex/values";
import { z } from "zod";
import { modifyIntermediate } from "../lib/agents";
import { createOpenRouterChatModel } from "../lib/ai/openrouter";
import { IntermediateFormatSchema } from "../lib/diagram-intermediate";
import {
  renderIntermediateDiagram,
  validateEdgeReferences,
} from "../lib/diagram-renderer";
import { simplifyDiagramElements } from "../lib/diagram-simplify";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { type ActionCtx, internalAction } from "./_generated/server";

const DEFAULT_MODEL =
  process.env.MODEL_NAME?.trim() || "google/gemini-3-flash-preview";
const MAX_REASONING_SUMMARY_CHARS = 600;
const ASSISTANT_FLUSH_INTERVAL_MS = 120;
const STOP_POLL_INTERVAL_MS = 700;

type RunStatus =
  | "sending"
  | "running"
  | "applying"
  | "persisted"
  | "stopped"
  | "error";

type ToolUsed = "generate" | "restructure" | "tweak" | null;
type ToolName = "generateDiagram" | "restructureDiagram" | "tweakDiagram";

type ProcessRunResult =
  | { status: "missing" }
  | { status: "terminal" }
  | { status: "stopped" }
  | { status: "error" }
  | { status: "persisted"; latestSceneVersion: number };

type ApplySceneResult =
  | { status: "success"; latestSceneVersion: number; savedAt: number }
  | { status: "conflict"; latestSceneVersion: number }
  | {
      status: "failed";
      reason: "session-not-found" | "forbidden" | "scene-too-large";
      maxBytes?: number;
      actualBytes?: number;
    };

type RunDoc = Doc<"diagramThreadRuns">;

interface RunContext {
  messages: Doc<"diagramThreadMessages">[];
  run: RunDoc;
  session: Doc<"diagramSessions">;
}

interface SceneCandidate {
  appState: Record<string, unknown>;
  elements: Record<string, unknown>[];
}

interface RuntimeState {
  aborted: boolean;
  assistantContent: string;
  lastFlushAt: number;
  latestToolCall: {
    toolCallId: string;
    toolName: ToolName;
  } | null;
  proposedScene: SceneCandidate | null;
  reasoningBuffer: string;
  toolUsed: ToolUsed;
}

interface ToolMeta {
  promptMessageId: string;
  runId: Id<"diagramThreadRuns">;
  sessionId: string;
  threadId: string;
  traceId: string;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1)}…`;
}

function summarizeIssues(
  issues: Array<{ message?: string; code?: string }> | undefined
): string {
  if (!(issues && issues.length > 0)) {
    return "No details provided.";
  }

  const top = issues
    .slice(0, 3)
    .map((issue) => issue.message ?? issue.code ?? "Unknown issue")
    .join("; ");

  return truncate(top, 280);
}

function summarizeUnknownError(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message) {
      return truncate(message, 280);
    }
  }

  return fallback;
}

function coerceElements(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

function coerceAppState(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") {
    return value as Record<string, unknown>;
  }
  return {};
}

function isBlankScene(elements: Record<string, unknown>[]): boolean {
  return elements.filter((element) => element.isDeleted !== true).length === 0;
}

function countNonDeleted(elements: Record<string, unknown>[]): number {
  return elements.filter((element) => element.isDeleted !== true).length;
}

function isTerminalStatus(status: RunStatus): boolean {
  return status === "persisted" || status === "error" || status === "stopped";
}

function describeApplyFailure(
  applyResult: Exclude<ApplySceneResult, { status: "success" }>
): string {
  if (applyResult.status === "conflict") {
    return "Another update landed first. Reload and retry to continue safely.";
  }

  if (applyResult.reason === "forbidden") {
    return "You no longer have permission to write this session.";
  }

  if (applyResult.reason === "scene-too-large") {
    return "The updated scene is too large to persist.";
  }

  return "Failed to persist the updated scene.";
}

function fallbackToolSummary(toolUsed: ToolUsed): string {
  if (toolUsed === "generate") {
    return "Created a new diagram and saved it.";
  }

  if (toolUsed === "tweak") {
    return "Applied targeted tweaks and saved the diagram.";
  }

  return "Restructured the diagram and saved it.";
}

function extractChatHistory(
  messages: Array<{
    promptMessageId?: string;
    role: string;
    content?: string;
    messageType: string;
  }>,
  currentPromptMessageId: string
): Array<{ role: "user" | "assistant"; content: string }> {
  const history: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const message of messages) {
    if (message.messageType !== "chat") {
      continue;
    }
    if (message.promptMessageId === currentPromptMessageId) {
      continue;
    }
    if (!(message.role === "user" || message.role === "assistant")) {
      continue;
    }
    const content = message.content?.trim() ?? "";
    if (!content) {
      continue;
    }
    history.push({ role: message.role, content });
  }
  return history;
}

function createToolMeta(runId: Id<"diagramThreadRuns">, run: RunDoc): ToolMeta {
  return {
    runId,
    sessionId: run.sessionId,
    threadId: run.threadId,
    promptMessageId: run.promptMessageId,
    traceId: run.traceId,
  };
}

async function updateRunAndAssistant(
  ctx: ActionCtx,
  run: RunDoc,
  state: RuntimeState,
  input: {
    appliedSceneVersion?: number;
    contentOverride?: string;
    error?: string;
    finished?: boolean;
    status: RunStatus;
  }
): Promise<void> {
  await ctx.runMutation(internal.diagramThreads.updateRunState, {
    runId: run._id,
    status: input.status,
    error: input.error,
    finished: input.finished,
    appliedSceneVersion: input.appliedSceneVersion,
  });

  const content = input.contentOverride ?? state.assistantContent;
  await ctx.runMutation(internal.diagramThreads.updateAssistantProgress, {
    assistantMessageId: run.assistantMessageId,
    status: input.status,
    content,
    reasoningSummary: state.reasoningBuffer || undefined,
    error: input.error,
  });
}

function createAssistantFlusher(input: {
  ctx: ActionCtx;
  run: RunDoc;
  state: RuntimeState;
}) {
  return async (force = false): Promise<void> => {
    const now = Date.now();
    if (!force && now - input.state.lastFlushAt < ASSISTANT_FLUSH_INTERVAL_MS) {
      return;
    }

    input.state.lastFlushAt = now;
    await input.ctx.runMutation(
      internal.diagramThreads.updateAssistantProgress,
      {
        assistantMessageId: input.run.assistantMessageId,
        content: input.state.assistantContent,
        reasoningSummary: input.state.reasoningBuffer || undefined,
      }
    );
  };
}

async function pollStopSignal(input: {
  abortController: AbortController;
  ctx: ActionCtx;
  runId: Id<"diagramThreadRuns">;
}): Promise<void> {
  const shouldStop = await input.ctx.runQuery(
    internal.diagramThreads.shouldStopRun,
    {
      runId: input.runId,
    }
  );

  if (shouldStop) {
    input.abortController.abort("stop-requested");
  }
}

function startStopPoller(input: {
  abortController: AbortController;
  ctx: ActionCtx;
  runId: Id<"diagramThreadRuns">;
}): ReturnType<typeof setInterval> {
  return setInterval(() => {
    pollStopSignal(input).catch(() => {
      // Polling failures should not crash the run loop.
    });
  }, STOP_POLL_INTERVAL_MS);
}

async function upsertToolMessage(
  ctx: ActionCtx,
  input: ToolMeta & {
    error?: string;
    status: "pending" | "running" | "completed" | "error";
    toolCallId: string;
    toolInput?: unknown;
    toolName: string;
    toolOutput?: unknown;
  }
): Promise<void> {
  await ctx.runMutation(internal.diagramThreads.upsertToolMessage, {
    runId: input.runId,
    sessionId: input.sessionId,
    threadId: input.threadId,
    promptMessageId: input.promptMessageId,
    traceId: input.traceId,
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    status: input.status,
    toolInput: input.toolInput,
    toolOutput: input.toolOutput,
    error: input.error,
  });
}

function currentScene(
  state: RuntimeState,
  baseScene: SceneCandidate
): SceneCandidate {
  return state.proposedScene ?? baseScene;
}

async function executeGenerateTool(input: {
  ctx: ActionCtx;
  run: RunDoc;
  state: RuntimeState;
  toolCallId: string;
  toolMeta: ToolMeta;
}): Promise<
  | { status: "success"; elementCount: number }
  | { status: "failed"; reason: string }
> {
  await upsertToolMessage(input.ctx, {
    ...input.toolMeta,
    toolCallId: input.toolCallId,
    toolName: "generateDiagram",
    status: "running",
    toolInput: {},
  });

  try {
    const generated = await input.ctx.runAction(
      api.diagramGenerateIntermediateFromPrompt.generateIntermediateFromPrompt,
      {
        prompt: input.run.prompt,
        traceId: input.run.traceId,
      }
    );

    const rendered = await input.ctx.runAction(
      api.diagramGenerateFromIntermediate.generateDiagramFromIntermediate,
      {
        intermediate: generated.intermediate,
      }
    );

    const elements = coerceElements(rendered.elements);
    if (elements.length === 0) {
      throw new Error("Generated diagram contained no elements.");
    }

    input.state.proposedScene = {
      elements,
      appState: {},
    };
    input.state.toolUsed = "generate";

    await upsertToolMessage(input.ctx, {
      ...input.toolMeta,
      toolCallId: input.toolCallId,
      toolName: "generateDiagram",
      status: "completed",
      toolOutput: {
        status: "success",
        elementCount: elements.length,
        traceId: generated.traceId,
        nodeCount: generated.intermediate?.nodes?.length ?? null,
        edgeCount: generated.intermediate?.edges?.length ?? null,
      },
    });

    return {
      status: "success",
      elementCount: elements.length,
    };
  } catch (error) {
    const reason = summarizeUnknownError(
      error,
      "Failed to generate a diagram from this prompt."
    );
    await upsertToolMessage(input.ctx, {
      ...input.toolMeta,
      toolCallId: input.toolCallId,
      toolName: "generateDiagram",
      status: "error",
      toolOutput: {
        status: "failed",
        reason,
      },
      error: reason,
    });

    return {
      status: "failed",
      reason,
    };
  }
}

async function executeRestructureTool(input: {
  baseScene: SceneCandidate;
  ctx: ActionCtx;
  run: RunDoc;
  state: RuntimeState;
  toolCallId: string;
  toolMeta: ToolMeta;
}): Promise<
  | { status: "success"; elementCount: number }
  | { status: "failed"; reason: string }
> {
  await upsertToolMessage(input.ctx, {
    ...input.toolMeta,
    toolCallId: input.toolCallId,
    toolName: "restructureDiagram",
    status: "running",
    toolInput: {},
  });

  const sourceScene = currentScene(input.state, input.baseScene);
  if (isBlankScene(sourceScene.elements)) {
    const reason = "Canvas is empty. Use generateDiagram instead.";
    await upsertToolMessage(input.ctx, {
      ...input.toolMeta,
      toolCallId: input.toolCallId,
      toolName: "restructureDiagram",
      status: "error",
      error: reason,
      toolOutput: {
        status: "failed",
        reason,
      },
    });

    return {
      status: "failed",
      reason,
    };
  }

  try {
    const simplified = simplifyDiagramElements(sourceScene.elements);
    const modifiedResult = await modifyIntermediate(
      simplified.intermediate,
      input.run.prompt,
      {
        traceId: input.run.traceId,
      }
    );

    const parsed = IntermediateFormatSchema.safeParse(
      modifiedResult.intermediate
    );
    if (!parsed.success) {
      const parseIssues = parsed.error.issues.map((issue) => ({
        code: issue.code,
        message: `${issue.path.join(".")}: ${issue.message}`,
      }));
      const reason = summarizeIssues(parseIssues);
      await upsertToolMessage(input.ctx, {
        ...input.toolMeta,
        toolCallId: input.toolCallId,
        toolName: "restructureDiagram",
        status: "error",
        toolOutput: {
          status: "failed",
          reason: "invalid-intermediate",
          issues: parseIssues,
        },
        error: reason,
      });

      return {
        status: "failed",
        reason,
      };
    }

    const edgeErrors = validateEdgeReferences(
      parsed.data.nodes,
      parsed.data.edges
    );
    if (edgeErrors.length > 0) {
      const issues = edgeErrors.map((message) => ({
        code: "invalid-edge-reference",
        message,
      }));
      const reason = summarizeIssues(issues);
      await upsertToolMessage(input.ctx, {
        ...input.toolMeta,
        toolCallId: input.toolCallId,
        toolName: "restructureDiagram",
        status: "error",
        toolOutput: {
          status: "failed",
          reason: "invalid-intermediate",
          issues,
        },
        error: reason,
      });

      return {
        status: "failed",
        reason,
      };
    }

    const rendered = renderIntermediateDiagram(parsed.data);
    const elements = coerceElements(rendered.elements);
    if (elements.length === 0) {
      throw new Error("Restructure produced an empty diagram.");
    }

    input.state.proposedScene = {
      elements,
      appState: sourceScene.appState,
    };
    input.state.toolUsed = "restructure";

    await upsertToolMessage(input.ctx, {
      ...input.toolMeta,
      toolCallId: input.toolCallId,
      toolName: "restructureDiagram",
      status: "completed",
      toolOutput: {
        status: "success",
        elementCount: elements.length,
        traceId: modifiedResult.traceId,
        nodeCount: rendered.stats.nodeCount,
        edgeCount: rendered.stats.edgeCount,
        iterations: modifiedResult.iterations,
        tokens: modifiedResult.tokens,
      },
    });

    return {
      status: "success",
      elementCount: elements.length,
    };
  } catch (error) {
    const reason = summarizeUnknownError(
      error,
      "Failed to restructure the current diagram."
    );
    await upsertToolMessage(input.ctx, {
      ...input.toolMeta,
      toolCallId: input.toolCallId,
      toolName: "restructureDiagram",
      status: "error",
      toolOutput: {
        status: "failed",
        reason,
      },
      error: reason,
    });

    return {
      status: "failed",
      reason,
    };
  }
}

async function executeTweakTool(input: {
  baseScene: SceneCandidate;
  ctx: ActionCtx;
  run: RunDoc;
  state: RuntimeState;
  toolCallId: string;
  toolMeta: ToolMeta;
}): Promise<
  | { status: "success"; elementCount: number }
  | { status: "failed"; reason: string }
> {
  await upsertToolMessage(input.ctx, {
    ...input.toolMeta,
    toolCallId: input.toolCallId,
    toolName: "tweakDiagram",
    status: "running",
    toolInput: {},
  });

  const sourceScene = currentScene(input.state, input.baseScene);
  if (isBlankScene(sourceScene.elements)) {
    const reason = "Canvas is empty. Use generateDiagram instead.";
    await upsertToolMessage(input.ctx, {
      ...input.toolMeta,
      toolCallId: input.toolCallId,
      toolName: "tweakDiagram",
      status: "error",
      error: reason,
      toolOutput: {
        status: "failed",
        reason,
      },
    });

    return {
      status: "failed",
      reason,
    };
  }

  try {
    const result = await input.ctx.runAction(
      api.diagramModifyElements.diagramModifyElements,
      {
        elements: sourceScene.elements,
        appState: sourceScene.appState,
        request: input.run.prompt,
      }
    );

    if (result.status !== "success" || !result.elements) {
      const errorSummary = summarizeIssues(result.issues);
      await upsertToolMessage(input.ctx, {
        ...input.toolMeta,
        toolCallId: input.toolCallId,
        toolName: "tweakDiagram",
        status: "error",
        toolOutput: {
          status: result.status,
          reason: result.reason,
          issues: result.issues,
        },
        error: errorSummary,
      });

      return {
        status: "failed",
        reason: errorSummary,
      };
    }

    input.state.proposedScene = {
      elements: result.elements as Record<string, unknown>[],
      appState: coerceAppState(result.appState),
    };
    input.state.toolUsed = "tweak";

    await upsertToolMessage(input.ctx, {
      ...input.toolMeta,
      toolCallId: input.toolCallId,
      toolName: "tweakDiagram",
      status: "completed",
      toolOutput: {
        status: "success",
        elementCount: result.elements.length,
        traceId: result.stats.traceId,
      },
    });

    return {
      status: "success",
      elementCount: result.elements.length,
    };
  } catch (error) {
    const reason = summarizeUnknownError(error, "Failed to tweak the diagram.");
    await upsertToolMessage(input.ctx, {
      ...input.toolMeta,
      toolCallId: input.toolCallId,
      toolName: "tweakDiagram",
      status: "error",
      toolOutput: {
        status: "failed",
        reason,
      },
      error: reason,
    });

    return {
      status: "failed",
      reason,
    };
  }
}

function createTools(input: {
  baseScene: SceneCandidate;
  ctx: ActionCtx;
  run: RunDoc;
  state: RuntimeState;
  toolMeta: ToolMeta;
}) {
  return {
    generateDiagram: tool({
      description:
        "Generate a new diagram from the prompt when the current canvas is blank or a full rewrite is needed.",
      inputSchema: z.object({}),
      execute: async (_toolInput, options) => {
        return await executeGenerateTool({
          ctx: input.ctx,
          run: input.run,
          state: input.state,
          toolMeta: input.toolMeta,
          toolCallId: options.toolCallId,
        });
      },
    }),
    restructureDiagram: tool({
      description:
        "Restructure the existing scene for structural changes (add/remove/rewire nodes and flows).",
      inputSchema: z.object({}),
      execute: async (_toolInput, options) => {
        return await executeRestructureTool({
          ctx: input.ctx,
          run: input.run,
          state: input.state,
          toolMeta: input.toolMeta,
          toolCallId: options.toolCallId,
          baseScene: input.baseScene,
        });
      },
    }),
    tweakDiagram: tool({
      description:
        "Apply tactical tweaks to the current scene (labels/colors/minor edits) without full structural relayout.",
      inputSchema: z.object({}),
      execute: async (_toolInput, options) => {
        return await executeTweakTool({
          ctx: input.ctx,
          run: input.run,
          state: input.state,
          toolMeta: input.toolMeta,
          toolCallId: options.toolCallId,
          baseScene: input.baseScene,
        });
      },
    }),
  };
}

function looksLikeTweakPrompt(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  return (
    normalized.includes("rename") ||
    normalized.includes("label") ||
    normalized.includes("text") ||
    normalized.includes("color") ||
    normalized.includes("style") ||
    normalized.includes("font") ||
    normalized.includes("spacing") ||
    normalized.includes("align") ||
    normalized.includes("small tweak") ||
    normalized.includes("minor")
  );
}

async function executeToolByName(input: {
  baseScene: SceneCandidate;
  ctx: ActionCtx;
  run: RunDoc;
  state: RuntimeState;
  toolCallId: string;
  toolMeta: ToolMeta;
  toolName: ToolName;
}): Promise<
  | { status: "success"; elementCount: number }
  | { status: "failed"; reason: string }
> {
  if (input.toolName === "generateDiagram") {
    return await executeGenerateTool({
      ctx: input.ctx,
      run: input.run,
      state: input.state,
      toolMeta: input.toolMeta,
      toolCallId: input.toolCallId,
    });
  }

  if (input.toolName === "tweakDiagram") {
    return await executeTweakTool({
      ctx: input.ctx,
      run: input.run,
      state: input.state,
      toolMeta: input.toolMeta,
      toolCallId: input.toolCallId,
      baseScene: input.baseScene,
    });
  }

  return await executeRestructureTool({
    ctx: input.ctx,
    run: input.run,
    state: input.state,
    toolMeta: input.toolMeta,
    toolCallId: input.toolCallId,
    baseScene: input.baseScene,
  });
}

async function ensureToolExecution(input: {
  baseScene: SceneCandidate;
  ctx: ActionCtx;
  run: RunDoc;
  state: RuntimeState;
  toolMeta: ToolMeta;
}): Promise<
  | { status: "success" }
  | {
      status: "failed";
      reason: string;
    }
> {
  const attemptedReasons: string[] = [];

  if (input.state.latestToolCall) {
    const replayed = await executeToolByName({
      baseScene: input.baseScene,
      ctx: input.ctx,
      run: input.run,
      state: input.state,
      toolMeta: input.toolMeta,
      toolCallId: input.state.latestToolCall.toolCallId,
      toolName: input.state.latestToolCall.toolName,
    });
    if (replayed.status === "success") {
      return { status: "success" };
    }
    attemptedReasons.push(replayed.reason);
  }

  let fallbackTool: ToolName;
  if (isBlankScene(input.baseScene.elements)) {
    fallbackTool = "generateDiagram";
  } else if (looksLikeTweakPrompt(input.run.prompt)) {
    fallbackTool = "tweakDiagram";
  } else {
    fallbackTool = "restructureDiagram";
  }

  const fallback = await executeToolByName({
    baseScene: input.baseScene,
    ctx: input.ctx,
    run: input.run,
    state: input.state,
    toolMeta: input.toolMeta,
    toolCallId: `fallback_${crypto.randomUUID().replace(/-/g, "")}`,
    toolName: fallbackTool,
  });

  if (fallback.status === "success") {
    return { status: "success" };
  }

  attemptedReasons.push(fallback.reason);
  return {
    status: "failed",
    reason: truncate(
      attemptedReasons.filter(Boolean).join(" | ") ||
        "No diagram change was produced by the tool loop.",
      400
    ),
  };
}

async function runAgentStream(input: {
  abortController: AbortController;
  baseElements: Record<string, unknown>[];
  ctx: ActionCtx;
  flushAssistant: (force?: boolean) => Promise<void>;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  model: ReturnType<typeof createOpenRouterChatModel>;
  run: RunDoc;
  state: RuntimeState;
  tools: ReturnType<typeof createTools>;
  toolMeta: ToolMeta;
}): Promise<
  | { status: "ok" }
  | { status: "stopped" }
  | { status: "error"; message: string }
> {
  try {
    const response = streamText({
      model: input.model,
      system: [
        "You are Sketchi Diagram Studio's planning assistant.",
        "For every request, call exactly one tool before replying.",
        "Tool routing:",
        "- Use generateDiagram when the scene is blank or user asks for a full new diagram.",
        "- Use tweakDiagram for small text/style updates.",
        "- Use restructureDiagram for structural changes.",
        "After tool completion, reply with 1-2 concise sentences about what changed.",
        "Do not mention internal IDs or hidden implementation details.",
      ].join("\n"),
      messages: [
        ...input.history,
        {
          role: "user",
          content: [
            `User request: ${input.run.prompt}`,
            `Current scene non-deleted elements: ${countNonDeleted(input.baseElements)}`,
          ].join("\n"),
        },
      ],
      toolChoice: "required",
      stopWhen: stepCountIs(4),
      tools: input.tools,
      abortSignal: input.abortController.signal,
      onChunk: async ({ chunk }) => {
        switch (chunk.type) {
          case "text-delta": {
            input.state.assistantContent += chunk.text;
            await input.flushAssistant();
            return;
          }
          case "reasoning-delta": {
            input.state.reasoningBuffer = truncate(
              `${input.state.reasoningBuffer}${chunk.text}`,
              MAX_REASONING_SUMMARY_CHARS
            );
            await input.flushAssistant();
            return;
          }
          case "tool-call": {
            if (
              chunk.toolName === "generateDiagram" ||
              chunk.toolName === "restructureDiagram" ||
              chunk.toolName === "tweakDiagram"
            ) {
              input.state.latestToolCall = {
                toolCallId: chunk.toolCallId,
                toolName: chunk.toolName,
              };
            }
            await upsertToolMessage(input.ctx, {
              ...input.toolMeta,
              toolCallId: chunk.toolCallId,
              toolName: chunk.toolName,
              status: "pending",
              toolInput: chunk.input,
            });
            return;
          }
          default:
            return;
        }
      },
      onAbort: () => {
        input.state.aborted = true;
      },
    });

    await response.consumeStream();
    const finalText = (await response.text) ?? "";
    const finalReasoning = (await response.reasoningText) ?? "";

    if (finalText.trim().length > 0) {
      input.state.assistantContent = finalText;
    }
    if (finalReasoning.trim().length > 0) {
      input.state.reasoningBuffer = truncate(
        finalReasoning,
        MAX_REASONING_SUMMARY_CHARS
      );
    }

    await input.flushAssistant(true);
    return { status: "ok" };
  } catch (error) {
    if (input.abortController.signal.aborted) {
      return { status: "stopped" };
    }

    return {
      status: "error",
      message: error instanceof Error ? error.message : "Agent stream failed",
    };
  }
}

async function loadRunContext(
  ctx: ActionCtx,
  runId: Id<"diagramThreadRuns">
): Promise<RunContext | null> {
  const runContext = await ctx.runQuery(
    internal.diagramThreads.getRunForProcessing,
    {
      runId,
    }
  );

  if (!runContext) {
    return null;
  }

  return runContext as RunContext;
}

async function applySceneFromRun(input: {
  ctx: ActionCtx;
  run: RunDoc;
  scene: SceneCandidate;
  session: Doc<"diagramSessions">;
}): Promise<ApplySceneResult> {
  return (await input.ctx.runMutation(
    internal.diagramSessions.internalSetLatestSceneFromThreadRun,
    {
      sessionId: input.run.sessionId,
      ownerUserId: input.run.ownerUserId,
      expectedVersion: input.session.latestSceneVersion,
      elements: input.scene.elements,
      appState: input.scene.appState,
    }
  )) as ApplySceneResult;
}

export const processRun = internalAction({
  args: {
    runId: v.id("diagramThreadRuns"),
  },
  handler: async (ctx, { runId }): Promise<ProcessRunResult> => {
    const runContext = await loadRunContext(ctx, runId);
    if (!runContext) {
      return { status: "missing" };
    }

    const { run, session, messages } = runContext;
    if (isTerminalStatus(run.status as RunStatus)) {
      return { status: "terminal" };
    }

    const baseElements = coerceElements(session.latestScene?.elements);
    const baseAppState = coerceAppState(session.latestScene?.appState);
    const history = extractChatHistory(messages, run.promptMessageId);

    const model = createOpenRouterChatModel({
      modelId: DEFAULT_MODEL,
      traceId: run.traceId,
      userId: run.ownerUserId,
    });

    const state: RuntimeState = {
      assistantContent: "",
      reasoningBuffer: "",
      lastFlushAt: 0,
      proposedScene: null,
      toolUsed: null,
      aborted: false,
      latestToolCall: null,
    };

    await updateRunAndAssistant(ctx, run, state, { status: "running" });

    const abortController = new AbortController();
    const pollTimer = startStopPoller({
      ctx,
      runId,
      abortController,
    });

    const flushAssistant = createAssistantFlusher({
      ctx,
      run,
      state,
    });

    const toolMeta = createToolMeta(runId, run);
    const tools = createTools({
      ctx,
      run,
      state,
      toolMeta,
      baseScene: {
        elements: baseElements,
        appState: baseAppState,
      },
    });

    try {
      const streamResult = await runAgentStream({
        abortController,
        baseElements,
        ctx,
        flushAssistant,
        history,
        model,
        run,
        state,
        tools,
        toolMeta,
      });

      if (streamResult.status === "error") {
        await updateRunAndAssistant(ctx, run, state, {
          status: "error",
          error: streamResult.message,
          finished: true,
        });
        return { status: "error" };
      }

      if (
        streamResult.status === "stopped" ||
        abortController.signal.aborted ||
        state.aborted
      ) {
        await updateRunAndAssistant(ctx, run, state, {
          status: "stopped",
          finished: true,
        });
        return { status: "stopped" };
      }

      if (!state.proposedScene) {
        const ensured = await ensureToolExecution({
          ctx,
          run,
          state,
          toolMeta,
          baseScene: {
            elements: baseElements,
            appState: baseAppState,
          },
        });
        if (ensured.status === "success" && state.proposedScene) {
          await flushAssistant(true);
        }
      }

      if (!state.proposedScene) {
        const message = truncate(
          "No diagram change was produced. Try clarifying whether you want generate, tweak, or restructure.",
          400
        );
        await updateRunAndAssistant(ctx, run, state, {
          status: "error",
          error: message,
          finished: true,
          contentOverride:
            state.assistantContent ||
            "I could not apply a diagram update. Please clarify your request and retry.",
        });
        return { status: "error" };
      }

      await updateRunAndAssistant(ctx, run, state, { status: "applying" });

      const applyResult = await applySceneFromRun({
        ctx,
        run,
        session,
        scene: state.proposedScene,
      });

      if (applyResult.status !== "success") {
        const errorMessage = describeApplyFailure(applyResult);
        await updateRunAndAssistant(ctx, run, state, {
          status: "error",
          error: errorMessage,
          finished: true,
          contentOverride: state.assistantContent || errorMessage,
        });
        return { status: "error" };
      }

      if (!state.assistantContent.trim()) {
        state.assistantContent = fallbackToolSummary(state.toolUsed);
      }

      await updateRunAndAssistant(ctx, run, state, {
        status: "persisted",
        finished: true,
        appliedSceneVersion: applyResult.latestSceneVersion,
      });

      return {
        status: "persisted",
        latestSceneVersion: applyResult.latestSceneVersion,
      };
    } catch (error) {
      const errorMessage = summarizeUnknownError(
        error,
        "Thread run failed before persistence."
      );
      await updateRunAndAssistant(ctx, run, state, {
        status: "error",
        error: errorMessage,
        finished: true,
        contentOverride:
          state.assistantContent ||
          "I hit an internal error while processing this request. Please retry.",
      });
      return { status: "error" };
    } finally {
      clearInterval(pollTimer);
    }
  },
});
