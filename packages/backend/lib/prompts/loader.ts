import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";
import { getOutputSchema } from "../diagram-intermediate-schemas";
import { type PromptFrontmatter, PromptFrontmatterSchema } from "./schema";

export interface PromptDefinition extends PromptFrontmatter {
  body: string;
  path: string;
}

const VARIABLE_REGEX = /\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g;

function findPlaceholders(body: string): string[] {
  const matches = new Set<string>();
  for (const match of body.matchAll(VARIABLE_REGEX)) {
    const variable = match[1];
    if (variable) {
      matches.add(variable);
    }
  }
  return Array.from(matches);
}

interface ParseResult {
  prompts: PromptDefinition[];
  errors: string[];
  idCounts: Map<string, number>;
}

export interface PromptLibraryLoadResult {
  prompts: PromptDefinition[];
  resolvedPrompts: PromptDefinition[];
  errors: string[];
  warnings: string[];
}

export function loadPromptLibrary(baseDir: string): PromptLibraryLoadResult {
  const files = listMarkdownFiles(baseDir);
  const { prompts, errors: parseErrors, idCounts } = parsePromptFiles(files);
  const duplicateErrors = validateDuplicateIds(idCounts);
  const {
    errors: validationErrors,
    warnings,
    byId,
  } = validatePromptLibrary(prompts);

  const errors = [
    ...parseErrors,
    ...duplicateErrors,
    ...validationErrors,
    ...detectVariantCycles(byId),
  ];

  if (errors.length > 0) {
    return { prompts, resolvedPrompts: [], errors, warnings };
  }

  const resolvedPrompts = prompts.map((prompt) =>
    resolvePromptDefinition(prompt.id, byId, new Set())
  );

  return { prompts, resolvedPrompts, errors, warnings };
}

function parsePromptFiles(files: string[]): ParseResult {
  const prompts: PromptDefinition[] = [];
  const errors: string[] = [];
  const idCounts = new Map<string, number>();

  for (const file of files) {
    try {
      const contents = readFileSync(file, "utf8");
      const parsed = matter(contents);
      const data = PromptFrontmatterSchema.parse(parsed.data);
      const body = parsed.content.trim();
      const prompt = { ...data, body, path: file };
      idCounts.set(prompt.id, (idCounts.get(prompt.id) ?? 0) + 1);
      prompts.push(prompt);
    } catch (error) {
      errors.push(`${file}: ${(error as Error).message}`);
    }
  }

  return { prompts, errors, idCounts };
}

function validateDuplicateIds(idCounts: Map<string, number>): string[] {
  const errors: string[] = [];
  for (const [id, count] of idCounts) {
    if (count > 1) {
      errors.push(`Duplicate prompt id detected: ${id}`);
    }
  }
  return errors;
}

function validatePromptLibrary(prompts: PromptDefinition[]): {
  errors: string[];
  warnings: string[];
  byId: Map<string, PromptDefinition>;
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  const byId = new Map(prompts.map((prompt) => [prompt.id, prompt] as const));

  for (const prompt of prompts) {
    errors.push(...validateOutputSchema(prompt));
    errors.push(...validateVariant(prompt, byId));

    const placeholderResult = validatePlaceholders(prompt);
    errors.push(...placeholderResult.errors);
    warnings.push(...placeholderResult.warnings);

    if (!prompt.body) {
      warnings.push(`Prompt ${prompt.id} has empty body`);
    }
  }

  return { errors, warnings, byId };
}

function validateOutputSchema(prompt: PromptDefinition): string[] {
  const errors: string[] = [];
  const outputSchema = getOutputSchema(prompt.outputSchemaId);
  if (!outputSchema) {
    errors.push(
      `Prompt ${prompt.id} references missing outputSchemaId ${prompt.outputSchemaId}`
    );
  }
  return errors;
}

function validateVariant(
  prompt: PromptDefinition,
  byId: Map<string, PromptDefinition>
): string[] {
  if (!prompt.variantOf) {
    return [];
  }

  const errors: string[] = [];
  const base = byId.get(prompt.variantOf);
  if (!base) {
    errors.push(
      `Prompt ${prompt.id} has variantOf=${prompt.variantOf} which does not exist`
    );
    return errors;
  }

  if (
    prompt.diagramType &&
    base.diagramType &&
    prompt.diagramType !== base.diagramType
  ) {
    errors.push(
      `Prompt ${prompt.id} diagramType does not match base ${prompt.variantOf}`
    );
  }

  if (
    prompt.outputSchemaId &&
    base.outputSchemaId &&
    prompt.outputSchemaId !== base.outputSchemaId
  ) {
    errors.push(
      `Prompt ${prompt.id} outputSchemaId does not match base ${prompt.variantOf}`
    );
  }

  return errors;
}

function validatePlaceholders(prompt: PromptDefinition): {
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  const placeholders = findPlaceholders(prompt.body);
  if (placeholders.length === 0) {
    return { errors, warnings };
  }

  const declared = new Set(prompt.variables?.map((v) => v.name) ?? []);
  for (const placeholder of placeholders) {
    if (!declared.has(placeholder)) {
      errors.push(
        `Prompt ${prompt.id} uses {{${placeholder}}} without declaring variable`
      );
    }
  }

  for (const variable of declared) {
    if (!placeholders.includes(variable)) {
      warnings.push(
        `Prompt ${prompt.id} declares variable '${variable}' but does not use it`
      );
    }
  }

  return { errors, warnings };
}

export function resolvePromptDefinition(
  id: string,
  byId: Map<string, PromptDefinition>,
  visited = new Set<string>()
): PromptDefinition {
  if (visited.has(id)) {
    throw new Error(`Prompt variant cycle detected at ${id}`);
  }

  const prompt = byId.get(id);
  if (!prompt) {
    throw new Error(`Prompt not found: ${id}`);
  }

  if (!prompt.variantOf) {
    return prompt;
  }

  visited.add(id);
  const base = resolvePromptDefinition(prompt.variantOf, byId, visited);
  visited.delete(id);

  return mergePrompt(base, prompt);
}

function mergePrompt(
  base: PromptDefinition,
  variant: PromptDefinition
): PromptDefinition {
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
  base?: PromptDefinition["variables"],
  variant?: PromptDefinition["variables"]
): PromptDefinition["variables"] | undefined {
  if (!(base || variant)) {
    return undefined;
  }
  const entries = new Map<
    string,
    NonNullable<PromptDefinition["variables"]>[number]
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

function listMarkdownFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      files.push(...listMarkdownFiles(fullPath));
    } else if (entry.endsWith(".md")) {
      files.push(fullPath);
    }
  }
  return files;
}

function detectVariantCycles(byId: Map<string, PromptDefinition>): string[] {
  const errors: string[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (id: string) => {
    if (visited.has(id)) {
      return;
    }
    if (visiting.has(id)) {
      errors.push(`Variant cycle detected at ${id}`);
      return;
    }

    const prompt = byId.get(id);
    if (!prompt?.variantOf) {
      visited.add(id);
      return;
    }

    visiting.add(id);
    visit(prompt.variantOf);
    visiting.delete(id);
    visited.add(id);
  };

  for (const id of byId.keys()) {
    visit(id);
  }

  return errors;
}
