import { Result, Schema } from "effect";

import {
  type DiagramGenerationType,
  DiagramGenerationTypeSchema,
} from "./messages.js";

export const UnsupportedDiagramIntentKindSchema = Schema.Literals([
  "architecture",
  "er",
  "state-machine",
  "swimlane",
]);
export type UnsupportedDiagramIntentKind =
  typeof UnsupportedDiagramIntentKindSchema.Type;

export const DiagramIntentKindSchema = Schema.Union([
  DiagramGenerationTypeSchema,
  UnsupportedDiagramIntentKindSchema,
]);
export type DiagramIntentKind = typeof DiagramIntentKindSchema.Type;

export const RequirementComparatorSchema = Schema.Literals([
  "exact",
  "minimum",
]);

export class CountRequirement extends Schema.Class<CountRequirement>(
  "CountRequirement",
)({
  comparator: RequirementComparatorSchema,
  kind: Schema.Literal("count"),
  target: Schema.Literals([
    "cycles",
    "decision_nodes",
    "messages",
    "nodes",
    "participants",
    "terminal_nodes",
    "topics",
  ]),
  value: Schema.Int.check(Schema.isGreaterThan(0)),
}) {}

export class DepthRequirement extends Schema.Class<DepthRequirement>(
  "DepthRequirement",
)({
  comparator: RequirementComparatorSchema,
  kind: Schema.Literal("depth"),
  target: Schema.Literal("topic_levels"),
  value: Schema.Int.check(Schema.isGreaterThan(0)),
}) {}

export class LabelRequirement extends Schema.Class<LabelRequirement>(
  "LabelRequirement",
)({
  kind: Schema.Literal("label"),
  target: Schema.Literals([
    "branch",
    "message",
    "node",
    "participant",
    "topic",
  ]),
  value: Schema.NonEmptyString,
}) {}

export const DiagramRequirementSchema = Schema.Union([
  CountRequirement,
  DepthRequirement,
  LabelRequirement,
]);
export type DiagramRequirement = typeof DiagramRequirementSchema.Type;

/** One model-authored intent and acceptance plan for the generated artifact. */
export class GeneratedDiagramIntent extends Schema.Class<GeneratedDiagramIntent>(
  "GeneratedDiagramIntent",
)({
  nativeKind: Schema.NullOr(DiagramGenerationTypeSchema),
  requestedKind: DiagramIntentKindSchema,
  requirements: Schema.Array(DiagramRequirementSchema).pipe(Schema.mutable),
}) {}

/** The sole provider response shape. Diagram parsing happens after this envelope decodes. */
export class GeneratedDiagramResponse extends Schema.Class<GeneratedDiagramResponse>(
  "GeneratedDiagramResponse",
)({
  diagram: Schema.optionalKey(Schema.Unknown),
  intent: GeneratedDiagramIntent,
  title: Schema.optionalKey(Schema.String),
}) {}

export const GeneratedDiagramTitleSchema = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.check(Schema.isMaxLength(60)),
);

const FALLBACK_TITLES: Readonly<Record<DiagramGenerationType, string>> = {
  flowchart: "Generated flowchart",
  mindmap: "Generated mindmap",
  sequence: "Generated sequence diagram",
};

function titleFromId(id: string): string | undefined {
  const value = id.replace(/[-_]+/gu, " ").replace(/\s+/gu, " ").trim();
  if (value.length === 0 || value.length > 60) return undefined;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Keep model titles bounded; invalid titles fall back without copying prompt text. */
export function modelTitleOrFallback(
  title: string | undefined,
  id: string,
  nativeKind: DiagramGenerationType,
): string {
  const candidate = title?.replace(/\s+/gu, " ").trim();
  const decoded = Schema.decodeUnknownResult(GeneratedDiagramTitleSchema)(
    candidate,
  );
  if (Result.isSuccess(decoded)) return decoded.success;
  return titleFromId(id) ?? FALLBACK_TITLES[nativeKind];
}
