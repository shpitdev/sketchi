import { gateway, Output, stepCountIs, ToolLoopAgent, tool } from "ai";
import { v } from "convex/values";
import type { DiagramElementDiff } from "../lib/diagram-modification";
import {
  applyDiagramDiff,
  DiagramElementDiffSchema,
  validateElements,
} from "../lib/diagram-modification";
import { action } from "./_generated/server";

const DEFAULT_MAX_STEPS = 5;
const MAX_TIMEOUT_MS = 240_000;
const DEFAULT_MODEL =
  process.env.MODEL_NAME?.includes("gemini-3") === true
    ? process.env.MODEL_NAME
    : "google/gemini-3-flash";

const MODIFICATION_SYSTEM_PROMPT = `You modify existing Excalidraw diagrams by producing an element-level diff.

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
- If you remove an element that others reference, you must also update those references.
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
  reason?: "invalid-elements" | "invalid-diff" | "error";
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

interface ModificationTracking {
  lastSuccessful: LastSuccessfulDiff | null;
  lastIssues: DiagramIssue[];
  stepCount: number;
  tokenCount: number;
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
      .map((toolResult) => toolResult.output as ValidationToolOutput)
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
  const applied = applyDiagramDiff(
    params.elements as unknown as Parameters<typeof applyDiagramDiff>[0],
    diff
  );
  const stats = buildStatsResult(params.startedAt, params.traceId, 0, 0);

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
    model: gateway(DEFAULT_MODEL),
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
      params.tracking.stepCount += 1;
      params.tracking.tokenCount += usage.totalTokens ?? 0;
      console.log(
        `[${params.traceId}] Step: tools=${toolCalls?.length ?? 0}, tokens=${usage.totalTokens}`
      );
    },
  });
}

async function runAgentAttempts(params: {
  agent: ReturnType<typeof createModificationAgent>;
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
      const result = await params.agent.generate({
        prompt: params.prompt,
        timeout: remaining,
      });
      return {
        outcome: resolveAgentOutcome({
          result,
          appState: params.appState,
          startedAt: params.startedAt,
          traceId: params.traceId,
        }),
      };
    } catch (error) {
      lastError = error;
    }
  }

  return { lastError };
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
  const elementIssues = validateElements(
    elements as unknown as Parameters<typeof validateElements>[0]
  );

  if (elementIssues.length > 0) {
    const stats = buildStatsResult(startedAt, traceId, 0, 0);
    return buildFailureResult("invalid-elements", elementIssues, stats);
  }

  const elementIds = new Set(elements.map((element) => String(element.id)));
  const explicitEdits = extractExplicitEdits(args.request).filter((edit) =>
    elementIds.has(edit.id)
  );

  const explicitResult = applyExplicitEditsIfPreferred({
    preferExplicitEdits: args.options?.preferExplicitEdits,
    explicitEdits,
    elements,
    appState: args.appState,
    startedAt,
    traceId,
  });
  if (explicitResult) {
    return explicitResult;
  }

  const tracking: ModificationTracking = {
    lastSuccessful: null,
    lastIssues: [],
    stepCount: 0,
    tokenCount: 0,
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
    prompt,
    deadline,
    startedAt,
    traceId,
    appState: args.appState,
  });

  if (outcome) {
    return outcome;
  }

  if (tracking.lastSuccessful) {
    const stats = buildStatsResult(
      startedAt,
      traceId,
      tracking.stepCount,
      tracking.tokenCount
    );
    return buildSuccessResult({
      elements: tracking.lastSuccessful.elements,
      appState: args.appState,
      diff: tracking.lastSuccessful.diff,
      changes: tracking.lastSuccessful.changes,
      stats,
    });
  }

  const errorIssues =
    tracking.lastIssues.length > 0
      ? tracking.lastIssues
      : [
          {
            code: "error",
            message:
              lastError instanceof Error
                ? lastError.message
                : String(lastError ?? "Unknown error"),
          },
        ];
  const stats = buildStatsResult(
    startedAt,
    traceId,
    tracking.stepCount,
    tracking.tokenCount
  );
  return buildFailureResult("error", errorIssues, stats);
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
    const traceId = crypto.randomUUID();
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
