import { Effect, Result, Schema, SchemaIssue } from "effect";

import { DIAGRAM_TYPES } from "./diagram-types.js";

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

export function parseDiagramSchema<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  input: unknown,
): S["Type"] {
  return Schema.decodeUnknownSync(schema, { errors: "all" })(input);
}

export interface DiagramSchemaIssue {
  readonly message: string;
  readonly path: readonly PropertyKey[];
}

export interface DiagramSchemaError {
  readonly issues: readonly DiagramSchemaIssue[];
}

const diagramSchemaFormatter = SchemaIssue.makeFormatterStandardSchemaV1();

function schemaIssuePath(
  path: readonly (PropertyKey | { readonly key: PropertyKey })[] | undefined,
): PropertyKey[] {
  return (path ?? []).map((segment) =>
    typeof segment === "object" ? segment.key : segment,
  );
}

export function safeParseDiagramSchema<
  S extends Schema.ConstraintDecoder<unknown>,
>(
  schema: S,
  input: unknown,
):
  | { readonly data: S["Type"]; readonly success: true }
  | { readonly error: DiagramSchemaError; readonly success: false } {
  const result = Schema.decodeUnknownResult(schema, { errors: "all" })(input);
  if (Result.isSuccess(result)) {
    return { data: result.success, success: true };
  }
  const formatted = diagramSchemaFormatter(result.failure.issue);
  return {
    error: {
      issues: formatted.issues.map((issue) => ({
        message: issue.message,
        path: schemaIssuePath(issue.path),
      })),
    },
    success: false,
  };
}

export function withDiagramParser<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
) {
  return Object.assign(schema, {
    parse: (input: unknown) => parseDiagramSchema(schema, input),
    safeParse: (input: unknown) => safeParseDiagramSchema(schema, input),
  });
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

export class DiagramNode extends Schema.Class<DiagramNode>("DiagramNode")({
  id: NonEmptyString,
  label: NonEmptyString,
  group: Schema.optional(NonEmptyString),
  kind: Schema.optional(NonEmptyString),
  metadata: withDefault(Metadata, {}),
}) {}
export const DiagramNodeSchema = withDiagramParser(DiagramNode);

export class DiagramEdge extends Schema.Class<DiagramEdge>("DiagramEdge")({
  id: NonEmptyString,
  source: NonEmptyString,
  target: NonEmptyString,
  label: Schema.optional(NonEmptyString),
  metadata: withDefault(Metadata, {}),
}) {}
export const DiagramEdgeSchema = withDiagramParser(DiagramEdge);

const HexColor = Schema.String.check(Schema.isPattern(/^#[0-9a-fA-F]{6}$/));

export class DiagramStyle extends Schema.Class<DiagramStyle>("DiagramStyle")({
  accentColor: withDefault(HexColor, SKETCHI_DIAGRAM_STYLE.accentColor),
  backgroundColor: withDefault(HexColor, SKETCHI_DIAGRAM_STYLE.backgroundColor),
}) {}
export const DiagramStyleSchema = withDiagramParser(DiagramStyle);

export class DiagramLayout extends Schema.Class<DiagramLayout>("DiagramLayout")(
  {
    direction: withDefault(LayoutDirectionSchema, "LR"),
    edgeRouting: withDefault(EdgeRoutingSchema, "orthogonal"),
  },
) {}
export const DiagramLayoutSchema = withDiagramParser(DiagramLayout);

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
export const IntermediateDiagramSchema = withDiagramParser(IntermediateDiagram);

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
  const diagram = parseDiagramSchema(IntermediateDiagram, input);
  return validateIntermediateDiagram(diagram);
}
