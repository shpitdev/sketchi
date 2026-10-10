import { Effect, Schema } from "effect";

import {
  DIAGRAM_ICON_SLUG_MAX_LENGTH,
  DIAGRAM_ICON_SLUG_PATTERN,
} from "./icon.js";
import { DIAGRAM_TYPES } from "./types.js";

const NonEmptyString = Schema.NonEmptyString;
const Metadata = Schema.Record(Schema.String, Schema.Unknown);

/**
 * Server/runtime mirror of the canonical CSS tokens in diagram-ui/theme.css.
 * intermediate.test.ts fails if these values drift from that source of truth.
 */
export const SKETCHI_DIAGRAM_PALETTE = Object.freeze({
  paper: "#f6f1e7",
  card: "#fffdf8",
  ink: "#1a1712",
  accent: "#8f707f",
});

export const SKETCHI_DIAGRAM_STYLE = Object.freeze({
  accentColor: SKETCHI_DIAGRAM_PALETTE.accent,
  backgroundColor: SKETCHI_DIAGRAM_PALETTE.card,
});

function withDefault<S extends Schema.Top>(schema: S, value: S["Encoded"]) {
  return schema.pipe(Schema.withDecodingDefault(Effect.succeed(value)));
}

export const DiagramTypeSchema = Schema.Literals(DIAGRAM_TYPES);
export const LayoutDirectionSchema = Schema.Literals(["TB", "BT", "LR", "RL"]);
export const EdgeRoutingSchema = Schema.Literals([
  "straight",
  "orthogonal",
  "curved",
]);

export type DiagramType = typeof DiagramTypeSchema.Type;
export type LayoutDirection = typeof LayoutDirectionSchema.Type;
export type EdgeRouting = typeof EdgeRoutingSchema.Type;

/**
 * A reference to a Sketchi icon-catalog mark drawn inside a node. Every diagram
 * family shares this shape; resolving the slug against the catalog happens at
 * the build boundary, so this contract checks only the slug format.
 */
export class DiagramIconRef extends Schema.Class<DiagramIconRef>(
  "DiagramIconRef",
)({
  slug: NonEmptyString.check(
    Schema.isPattern(DIAGRAM_ICON_SLUG_PATTERN),
    Schema.isMaxLength(DIAGRAM_ICON_SLUG_MAX_LENGTH),
  ),
}) {}
export const DiagramIconRefSchema = DiagramIconRef;

export class DiagramNode extends Schema.Class<DiagramNode>("DiagramNode")({
  id: NonEmptyString,
  label: NonEmptyString,
  group: Schema.optional(NonEmptyString),
  kind: Schema.optional(NonEmptyString),
  icon: Schema.optional(DiagramIconRef),
  metadata: withDefault(Metadata, {}),
}) {}
export const DiagramNodeSchema = DiagramNode;

export class DiagramEdge extends Schema.Class<DiagramEdge>("DiagramEdge")({
  id: NonEmptyString,
  source: NonEmptyString,
  target: NonEmptyString,
  label: Schema.optional(NonEmptyString),
  metadata: withDefault(Metadata, {}),
}) {}
export const DiagramEdgeSchema = DiagramEdge;

const HexColor = Schema.String.check(Schema.isPattern(/^#[0-9a-fA-F]{6}$/));

export class DiagramStyle extends Schema.Class<DiagramStyle>("DiagramStyle")({
  accentColor: withDefault(HexColor, SKETCHI_DIAGRAM_STYLE.accentColor),
  backgroundColor: withDefault(HexColor, SKETCHI_DIAGRAM_STYLE.backgroundColor),
}) {}
export const DiagramStyleSchema = DiagramStyle;

export class DiagramLayout extends Schema.Class<DiagramLayout>("DiagramLayout")(
  {
    direction: withDefault(LayoutDirectionSchema, "LR"),
    edgeRouting: withDefault(EdgeRoutingSchema, "orthogonal"),
  },
) {}
export const DiagramLayoutSchema = DiagramLayout;

export class IntermediateDiagram extends Schema.Class<IntermediateDiagram>(
  "IntermediateDiagram",
)({
  id: NonEmptyString,
  title: NonEmptyString,
  type: withDefault(DiagramTypeSchema, "flowchart"),
  nodes: Schema.Array(DiagramNode)
    .pipe(Schema.mutable)
    .check(Schema.isMinLength(1)),
  edges: withDefault(Schema.Array(DiagramEdge).pipe(Schema.mutable), []),
  layout: withDefault(DiagramLayout, {
    direction: "LR",
    edgeRouting: "orthogonal",
  }),
  style: withDefault(DiagramStyle, SKETCHI_DIAGRAM_STYLE),
  metadata: withDefault(Metadata, {}),
}) {}
export const IntermediateDiagramSchema = IntermediateDiagram;

export class DiagramValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiagramValidationError";
  }
}

const findDuplicate = (values: readonly string[]) => {
  const seen = new Set<string>();

  for (const value of values) {
    if (seen.has(value)) {
      return value;
    }

    seen.add(value);
  }

  return undefined;
};

export function validateIntermediateDiagram(
  diagram: IntermediateDiagram,
): IntermediateDiagram {
  const duplicateNodeId = findDuplicate(diagram.nodes.map((node) => node.id));

  if (duplicateNodeId) {
    throw new DiagramValidationError(
      `Duplicate node id "${duplicateNodeId}" is not allowed.`,
    );
  }

  const duplicateEdgeId = findDuplicate(diagram.edges.map((edge) => edge.id));

  if (duplicateEdgeId) {
    throw new DiagramValidationError(
      `Duplicate edge id "${duplicateEdgeId}" is not allowed.`,
    );
  }

  const nodeIds = new Set(diagram.nodes.map((node) => node.id));

  for (const edge of diagram.edges) {
    if (!nodeIds.has(edge.source)) {
      throw new DiagramValidationError(
        `Edge "${edge.id}" references missing source node "${edge.source}".`,
      );
    }

    if (!nodeIds.has(edge.target)) {
      throw new DiagramValidationError(
        `Edge "${edge.id}" references missing target node "${edge.target}".`,
      );
    }

    if (edge.source === edge.target) {
      throw new DiagramValidationError(
        `Edge "${edge.id}" cannot connect node "${edge.source}" to itself.`,
      );
    }
  }

  return diagram;
}

export function parseIntermediateDiagram(input: unknown): IntermediateDiagram {
  const diagram = Schema.decodeUnknownSync(IntermediateDiagram, {
    errors: "all",
  })(input);
  return validateIntermediateDiagram(diagram);
}
