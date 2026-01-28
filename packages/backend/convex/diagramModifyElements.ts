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
  issues?: Array<{ code: string; message: string; elementId?: string }>;
  stats: DiagramModifyStats;
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
  let match: RegExpExecArray | null;
  while ((match = regex.exec(request)) !== null) {
    edits.push({
      id: match[1] ?? "",
      path: match[2] ?? "",
      value: match[3] ?? "",
    });
  }
  return edits.filter((edit) => edit.id && edit.path);
}

function findMissingEdits(
  diff: DiagramElementDiff,
  edits: Array<{ id: string; path: string; value: string }>
): Array<{ code: string; message: string; elementId?: string }> {
  const issues: Array<{ code: string; message: string; elementId?: string }> =
    [];
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
  const stats: DiagramModifyStats = {
    iterations: 0,
    tokens: 0,
    durationMs: 0,
    traceId,
  };

  if (elementIssues.length > 0) {
    return {
      status: "failed",
      reason: "invalid-elements",
      issues: elementIssues,
      stats: {
        ...stats,
        durationMs: Date.now() - startedAt,
      },
    };
  }

  let lastSuccessful: {
    elements: unknown[];
    changes: {
      addedIds: string[];
      removedIds: string[];
      modifiedIds: string[];
    };
    diff: DiagramElementDiff;
  } | null = null;
  let lastIssues: Array<{ code: string; message: string; elementId?: string }> =
    [];
  let stepCount = 0;
  let tokenCount = 0;
  const elementIds = new Set(elements.map((element) => String(element.id)));
  const explicitEdits = extractExplicitEdits(args.request).filter((edit) =>
    elementIds.has(edit.id)
  );

  if (args.options?.preferExplicitEdits && explicitEdits.length > 0) {
    const diff = buildDiffFromExplicitEdits(explicitEdits);
    const applied = applyDiagramDiff(
      elements as unknown as Parameters<typeof applyDiagramDiff>[0],
      diff
    );
    if (!applied.ok) {
      return {
        status: "failed",
        reason: "invalid-diff",
        issues: applied.issues,
        stats: {
          iterations: 0,
          tokens: 0,
          durationMs: Date.now() - startedAt,
          traceId,
        },
      };
    }

    return {
      status: "success",
      elements: applied.elements,
      appState: args.appState,
      changes: {
        diff,
        addedIds: applied.changes.addedIds,
        removedIds: applied.changes.removedIds,
        modifiedIds: applied.changes.modifiedIds,
      },
      stats: {
        iterations: 0,
        tokens: 0,
        durationMs: Date.now() - startedAt,
        traceId,
      },
    };
  }

  const validationTool = tool({
    description:
      "Validate the proposed diff, apply it to the current elements, and return issues (if any).",
    inputSchema: DiagramElementDiffSchema,
    execute: (diff: DiagramElementDiff) => {
      if (explicitEdits.length > 0) {
        const missingEdits = findMissingEdits(diff, explicitEdits);
        if (missingEdits.length > 0) {
          lastIssues = missingEdits;
          return { ok: false as const, issues: missingEdits };
        }
      }
      const result = applyDiagramDiff(
        elements as unknown as Parameters<typeof applyDiagramDiff>[0],
        diff
      );
      if (!result.ok) {
        lastIssues = result.issues;
        return { ok: false as const, issues: result.issues };
      }
      lastSuccessful = {
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

  const stopOnSuccess = ({
    steps,
  }: {
    steps: Array<{ toolResults?: unknown[] }>;
  }) =>
    steps.some((step) =>
      (step.toolResults ?? []).some((result) => {
        if (
          typeof result === "object" &&
          result &&
          "toolName" in result &&
          (result as { toolName?: string }).toolName ===
            "validateAndApplyDiff" &&
          "output" in result
        ) {
          const output = (result as { output?: { ok?: boolean } }).output;
          return output?.ok === true;
        }
        return false;
      })
    );

  const agent = new ToolLoopAgent({
    model: gateway(DEFAULT_MODEL),
    instructions: MODIFICATION_SYSTEM_PROMPT,
    output: Output.object({ schema: DiagramElementDiffSchema }),
    tools: {
      validateAndApplyDiff: validationTool,
    },
    stopWhen: [
      stepCountIs(args.options?.maxSteps ?? DEFAULT_MAX_STEPS),
      stopOnSuccess,
    ],
    onStepFinish: ({ usage, toolCalls }) => {
      stepCount += 1;
      tokenCount += usage.totalTokens ?? 0;
      console.log(
        `[${traceId}] Step: tools=${toolCalls?.length ?? 0}, tokens=${usage.totalTokens}`
      );
    },
  });

  const summary = summarizeElements(elements);
  const labels = summarizeLabels(elements);
  const prompt = [
    `Modification request: ${args.request}`,
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

  const totalTimeoutMs = args.options?.timeoutMs ?? MAX_TIMEOUT_MS;
  const deadline = Date.now() + totalTimeoutMs;
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      break;
    }

    try {
      const result = await agent.generate({
        prompt,
        timeout: remaining,
      });

      const toolOutputs = result.steps.flatMap((step) =>
        (step.toolResults ?? [])
          .filter(
            (toolResult) => toolResult.toolName === "validateAndApplyDiff"
          )
          .map(
            (toolResult) =>
              toolResult.output as {
                ok: boolean;
                issues?: Array<{
                  code: string;
                  message: string;
                  elementId?: string;
                }>;
                elements?: unknown[];
                changes?: {
                  addedIds: string[];
                  removedIds: string[];
                  modifiedIds: string[];
                };
              }
          )
      );

      const lastToolOutput =
        toolOutputs.length > 0
          ? toolOutputs[toolOutputs.length - 1]
          : undefined;
      const failedIssues = toolOutputs
        .filter((output) => !output.ok)
        .flatMap((output) => output.issues ?? []);

      const statsResult: DiagramModifyStats = {
        iterations: result.steps.length,
        tokens: result.totalUsage.totalTokens ?? 0,
        durationMs: Date.now() - startedAt,
        traceId,
      };

      if (lastToolOutput?.ok && lastToolOutput.elements) {
        return {
          status: "success",
          elements: lastToolOutput.elements,
          appState: args.appState,
          changes: {
            diff: result.output as DiagramElementDiff,
            addedIds: lastToolOutput.changes?.addedIds,
            removedIds: lastToolOutput.changes?.removedIds,
            modifiedIds: lastToolOutput.changes?.modifiedIds,
          },
          stats: statsResult,
        };
      }

      return {
        status: "failed",
        reason: "invalid-diff",
        issues:
          failedIssues.length > 0
            ? failedIssues
            : [
                {
                  code: "invalid-diff",
                  message: "No valid diff produced before the tool loop ended",
                },
              ],
        stats: statsResult,
      };
    } catch (error) {
      lastError = error;
    }
  }

  if (lastSuccessful) {
    const success = lastSuccessful as {
      elements: unknown[];
      changes: {
        addedIds: string[];
        removedIds: string[];
        modifiedIds: string[];
      };
      diff: DiagramElementDiff;
    };
    return {
      status: "success",
      elements: success.elements,
      appState: args.appState,
      changes: {
        diff: success.diff,
        addedIds: success.changes.addedIds,
        removedIds: success.changes.removedIds,
        modifiedIds: success.changes.modifiedIds,
      },
      stats: {
        iterations: stepCount,
        tokens: tokenCount,
        durationMs: Date.now() - startedAt,
        traceId,
      },
    };
  }

  return {
    status: "failed",
    reason: "error",
    issues:
      lastIssues.length > 0
        ? lastIssues
        : [
            {
              code: "error",
              message:
                lastError instanceof Error
                  ? lastError.message
                  : String(lastError),
            },
          ],
    stats: {
      iterations: stepCount,
      tokens: tokenCount,
      durationMs: Date.now() - startedAt,
      traceId,
    },
  };
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
