"use node";

import { Output, stepCountIs, ToolLoopAgent, tool } from "ai";
import { v } from "convex/values";
import { createOpenRouterChatModel } from "../lib/ai/openrouter";
import type { DiagramElementDiff } from "../lib/diagram-modification";
import {
  applyDiagramDiff,
  DiagramElementDiffSchema,
  validateElements,
} from "../lib/diagram-modification";
import { action } from "./_generated/server";
import { hashString, logEventSafely } from "./lib/observability";
import { createTraceId } from "./lib/trace";

const DEFAULT_MAX_STEPS = 5;
const MAX_TIMEOUT_MS = 240_000;
const DEFAULT_MODEL =
  process.env.MODEL_NAME?.trim() || "google/gemini-3-flash-preview";

const GEOMETRY_FIELD_ASSIGNMENT_RE = /\b(x|y|width|height)\s*=/i;

const MODIFICATION_SYSTEM_PROMPT = `You apply tactical tweaks to existing Excalidraw diagrams by producing an element-level diff.

This tool is for small, safe edits only:
- Allowed: update text labels, change colors/styles, flip an existing arrow direction between existing nodes.
- Forbidden: add/remove nodes/edges/elements, change geometry/layout (x/y/width/height/points/angle), "make it prettier"/re-layout/align/spacing.
If the request is out of scope, do not attempt a workaround; the request should be handled by restructure or in the Excalidraw UI.
	
	You must return a JSON object that matches the schema:
	{
	  "add": [ExcalidrawElementSkeleton...],
	  "remove": [elementId...],
	  "modify": [{ "id": "...", "changes": { ... } }]
	}
	
	Rules:
	- Only change what the request asks.
	- Keep existing element ids unchanged.
	- Never include an id field inside changes; only use modify.id to select the element.
	- Use existing ids for bindings (startBinding/endBinding/containerId/boundElements).
	- If you change arrow bindings, ensure references remain valid.
	- Never use add/remove in this tool; only modify existing elements.
	- When updating labels, edit the bound text element and set both text + originalText.
	- Omit empty arrays (do not include add/remove/modify when empty).
	
	After drafting the diff, call the validateAndApplyDiff tool.
	If it returns ok=false, fix the issues and call it again.
	If it returns ok=true, respond with the same diff as your final output (no tool call).`;

interface DiagramModifyStats {
  iterations: number;
  tokens: number;
  durationMs: number;
  traceId: string;
}

interface DiagramModifyResult {
  status: "success" | "failed";
  reason?:
    | "invalid-elements"
    | "invalid-diff"
    | "unsupported-request"
    | "error";
  elements?: unknown[];
  appState?: Record<string, unknown>;
  changes?: {
    diff?: DiagramElementDiff;
    addedIds?: string[];
    removedIds?: string[];
    modifiedIds?: string[];
  };
  issues?: DiagramIssue[];
  stats: DiagramModifyStats;
}

interface DiagramIssue {
  code: string;
  message: string;
  elementId?: string;
}

const DISALLOWED_TWEAK_CHANGE_KEYS = new Set([
  "x",
  "y",
  "width",
  "height",
  "points",
  "angle",
  "isDeleted",
  "type",
]);

function validateTweakDiffConstraints(
  diff: DiagramElementDiff
): DiagramIssue[] {
  const issues: DiagramIssue[] = [];

  if (Array.isArray(diff.add) && diff.add.length > 0) {
    issues.push({
      code: "unsupported-add",
      message:
        "tweak cannot add new elements (nodes/edges). Use restructure or edit in Excalidraw UI.",
    });
  }

  if (Array.isArray(diff.remove) && diff.remove.length > 0) {
    issues.push({
      code: "unsupported-remove",
      message:
        "tweak cannot remove elements (nodes/edges). Use restructure or edit in Excalidraw UI.",
    });
  }

  for (const entry of diff.modify ?? []) {
    if (!entry) {
      continue;
    }
    const changes = entry.changes;
    if (!changes || typeof changes !== "object") {
      continue;
    }
    for (const key of Object.keys(changes)) {
      if (!DISALLOWED_TWEAK_CHANGE_KEYS.has(key)) {
        continue;
      }
      issues.push({
        code: "unsupported-geometry",
        elementId: entry.id,
        message: `tweak cannot change '${key}'. Layout/geometry changes belong in the Excalidraw UI.`,
      });
    }
  }

  return issues;
}

function detectUnsupportedTweakRequest(request: string): DiagramIssue[] | null {
  const normalized = request.toLowerCase();
  const reasons: string[] = [];

  const structuralHints = [
    "add ",
    "remove ",
    "delete ",
    "create ",
    "insert ",
    "new node",
    "new edge",
    "new arrow",
    "connect ",
    "disconnect ",
    "restructure",
  ];
  if (structuralHints.some((hint) => normalized.includes(hint))) {
    reasons.push(
      "structural change requested (add/remove/connect/restructure)"
    );
  }

  const layoutHints = [
    "layout",
    "re-layout",
    "relayout",
    "align",
    "center",
    "spacing",
    "space out",
    "move ",
    "position",
    "resize",
    "bigger",
    "smaller",
    "prettier",
    "beautify",
    "tidy",
    "organize",
  ];
  if (layoutHints.some((hint) => normalized.includes(hint))) {
    reasons.push("layout/geometry requested");
  }

  const geometryFieldEdit = GEOMETRY_FIELD_ASSIGNMENT_RE.test(request);
  if (geometryFieldEdit) {
    reasons.push("explicit geometry edits (x/y/width/height) requested");
  }

  if (reasons.length === 0) {
    return null;
  }

  return [
    {
      code: "unsupported-request",
      message: `tweak only supports tactical edits (text/colors/flip existing arrow direction). Use restructure for structural changes. Detected: ${reasons.join(", ")}.`,
    },
  ];
}

interface DiagramChangeSet {
  addedIds: string[];
  removedIds: string[];
  modifiedIds: string[];
}

interface LastSuccessfulDiff {
  elements: unknown[];
  changes: DiagramChangeSet;
  diff: DiagramElementDiff;
}

interface ValidationToolOutput {
  ok: boolean;
  issues?: DiagramIssue[];
  elements?: unknown[];
  changes?: DiagramChangeSet;
}

function isValidationToolOutput(
  output: unknown
): output is ValidationToolOutput {
  if (!output || typeof output !== "object") {
    return false;
  }
  if (!("ok" in output)) {
    return false;
  }
  return typeof (output as { ok?: unknown }).ok === "boolean";
}

interface ModificationTracking {
  lastSuccessful: LastSuccessfulDiff | null;
  lastIssues: DiagramIssue[];
  stepCount: number;
  tokenCount: number;
  lastStepAt: number;
}

function summarizeElements(elements: Record<string, unknown>[]) {
  return elements.map((element) => {
    const start =
      (element.startBinding as { elementId?: string } | undefined)?.elementId ??
      (element.start as { id?: string } | undefined)?.id ??
      null;
    const end =
      (element.endBinding as { elementId?: string } | undefined)?.elementId ??
      (element.end as { id?: string } | undefined)?.id ??
      null;
    const boundElements = Array.isArray(element.boundElements)
      ? (element.boundElements as Array<{ id?: string }>).map(
          (bound) => bound.id
        )
      : null;

    return {
      id: element.id,
      type: element.type,
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
      text:
        (typeof element.text === "string" && element.text) ||
        (typeof element.label === "object" &&
        element.label &&
        "text" in element.label
          ? (element.label as { text?: string }).text
          : null),
      start,
      end,
      containerId: element.containerId ?? null,
      boundElements,
      strokeColor: element.strokeColor ?? null,
      backgroundColor: element.backgroundColor ?? null,
    };
  });
}

function summarizeLabels(elements: Record<string, unknown>[]) {
  return elements
    .filter((element) => element.type === "text" && element.containerId)
    .map((element) => ({
      textId: element.id,
      containerId: element.containerId,
      text: element.text,
      originalText: element.originalText ?? null,
    }));
}

function extractExplicitEdits(request: string): Array<{
  id: string;
  path: string;
  value: string;
}> {
  const edits: Array<{ id: string; path: string; value: string }> = [];
  const regex = /([a-zA-Z0-9_-]+)\s+([a-zA-Z0-9_.]+)\s*=\s*'([^']+)'/g;
  let match: RegExpExecArray | null = regex.exec(request);
  while (match !== null) {
    edits.push({
      id: match[1] ?? "",
      path: match[2] ?? "",
      value: match[3] ?? "",
    });
    match = regex.exec(request);
  }
  return edits.filter((edit) => edit.id && edit.path);
}

function findMissingEdits(
  diff: DiagramElementDiff,
  edits: Array<{ id: string; path: string; value: string }>
): DiagramIssue[] {
  const issues: DiagramIssue[] = [];
  const modifyList = diff.modify ?? [];

  for (const edit of edits) {
    const entry = modifyList.find((item) => item.id === edit.id);
    if (!entry) {
      issues.push({
        code: "missing-change",
        elementId: edit.id,
        message: `Missing required change for '${edit.id}.${edit.path}'`,
      });
      continue;
    }

    const currentValue = getValueAtPath(entry.changes, edit.path);
    if (String(currentValue ?? "") !== edit.value) {
      issues.push({
        code: "missing-change",
        elementId: edit.id,
        message: `Expected '${edit.id}.${edit.path}' to be '${edit.value}'`,
      });
    }
  }

  return issues;
}

function getValueAtPath(value: unknown, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = value;
  for (const part of parts) {
    if (!current || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function buildDiffFromExplicitEdits(
  edits: Array<{ id: string; path: string; value: string }>
): DiagramElementDiff {
  const changesById = new Map<string, Record<string, unknown>>();

  for (const edit of edits) {
    const current = changesById.get(edit.id) ?? {};
    setValueAtPath(current, edit.path, edit.value);
    changesById.set(edit.id, current);
  }

  const modify = Array.from(changesById.entries()).map(([id, changes]) => ({
    id,
    changes,
  }));

  return { modify };
}

function setValueAtPath(
  target: Record<string, unknown>,
  path: string,
  value: unknown
) {
  const parts = path.split(".");
  let current: Record<string, unknown> = target;
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (!part) {
      continue;
    }
    if (i === parts.length - 1) {
      current[part] = value;
      return;
    }
    const next = current[part];
    if (!next || typeof next !== "object") {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
}

function buildStatsResult(
  startedAt: number,
  traceId: string,
  iterations: number,
  tokens: number
): DiagramModifyStats {
  return {
    iterations,
    tokens,
    durationMs: Date.now() - startedAt,
    traceId,
  };
}

function buildFailureResult(
  reason: DiagramModifyResult["reason"],
  issues: DiagramIssue[],
  stats: DiagramModifyStats
): DiagramModifyResult {
  return {
    status: "failed",
    reason,
    issues,
    stats,
  };
}

function buildSuccessResult(params: {
  elements: unknown[];
  appState?: Record<string, unknown>;
  diff?: DiagramElementDiff;
  changes?: DiagramChangeSet;
  stats: DiagramModifyStats;
}): DiagramModifyResult {
  let changes:
    | {
        diff?: DiagramElementDiff;
        addedIds?: string[];
        removedIds?: string[];
        modifiedIds?: string[];
      }
    | undefined;

  if (params.changes) {
    changes = {
      diff: params.diff,
      addedIds: params.changes.addedIds,
      removedIds: params.changes.removedIds,
      modifiedIds: params.changes.modifiedIds,
    };
  } else if (params.diff) {
    changes = { diff: params.diff };
  }

  return {
    status: "success",
    elements: params.elements,
    appState: params.appState,
    changes,
    stats: params.stats,
  };
}

function buildModificationPrompt(
  request: string,
  elements: Record<string, unknown>[]
): string {
  const summary = summarizeElements(elements);
  const labels = summarizeLabels(elements);
  return [
    `Modification request: ${request}`,
    "",
    "Elements summary (for reasoning):",
    JSON.stringify(summary),
    "",
    "Label elements (text bindings):",
    JSON.stringify(labels),
    "",
    "Full elements (for reference):",
    JSON.stringify(elements),
  ].join("\n");
}

function collectToolOutputs(result: {
  steps: Array<{
    toolResults?: Array<{ toolName?: string; output?: unknown }>;
  }>;
}): ValidationToolOutput[] {
  return result.steps.flatMap((step) =>
    (step.toolResults ?? [])
      .filter((toolResult) => toolResult.toolName === "validateAndApplyDiff")
      .map((toolResult) => toolResult.output)
      .filter(isValidationToolOutput)
  );
}

function resolveAgentOutcome(params: {
  result: {
    steps: Array<{
      toolResults?: Array<{ toolName?: string; output?: unknown }>;
    }>;
    output: DiagramElementDiff;
    totalUsage: { totalTokens?: number };
  };
  elements: Record<string, unknown>[];
  appState?: Record<string, unknown>;
  startedAt: number;
  traceId: string;
}): DiagramModifyResult {
  const toolOutputs = collectToolOutputs(params.result);
  const lastToolOutput =
    // biome-ignore lint/style/useAtIndex: Array.at not available in Convex tsconfig
    toolOutputs.length > 0 ? toolOutputs[toolOutputs.length - 1] : undefined;
  const failedIssues = toolOutputs
    .filter((output) => !output.ok)
    .flatMap((output) => output.issues ?? []);
  const stats = buildStatsResult(
    params.startedAt,
    params.traceId,
    params.result.steps.length,
    params.result.totalUsage.totalTokens ?? 0
  );

  if (!lastToolOutput) {
    const applied = applyDiagramDiff(
      params.elements as unknown as Parameters<typeof applyDiagramDiff>[0],
      params.result.output
    );
    if (applied.ok) {
      return buildSuccessResult({
        elements: applied.elements,
        appState: params.appState,
        diff: params.result.output,
        changes: applied.changes,
        stats,
      });
    }
    return buildFailureResult("invalid-diff", applied.issues, stats);
  }

  if (lastToolOutput?.ok && lastToolOutput.elements) {
    return buildSuccessResult({
      elements: lastToolOutput.elements,
      appState: params.appState,
      diff: params.result.output,
      changes: lastToolOutput.changes,
      stats,
    });
  }

  return buildFailureResult(
    "invalid-diff",
    failedIssues.length > 0
      ? failedIssues
      : [
          {
            code: "invalid-diff",
            message: "No valid diff produced before the tool loop ended",
          },
        ],
    stats
  );
}

function applyExplicitEditsIfPreferred(params: {
  preferExplicitEdits?: boolean;
  explicitEdits: Array<{ id: string; path: string; value: string }>;
  elements: Record<string, unknown>[];
  appState?: Record<string, unknown>;
  startedAt: number;
  traceId: string;
}): DiagramModifyResult | null {
  if (!params.preferExplicitEdits || params.explicitEdits.length === 0) {
    return null;
  }

  const diff = buildDiffFromExplicitEdits(params.explicitEdits);
  const stats = buildStatsResult(params.startedAt, params.traceId, 0, 0);
  const constraintIssues = validateTweakDiffConstraints(diff);
  if (constraintIssues.length > 0) {
    return buildFailureResult("unsupported-request", constraintIssues, stats);
  }
  const applied = applyDiagramDiff(
    params.elements as unknown as Parameters<typeof applyDiagramDiff>[0],
    diff
  );

  if (!applied.ok) {
    return buildFailureResult("invalid-diff", applied.issues, stats);
  }

  return buildSuccessResult({
    elements: applied.elements,
    appState: params.appState,
    diff,
    changes: applied.changes,
    stats,
  });
}

function createValidationTool(params: {
  elements: Record<string, unknown>[];
  explicitEdits: Array<{ id: string; path: string; value: string }>;
  tracking: ModificationTracking;
}) {
  return tool({
    description:
      "Validate the proposed diff, apply it to the current elements, and return issues (if any).",
    inputSchema: DiagramElementDiffSchema,
    execute: (diff: DiagramElementDiff) => {
      if (params.explicitEdits.length > 0) {
        const missingEdits = findMissingEdits(diff, params.explicitEdits);
        if (missingEdits.length > 0) {
          params.tracking.lastIssues = missingEdits;
          return { ok: false as const, issues: missingEdits };
        }
      }
      const constraintIssues = validateTweakDiffConstraints(diff);
      if (constraintIssues.length > 0) {
        params.tracking.lastIssues = constraintIssues;
        return { ok: false as const, issues: constraintIssues };
      }
      const result = applyDiagramDiff(
        params.elements as unknown as Parameters<typeof applyDiagramDiff>[0],
        diff
      );
      if (!result.ok) {
        params.tracking.lastIssues = result.issues;
        return { ok: false as const, issues: result.issues };
      }
      params.tracking.lastSuccessful = {
        elements: result.elements,
        changes: result.changes,
        diff,
      };
      return {
        ok: true as const,
        elements: result.elements,
        changes: result.changes,
      };
    },
  });
}

function stopOnSuccess({
  steps,
}: {
  steps: Array<{
    toolResults?: Array<{ toolName?: string; output?: unknown }>;
  }>;
}) {
  for (const step of steps) {
    for (const result of step.toolResults ?? []) {
      if (result.toolName !== "validateAndApplyDiff") {
        continue;
      }
      const output = result.output as { ok?: boolean } | undefined;
      if (output?.ok === true) {
        return true;
      }
    }
  }
  return false;
}

function createModificationAgent(params: {
  validationTool: ReturnType<typeof createValidationTool>;
  traceId: string;
  tracking: ModificationTracking;
  maxSteps?: number;
}) {
  return new ToolLoopAgent({
    model: createOpenRouterChatModel({
      modelId: DEFAULT_MODEL,
      traceId: params.traceId,
    }),
    temperature: 0,
    instructions: MODIFICATION_SYSTEM_PROMPT,
    output: Output.object({ schema: DiagramElementDiffSchema }),
    tools: {
      validateAndApplyDiff: params.validationTool,
    },
    stopWhen: [
      stepCountIs(params.maxSteps ?? DEFAULT_MAX_STEPS),
      stopOnSuccess,
    ],
    onStepFinish: ({ usage, toolCalls }) => {
      const now = Date.now();
      const stepIndex = params.tracking.stepCount + 1;
      const stepDurationMs = now - params.tracking.lastStepAt;
      params.tracking.lastStepAt = now;
      params.tracking.stepCount = stepIndex;
      params.tracking.tokenCount += usage.totalTokens ?? 0;
      logEventSafely({
        traceId: params.traceId,
        actionName: "diagramModifyElements",
        component: "ai",
        op: "ai.step",
        stage: "modify.step",
        status: "success",
        modelId: DEFAULT_MODEL,
        provider: "openrouter",
        step: stepIndex,
        stepDurationMs,
        toolCalls: toolCalls?.length ?? 0,
        tokens: usage.totalTokens ?? 0,
      });
      console.log("[ai.diagramModifyElements.step]", {
        traceId: params.traceId,
        toolCalls: toolCalls?.length ?? 0,
        totalTokens: usage.totalTokens,
      });
    },
  });
}

async function runAgentAttempts(params: {
  agent: ReturnType<typeof createModificationAgent>;
  elements: Record<string, unknown>[];
  prompt: string;
  deadline: number;
  startedAt: number;
  traceId: string;
  appState?: Record<string, unknown>;
}): Promise<{ outcome?: DiagramModifyResult; lastError?: unknown }> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const remaining = params.deadline - Date.now();
    if (remaining <= 0) {
      break;
    }

    try {
      logEventSafely({
        traceId: params.traceId,
        actionName: "diagramModifyElements",
        component: "ai",
        op: "ai.attempt.start",
        stage: "modify.attempt",
        attempt: attempt + 1,
        maxAttempts: 2,
        timeoutMs: remaining,
        modelId: DEFAULT_MODEL,
        provider: "openrouter",
      });
      const result = await params.agent.generate({
        prompt: params.prompt,
        timeout: remaining,
      });
      console.log("[ai.diagramModifyElements.completed]", {
        traceId: params.traceId,
        responseId: result.response.id,
      });
      return {
        outcome: resolveAgentOutcome({
          result,
          elements: params.elements,
          appState: params.appState,
          startedAt: params.startedAt,
          traceId: params.traceId,
        }),
      };
    } catch (error) {
      lastError = error;
      logEventSafely(
        {
          traceId: params.traceId,
          actionName: "diagramModifyElements",
          component: "ai",
          op: "ai.attempt",
          stage: "modify.attempt",
          status: "failed",
          attempt: attempt + 1,
          maxAttempts: 2,
          modelId: DEFAULT_MODEL,
          provider: "openrouter",
          errorName: error instanceof Error ? error.name : undefined,
          errorMessage: error instanceof Error ? error.message : String(error),
        },
        { level: "warning" }
      );
    }
  }

  return { lastError };
}

function logExplicitResult(
  traceId: string,
  explicitResult: DiagramModifyResult | null
): DiagramModifyResult | null {
  if (!explicitResult) {
    return null;
  }

  const level = explicitResult.status === "success" ? "info" : "error";
  logEventSafely(
    {
      traceId,
      actionName: "diagramModifyElements",
      op: "pipeline.complete",
      stage: "explicit",
      status: explicitResult.status === "success" ? "success" : "failed",
      durationMs: explicitResult.stats.durationMs,
      iterations: explicitResult.stats.iterations,
      tokens: explicitResult.stats.tokens,
      elementCount: explicitResult.elements?.length ?? 0,
      issuesCount: explicitResult.issues?.length ?? 0,
    },
    { level }
  );

  return explicitResult;
}

function logOutcomeResult(
  traceId: string,
  outcome?: DiagramModifyResult
): DiagramModifyResult | null {
  if (!outcome) {
    return null;
  }

  const level = outcome.status === "success" ? "info" : "error";
  logEventSafely(
    {
      traceId,
      actionName: "diagramModifyElements",
      op: "pipeline.complete",
      stage: "complete",
      status: outcome.status === "success" ? "success" : "failed",
      durationMs: outcome.stats.durationMs,
      iterations: outcome.stats.iterations,
      tokens: outcome.stats.tokens,
      issuesCount: outcome.issues?.length ?? 0,
      elementCount: outcome.elements?.length ?? 0,
    },
    { level }
  );

  return outcome;
}

function logInvalidElementsFailure(
  traceId: string,
  issues: DiagramIssue[],
  startedAt: number
): DiagramModifyResult {
  const stats = buildStatsResult(startedAt, traceId, 0, 0);
  logEventSafely(
    {
      traceId,
      actionName: "diagramModifyElements",
      op: "pipeline.complete",
      stage: "validate",
      status: "failed",
      durationMs: stats.durationMs,
      issuesCount: issues.length,
    },
    { level: "error" }
  );
  return buildFailureResult("invalid-elements", issues, stats);
}

function logFallbackSuccess(params: {
  traceId: string;
  startedAt: number;
  tracking: ModificationTracking;
  appState?: Record<string, unknown>;
}): DiagramModifyResult {
  const stats = buildStatsResult(
    params.startedAt,
    params.traceId,
    params.tracking.stepCount,
    params.tracking.tokenCount
  );
  logEventSafely({
    traceId: params.traceId,
    actionName: "diagramModifyElements",
    op: "pipeline.complete",
    stage: "complete",
    status: "success",
    durationMs: stats.durationMs,
    iterations: stats.iterations,
    tokens: stats.tokens,
    elementCount: params.tracking.lastSuccessful?.elements.length ?? 0,
  });
  return buildSuccessResult({
    elements: params.tracking.lastSuccessful?.elements ?? [],
    appState: params.appState,
    diff: params.tracking.lastSuccessful?.diff,
    changes: params.tracking.lastSuccessful?.changes,
    stats,
  });
}

function buildErrorIssues(
  tracking: ModificationTracking,
  lastError?: unknown
): DiagramIssue[] {
  if (tracking.lastIssues.length > 0) {
    return tracking.lastIssues;
  }
  return [
    {
      code: "error",
      message:
        lastError instanceof Error
          ? lastError.message
          : String(lastError ?? "Unknown error"),
    },
  ];
}

function logTerminalFailure(params: {
  traceId: string;
  startedAt: number;
  tracking: ModificationTracking;
  issues: DiagramIssue[];
}): DiagramModifyResult {
  const stats = buildStatsResult(
    params.startedAt,
    params.traceId,
    params.tracking.stepCount,
    params.tracking.tokenCount
  );
  logEventSafely(
    {
      traceId: params.traceId,
      actionName: "diagramModifyElements",
      op: "pipeline.complete",
      stage: "complete",
      status: "failed",
      durationMs: stats.durationMs,
      iterations: stats.iterations,
      tokens: stats.tokens,
      issuesCount: params.issues.length,
    },
    { level: "error" }
  );
  return buildFailureResult("error", params.issues, stats);
}

export async function modifyElementsWithAgent(
  args: {
    elements: unknown[];
    appState?: Record<string, unknown>;
    request: string;
    options?: {
      maxSteps?: number;
      timeoutMs?: number;
      preferExplicitEdits?: boolean;
    };
  },
  traceId: string
): Promise<DiagramModifyResult> {
  const startedAt = Date.now();
  const elements = Array.isArray(args.elements)
    ? (args.elements as Record<string, unknown>[])
    : [];
  const requestLength = args.request.length;
  const requestHash = hashString(args.request);

  logEventSafely({
    traceId,
    actionName: "diagramModifyElements",
    op: "pipeline.start",
    stage: "input",
    status: "success",
    requestLength,
    requestHash,
    elementCount: elements.length,
  });
  const elementIssues = validateElements(
    elements as unknown as Parameters<typeof validateElements>[0]
  );

  if (elementIssues.length > 0) {
    return logInvalidElementsFailure(traceId, elementIssues, startedAt);
  }

  const elementIds = new Set(elements.map((element) => String(element.id)));
  const explicitEdits = extractExplicitEdits(args.request).filter((edit) =>
    elementIds.has(edit.id)
  );

  const explicitPreferred =
    args.options?.preferExplicitEdits === true && explicitEdits.length > 0;
  if (!explicitPreferred) {
    const unsupportedIssues = detectUnsupportedTweakRequest(args.request);
    if (unsupportedIssues) {
      const stats = buildStatsResult(startedAt, traceId, 0, 0);
      logEventSafely(
        {
          traceId,
          actionName: "diagramModifyElements",
          op: "pipeline.scope",
          stage: "request.classify",
          status: "failed",
          issuesCount: unsupportedIssues.length,
        },
        { level: "warning" }
      );
      return buildFailureResult(
        "unsupported-request",
        unsupportedIssues,
        stats
      );
    }
  }

  const explicitResult = applyExplicitEditsIfPreferred({
    preferExplicitEdits: args.options?.preferExplicitEdits,
    explicitEdits,
    elements,
    appState: args.appState,
    startedAt,
    traceId,
  });
  const explicitLogged = logExplicitResult(traceId, explicitResult);
  if (explicitLogged) {
    return explicitLogged;
  }

  const tracking: ModificationTracking = {
    lastSuccessful: null,
    lastIssues: [],
    stepCount: 0,
    tokenCount: 0,
    lastStepAt: Date.now(),
  };
  const validationTool = createValidationTool({
    elements,
    explicitEdits,
    tracking,
  });
  const agent = createModificationAgent({
    validationTool,
    traceId,
    tracking,
    maxSteps: args.options?.maxSteps,
  });
  const prompt = buildModificationPrompt(args.request, elements);
  const deadline = Date.now() + (args.options?.timeoutMs ?? MAX_TIMEOUT_MS);

  const { outcome, lastError } = await runAgentAttempts({
    agent,
    elements,
    prompt,
    deadline,
    startedAt,
    traceId,
    appState: args.appState,
  });

  const outcomeLogged = logOutcomeResult(traceId, outcome);
  if (outcomeLogged) {
    return outcomeLogged;
  }

  if (tracking.lastSuccessful) {
    return logFallbackSuccess({
      traceId,
      startedAt,
      tracking,
      appState: args.appState,
    });
  }

  const errorIssues = buildErrorIssues(tracking, lastError);
  return logTerminalFailure({
    traceId,
    startedAt,
    tracking,
    issues: errorIssues,
  });
}

export const diagramModifyElements = action({
  args: {
    elements: v.array(v.any()),
    appState: v.optional(v.any()),
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
    const traceId = createTraceId();
    const appState =
      (args.appState as Record<string, unknown> | undefined) ?? undefined;

    return await modifyElementsWithAgent(
      {
        elements: args.elements,
        appState,
        request: args.request,
        options: args.options ?? undefined,
      },
      traceId
    );
  },
});
