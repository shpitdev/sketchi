import {
  DiagramValidationError,
  type FlowchartDiagram,
  FlowchartDiagramSchema,
  FlowchartValidationError,
  type MindmapDiagram,
  MindmapDiagramSchema,
  SKETCHI_DIAGRAM_STYLE,
  parseFlowchartDiagram,
  parseMindmapDiagram,
  safeParseDiagramSchema,
  validateFlowchartDiagram,
  validateMindmapDiagram,
} from "@sketchi/diagram-core";
import { Schema } from "effect";

import { DiagramGenerationPrompt } from "./messages.js";
import {
  GeneratedMindmapTree,
  generatedMindmapTreeToDiagram,
} from "./mindmap-tree.js";

export const diagramGenerationProviderIds: readonly [
  "fixture",
  "cloudflare-google-ai-studio",
  "google-ai-studio",
] = ["fixture", "cloudflare-google-ai-studio", "google-ai-studio"];

export const DiagramGenerationProviderIdSchema = Schema.Literals(
  diagramGenerationProviderIds,
);
export type DiagramGenerationProviderId =
  typeof DiagramGenerationProviderIdSchema.Type;

export const DiagramGenerationCacheModeSchema = Schema.Literals([
  "default",
  "fresh",
]);
export type DiagramGenerationCacheMode =
  typeof DiagramGenerationCacheModeSchema.Type;

export class GeneratedSequenceParticipant extends Schema.Class<GeneratedSequenceParticipant>(
  "GeneratedSequenceParticipant",
)({
  id: Schema.NonEmptyString,
  label: Schema.NonEmptyString,
  kind: Schema.optionalKey(Schema.NonEmptyString),
}) {}

export class GeneratedSequenceMessage extends Schema.Class<GeneratedSequenceMessage>(
  "GeneratedSequenceMessage",
)({
  id: Schema.NonEmptyString,
  source: Schema.NonEmptyString,
  target: Schema.NonEmptyString,
  label: Schema.NonEmptyString,
  type: Schema.optionalKey(Schema.Literals(["message", "return"])),
  style: Schema.optionalKey(Schema.Literals(["solid", "dashed"])),
}) {}

export class GeneratedSequenceDiagram extends Schema.Class<GeneratedSequenceDiagram>(
  "GeneratedSequenceDiagram",
)({
  id: Schema.NonEmptyString,
  title: Schema.NonEmptyString,
  type: Schema.Literal("sequence"),
  participants: Schema.Array(GeneratedSequenceParticipant).pipe(
    Schema.mutable,
    Schema.check(Schema.isMinLength(1)),
  ),
  messages: Schema.Array(GeneratedSequenceMessage).pipe(Schema.mutable),
  style: Schema.optionalKey(
    Schema.Struct({
      accentColor: Schema.String,
      backgroundColor: Schema.String,
    }),
  ),
}) {}

export class DiagramGenerationUsage extends Schema.Class<DiagramGenerationUsage>(
  "DiagramGenerationUsage",
)({
  inputTokens: Schema.optional(Schema.Number).pipe(Schema.mutableKey),
  outputTokens: Schema.optional(Schema.Number).pipe(Schema.mutableKey),
  totalTokens: Schema.optional(Schema.Number).pipe(Schema.mutableKey),
}) {}

export class DiagramGenerationCandidate extends Schema.Class<DiagramGenerationCandidate>(
  "DiagramGenerationCandidate",
)({
  cacheMode: Schema.optional(DiagramGenerationCacheModeSchema),
  diagnostics: Schema.Array(Schema.String).pipe(Schema.mutable),
  diagram: Schema.optional(
    Schema.Union([
      FlowchartDiagramSchema,
      MindmapDiagramSchema,
      GeneratedSequenceDiagram,
    ]),
  ),
  durationMs: Schema.optional(Schema.Number),
  error: Schema.optional(Schema.String),
  model: Schema.String,
  provider: DiagramGenerationProviderIdSchema,
  raw: Schema.optional(Schema.Unknown),
  text: Schema.String,
  usage: Schema.optional(DiagramGenerationUsage),
}) {}

export class DiagramGenerationCandidateSummary extends Schema.Class<DiagramGenerationCandidateSummary>(
  "DiagramGenerationCandidateSummary",
)({
  cacheMode: Schema.optional(DiagramGenerationCacheModeSchema),
  diagnostics: Schema.Array(Schema.String).pipe(Schema.mutable),
  diagramValid: Schema.Boolean,
  durationMs: Schema.optional(Schema.Number),
  error: Schema.optional(Schema.String),
  model: Schema.String,
  provider: DiagramGenerationProviderIdSchema,
  text: Schema.String,
  usage: Schema.optional(DiagramGenerationUsage),
}) {}

export class DiagramGenerationScenarioOutput extends Schema.Class<DiagramGenerationScenarioOutput>(
  "DiagramGenerationScenarioOutput",
)({
  candidates: Schema.Array(DiagramGenerationCandidateSummary).pipe(
    Schema.mutable,
  ),
  model: Schema.String,
  scenarioId: Schema.String,
}) {}

export class DiagramGenerationRequest extends Schema.Class<DiagramGenerationRequest>(
  "DiagramGenerationRequest",
)({
  cacheMode: Schema.optional(DiagramGenerationCacheModeSchema),
  maxOutputTokens: Schema.optional(Schema.Number),
  model: Schema.String,
  prompt: DiagramGenerationPrompt,
  temperature: Schema.optional(Schema.Number),
}) {}

export function extractJsonObject(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const firstBrace = text.indexOf("{");
    if (firstBrace === -1) {
      throw new Error("Model output did not contain a JSON object.");
    }
    let depth = 0;
    let escaped = false;
    let inString = false;
    for (let index = firstBrace; index < text.length; index += 1) {
      const character = text[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') inString = true;
      else if (character === "{") depth += 1;
      else if (character === "}") {
        depth -= 1;
        if (depth === 0) return JSON.parse(text.slice(firstBrace, index + 1));
      }
    }
    throw new Error("Model output did not contain one complete JSON object.");
  }
}

function objectValue(value: unknown, key: string): unknown {
  return isUnknownRecord(value) ? value[key] : undefined;
}

interface UnknownRecord {
  readonly [key: string]: unknown;
}

function isUnknownRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function withSketchiDiagramStyle(input: unknown): unknown {
  return isUnknownRecord(input)
    ? { ...input, style: { ...SKETCHI_DIAGRAM_STYLE } }
    : input;
}

function normalizeGeneratedFlowchartInput(input: unknown): unknown {
  const styled = withSketchiDiagramStyle(input);
  if (!isUnknownRecord(styled) || !Array.isArray(styled["edges"])) {
    return styled;
  }
  return {
    ...styled,
    edges: styled["edges"].map((edge) =>
      isUnknownRecord(edge) &&
      typeof edge["label"] === "string" &&
      edge["label"].trim().length === 0
        ? Object.fromEntries(
            Object.entries(edge).filter(([key]) => key !== "label"),
          )
        : edge,
    ),
  };
}

function firstString(values: readonly unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string");
}

export function responseErrorDiagnostic(raw: unknown): string | undefined {
  const error = objectValue(raw, "error");
  const errors = objectValue(raw, "errors");
  const text = objectValue(raw, "text");
  const nestedErrorMessage = objectValue(error, "message");
  const firstErrorMessage = Array.isArray(errors)
    ? objectValue(errors[0], "message")
    : undefined;
  const message = firstString([
    objectValue(raw, "message"),
    nestedErrorMessage,
    firstErrorMessage,
    typeof error === "string" ? error : undefined,
    typeof text === "string" ? text : undefined,
  ]);

  if (!message) {
    return undefined;
  }

  return message.length > 280 ? `${message.slice(0, 277)}...` : message;
}

export function parseGeneratedFlowchart(text: string): FlowchartDiagram {
  return parseFlowchartDiagram(
    normalizeGeneratedFlowchartInput(extractJsonObject(text)),
  );
}

export function parseGeneratedDiagram(
  text: string,
): FlowchartDiagram | MindmapDiagram | GeneratedSequenceDiagram {
  const extracted = extractJsonObject(text);
  if (isUnknownRecord(extracted) && extracted["type"] === "sequence") {
    return parseGeneratedSequence(extracted);
  }
  if (isUnknownRecord(extracted) && extracted["type"] === "mindmap") {
    if ("root" in extracted) {
      const nested = safeParseDiagramSchema(GeneratedMindmapTree, extracted);
      if (nested.success) return generatedMindmapTreeToDiagram(nested.data);
    }
    return parseMindmapDiagram(withSketchiDiagramStyle(extracted));
  }
  return parseFlowchartDiagram(normalizeGeneratedFlowchartInput(extracted));
}

interface CandidateParseFailure {
  readonly diagnostics: readonly string[];
  readonly error: string;
  readonly success: false;
}

interface CandidateParseSuccess {
  readonly diagram:
    | FlowchartDiagram
    | MindmapDiagram
    | GeneratedSequenceDiagram;
  readonly success: true;
}

type CandidateParseResult = CandidateParseFailure | CandidateParseSuccess;

function parseGeneratedSequence(input: unknown): GeneratedSequenceDiagram {
  const decoded = safeParseDiagramSchema(GeneratedSequenceDiagram, input);
  if (!decoded.success) {
    throw new DiagramValidationError(
      decoded.error.issues[0]?.message ??
        "Generated sequence diagram schema validation failed.",
    );
  }
  const participantIds = new Set<string>();
  for (const participant of decoded.data.participants) {
    if (participantIds.has(participant.id)) {
      throw new DiagramValidationError(
        `Duplicate sequence participant id "${participant.id}" is not allowed.`,
      );
    }
    participantIds.add(participant.id);
  }
  const messageIds = new Set<string>();
  for (const message of decoded.data.messages) {
    if (messageIds.has(message.id)) {
      throw new DiagramValidationError(
        `Duplicate sequence message id "${message.id}" is not allowed.`,
      );
    }
    messageIds.add(message.id);
    if (
      !participantIds.has(message.source) ||
      !participantIds.has(message.target)
    ) {
      throw new DiagramValidationError(
        `Sequence message "${message.id}" references an unknown participant.`,
      );
    }
    if (message.source === message.target) {
      throw new DiagramValidationError(
        `Sequence message "${message.id}" cannot target its source participant.`,
      );
    }
  }
  return decoded.data;
}

function schemaIssueDiagnostic(issue: {
  readonly message: string;
  readonly path: readonly PropertyKey[];
}): string {
  const path =
    issue.path.length > 0 ? issue.path.map(String).join(".") : "diagram";
  return `schema_error at ${path}: ${issue.message}`;
}

function diagramValidationFailure(error: unknown): CandidateParseFailure {
  if (error instanceof FlowchartValidationError) {
    return {
      diagnostics: error.issues.map(
        (entry) =>
          `flowchart.${entry.code}: ${entry.message} Hint: ${entry.hint}`,
      ),
      error: error.message,
      success: false,
    };
  }

  const message =
    error instanceof DiagramValidationError || error instanceof Error
      ? error.message
      : "Generated diagram parse failed.";
  return {
    diagnostics: [`diagram_validation_error: ${message}`],
    error: message,
    success: false,
  };
}

function parseCandidateDiagram(text: string): CandidateParseResult {
  let extracted: unknown;
  try {
    extracted = extractJsonObject(text);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Generated diagram parse failed.";
    return {
      diagnostics: [`json_parse_error: ${message}`],
      error: message,
      success: false,
    };
  }

  if (isUnknownRecord(extracted) && extracted["type"] === "mindmap") {
    if ("root" in extracted) {
      const decoded = safeParseDiagramSchema(GeneratedMindmapTree, extracted);
      if (!decoded.success) {
        const diagnostics = decoded.error.issues.map(schemaIssueDiagnostic);
        return {
          diagnostics,
          error:
            diagnostics[0] ?? "Generated mindmap schema validation failed.",
          success: false,
        };
      }
      try {
        return {
          diagram: generatedMindmapTreeToDiagram(decoded.data),
          success: true,
        };
      } catch (error) {
        return diagramValidationFailure(error);
      }
    }
    const decoded = safeParseDiagramSchema(
      MindmapDiagramSchema,
      withSketchiDiagramStyle(extracted),
    );
    if (!decoded.success) {
      const diagnostics = decoded.error.issues.map(schemaIssueDiagnostic);
      return {
        diagnostics,
        error: diagnostics[0] ?? "Generated diagram schema validation failed.",
        success: false,
      };
    }
    try {
      return { diagram: validateMindmapDiagram(decoded.data), success: true };
    } catch (error) {
      return diagramValidationFailure(error);
    }
  }

  if (isUnknownRecord(extracted) && extracted["type"] === "sequence") {
    const decoded = safeParseDiagramSchema(GeneratedSequenceDiagram, extracted);
    if (!decoded.success) {
      const diagnostics = decoded.error.issues.map(schemaIssueDiagnostic);
      return {
        diagnostics,
        error:
          diagnostics[0] ??
          "Generated sequence diagram schema validation failed.",
        success: false,
      };
    }
    try {
      return { diagram: parseGeneratedSequence(extracted), success: true };
    } catch (error) {
      return diagramValidationFailure(error);
    }
  }

  const decoded = safeParseDiagramSchema(
    FlowchartDiagramSchema,
    normalizeGeneratedFlowchartInput(extracted),
  );
  if (!decoded.success) {
    const diagnostics = decoded.error.issues.map(schemaIssueDiagnostic);
    return {
      diagnostics,
      error: diagnostics[0] ?? "Generated diagram schema validation failed.",
      success: false,
    };
  }
  try {
    return { diagram: validateFlowchartDiagram(decoded.data), success: true };
  } catch (error) {
    return diagramValidationFailure(error);
  }
}

export function candidateFromText(
  input: Omit<DiagramGenerationCandidate, "diagnostics" | "text"> & {
    diagnostics?: string[];
    text: string;
  },
): DiagramGenerationCandidate {
  const diagnostics = [...(input.diagnostics ?? [])];

  if (input.error) {
    return {
      ...input,
      diagnostics,
    };
  }

  const parsed = parseCandidateDiagram(input.text);
  if (parsed.success) {
    return {
      ...input,
      diagnostics,
      diagram: parsed.diagram,
    };
  }

  diagnostics.push(...parsed.diagnostics);
  return {
    ...input,
    diagnostics,
    error: parsed.error,
  };
}

const EXPLICIT_MINIMUM_PATTERN =
  /\bat least\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:(?:distinct|labeled)\s+)?(steps?|nodes?|topics?|decisions?(?:\s+nodes?)?)\b/giu;
const LOOP_REQUIREMENT_PATTERN =
  /\b(?:feedback|review|resubmission|retry|revision|remediation|investigation)\s+loop\b|\bloop(?:s|ed|ing)?\s+(?:back|through|to)\b|\breturns?\s+to\b/iu;
const NUMBER_WORD_COUNTS: Readonly<Record<string, number>> = {
  eight: 8,
  five: 5,
  four: 4,
  nine: 9,
  one: 1,
  seven: 7,
  six: 6,
  ten: 10,
  three: 3,
  two: 2,
};

export interface ExplicitRequestMinimum {
  readonly expectedCount: number;
  readonly expectedUnit: "decision nodes" | "nodes" | "topics";
  readonly requestedCount: number;
  readonly requestedUnit: string;
}

function requestedCount(value: string): number | undefined {
  const numeric = Number.parseInt(value, 10);
  return Number.isInteger(numeric)
    ? numeric
    : NUMBER_WORD_COUNTS[value.toLowerCase()];
}

export function explicitRequestMinimums(
  request: string,
  diagramType: DiagramGenerationPrompt["type"],
): readonly ExplicitRequestMinimum[] {
  return Array.from(request.matchAll(EXPLICIT_MINIMUM_PATTERN), (match) => {
    const requested = match[1] ? requestedCount(match[1]) : undefined;
    const unit = match[2]?.toLowerCase();
    if (!requested || !unit) return undefined;

    const decisionMinimum = /^decisions?(?:\s+nodes?)?$/.test(unit);
    const applies =
      (diagramType === "flowchart" &&
        (/^(?:steps?|nodes?)$/.test(unit) || decisionMinimum)) ||
      (diagramType === "mindmap" && /^topics?$/.test(unit));
    if (!applies) return undefined;

    const expectedUnit: ExplicitRequestMinimum["expectedUnit"] = decisionMinimum
      ? "decision nodes"
      : diagramType === "flowchart"
        ? "nodes"
        : "topics";
    return {
      expectedCount:
        diagramType === "flowchart" && !decisionMinimum
          ? Math.min(requested, 24)
          : requested,
      expectedUnit,
      requestedCount: requested,
      requestedUnit: unit,
    };
  }).filter(
    (minimum): minimum is ExplicitRequestMinimum => minimum !== undefined,
  );
}

function flowchartHasDirectedCycle(diagram: FlowchartDiagram): boolean {
  const adjacency = new Map<string, string[]>();
  for (const edge of diagram.edges) {
    adjacency.set(edge.source, [
      ...(adjacency.get(edge.source) ?? []),
      edge.target,
    ]);
  }
  const pathExists = (start: string, destination: string): boolean => {
    const pending = [start];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const current = pending.pop();
      if (!current) continue;
      if (current === destination) return true;
      if (visited.has(current)) continue;
      visited.add(current);
      pending.push(...(adjacency.get(current) ?? []));
    }
    return false;
  };
  return diagram.edges.some((edge) => pathExists(edge.target, edge.source));
}

/** Turn a structurally valid result that misses explicit requirements into repair input. */
export function enforceCandidateRequestRequirements(
  candidate: DiagramGenerationCandidate,
  request: DiagramGenerationRequest,
): DiagramGenerationCandidate {
  const diagram = candidate.diagram;
  if (!diagram || diagram.type !== request.prompt.type) {
    return candidate;
  }
  if (diagram.type === "sequence") return candidate;
  const requestDiagnostics = [
    ...explicitRequestMinimums(request.prompt.request, request.prompt.type)
      .map((minimum) => {
        const actual =
          minimum.expectedUnit === "decision nodes"
            ? diagram.nodes.filter((node) => node.kind === "decision").length
            : diagram.nodes.length;
        if (actual >= minimum.expectedCount) return undefined;

        return `request_minimum_not_met: requested at least ${minimum.requestedCount} ${minimum.requestedUnit}, but the generated ${diagram.type} contained ${actual}. Hint: return a complete diagram with at least ${minimum.expectedCount} ${minimum.expectedUnit}.`;
      })
      .filter((diagnostic): diagnostic is string => diagnostic !== undefined),
    ...(diagram.type === "flowchart" &&
    LOOP_REQUIREMENT_PATTERN.test(request.prompt.request) &&
    !flowchartHasDirectedCycle(diagram)
      ? [
          "request_loop_not_met: prompt requires a retry or loop, but the generated flowchart contains no directed cycle. Hint: add a real back-edge from the loop path to the intended process or decision node, never the start node.",
        ]
      : []),
  ];
  if (requestDiagnostics.length === 0) return candidate;

  const { diagram: _diagram, ...withoutDiagram } = candidate;
  return {
    ...withoutDiagram,
    diagnostics: [...candidate.diagnostics, ...requestDiagnostics],
    error: "Generated diagram did not satisfy explicit request requirements.",
  };
}

export function summarizeGenerationCandidate(
  candidate: DiagramGenerationCandidate,
): DiagramGenerationCandidateSummary {
  return {
    diagnostics: candidate.diagnostics,
    diagramValid: Boolean(candidate.diagram) && !candidate.error,
    model: candidate.model,
    provider: candidate.provider,
    text: candidate.text,
    ...(candidate.cacheMode ? { cacheMode: candidate.cacheMode } : {}),
    ...(candidate.durationMs !== undefined
      ? { durationMs: candidate.durationMs }
      : {}),
    ...(candidate.error ? { error: candidate.error } : {}),
    ...(candidate.usage ? { usage: candidate.usage } : {}),
  };
}
