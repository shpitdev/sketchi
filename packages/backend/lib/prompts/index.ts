import { PROMPTS, type PromptId } from "./prompts.generated";
import type { PromptRecord, PromptVariables } from "./types";

const resolvedCache = new Map<PromptId, PromptRecord>();

export function getPrompt(id: PromptId): PromptRecord {
  return PROMPTS[id];
}

export function resolvePrompt(id: PromptId): PromptRecord {
  const cached = resolvedCache.get(id);
  if (cached) {
    return cached;
  }

  const visited = new Set<PromptId>();
  const resolved = resolvePromptInternal(id, visited);
  resolvedCache.set(id, resolved);
  return resolved;
}

export function renderPrompt(
  id: PromptId,
  variables: PromptVariables = {}
): string {
  const prompt = resolvePrompt(id);
  const requiredVariables =
    prompt.variables?.filter((variable) => variable.required) ?? [];
  const missing = requiredVariables
    .filter((variable) => variables[variable.name] == null)
    .map((variable) => variable.name);
  if (missing.length > 0) {
    throw new Error(
      `Missing required variables for prompt ${id}: ${missing.join(", ")}`
    );
  }
  return prompt.body.replace(/\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g, (_, key) => {
    const value = variables[key];
    if (value === undefined) {
      return "";
    }
    return String(value);
  });
}

function resolvePromptInternal(
  id: PromptId,
  visited: Set<PromptId>
): PromptRecord {
  if (visited.has(id)) {
    throw new Error(`Prompt variant cycle detected at ${id}`);
  }

  const prompt = PROMPTS[id];
  if (!prompt) {
    throw new Error(`Prompt not found: ${id}`);
  }

  if (!prompt.variantOf) {
    return prompt;
  }

  visited.add(id);
  const base = resolvePromptInternal(prompt.variantOf as PromptId, visited);
  visited.delete(id);

  return mergePrompt(base, prompt);
}

function mergePrompt(base: PromptRecord, variant: PromptRecord): PromptRecord {
  const variables = mergeVariables(base.variables, variant.variables);
  const tags = mergeTags(base.tags, variant.tags);
  const body = [base.body, variant.body].filter(Boolean).join("\n\n");

  return {
    ...base,
    ...variant,
    diagramType: variant.diagramType ?? base.diagramType,
    outputSchemaId: variant.outputSchemaId ?? base.outputSchemaId,
    variables,
    tags,
    body,
  };
}

function mergeVariables(
  base?: PromptRecord["variables"],
  variant?: PromptRecord["variables"]
): PromptRecord["variables"] | undefined {
  if (!(base || variant)) {
    return undefined;
  }
  const entries = new Map<
    string,
    NonNullable<PromptRecord["variables"]>[number]
  >();
  for (const item of base ?? []) {
    entries.set(item.name, item);
  }
  for (const item of variant ?? []) {
    entries.set(item.name, item);
  }
  return Array.from(entries.values());
}

function mergeTags(base?: string[], variant?: string[]): string[] | undefined {
  if (!(base || variant)) {
    return undefined;
  }
  return Array.from(new Set([...(base ?? []), ...(variant ?? [])]));
}
