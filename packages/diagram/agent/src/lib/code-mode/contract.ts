import {
  Effect,
  Option,
  Result,
  Schema,
  SchemaAST,
  SchemaGetter,
  SchemaIssue,
  SchemaParser,
} from "effect";
import type {
  StandardJSONSchemaV1,
  StandardSchemaV1,
} from "@standard-schema/spec";
import { SKETCHI_DIAGRAM_STYLE } from "@sketchi/diagram-core";

import { cleanToolString } from "../clean-tool-string.js";

export class ContractSchemaIssue extends Schema.Class<ContractSchemaIssue>(
  "ContractSchemaIssue",
)(
  {
    code: stringLiteral("custom"),
    message: Schema.String,
    path: Schema.Array(Schema.PropertyKey),
  },
  { identifier: undefined },
) {}

export class ContractSchemaError extends Schema.TaggedErrorClass<ContractSchemaError>()(
  "ContractSchemaError",
  { issues: Schema.Array(Schema.toEncoded(ContractSchemaIssue)) },
) {}

export type ContractSafeParseResult<A> =
  | { readonly data: A; readonly success: true }
  | { readonly error: ContractSchemaError; readonly success: false };

function actualType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function expectedType(ast: SchemaAST.AST): string {
  if (SchemaAST.isString(ast)) return "string";
  if (SchemaAST.isNumber(ast)) return "number";
  if (SchemaAST.isBoolean(ast)) return "boolean";
  if (SchemaAST.isArrays(ast)) return "array";
  if (SchemaAST.isObjects(ast)) return "object";
  if (SchemaAST.isLiteral(ast)) return JSON.stringify(ast.literal);
  return "value";
}

const contractLeafHook: SchemaIssue.LeafHook = (issue) => {
  if (issue._tag !== "InvalidType") {
    return SchemaIssue.defaultLeafHook(issue);
  }
  const actual = Option.isSome(issue.actual) ? issue.actual.value : undefined;
  return `Invalid input: expected ${expectedType(issue.ast)}, received ${actualType(actual)}`;
};

const contractFormatter = SchemaIssue.makeFormatterStandardSchemaV1({
  leafHook: contractLeafHook,
});

function isPropertyKey(value: unknown): value is PropertyKey {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "symbol"
  );
}

function pathSegment(value: unknown): PropertyKey | undefined {
  if (isPropertyKey(value)) return value;
  if (value !== null && typeof value === "object" && "key" in value) {
    return isPropertyKey(value.key) ? value.key : undefined;
  }
  return undefined;
}

function contractIssues(
  error: Schema.SchemaError,
): ReadonlyArray<typeof ContractSchemaIssue.Encoded> {
  const issues = contractFormatter(error.issue).issues.map(
    (issue): typeof ContractSchemaIssue.Encoded => {
      const path = (issue.path ?? []).flatMap((segment) => {
        const normalized = pathSegment(segment);
        return normalized === undefined ? [] : [normalized];
      });
      return {
        code: "custom",
        message: issue.message,
        path: issue.message.startsWith("Invalid discriminator value.")
          ? [...path, "op"]
          : path,
      };
    },
  );
  if (
    issues.length > 1 &&
    issues.every((issue) => issue.path[0] === "source")
  ) {
    return [{ code: "custom", message: "Invalid input", path: ["source"] }];
  }
  return issues;
}

export function safeParseContract<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  input: unknown,
): ContractSafeParseResult<S["Type"]> {
  const result = Schema.decodeUnknownResult(schema, { errors: "all" })(input);
  return Result.isSuccess(result)
    ? { data: result.success, success: true }
    : {
        error: new ContractSchemaError({
          issues: contractIssues(result.failure),
        }),
        success: false,
      };
}

export function parseContract<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  input: unknown,
): S["Type"] {
  const result = safeParseContract(schema, input);
  if (result.success) return result.data;
  throw result.error;
}

function withParser<S extends Schema.ConstraintDecoder<unknown>>(schema: S) {
  return Object.assign(schema, {
    parse: (input: unknown) => parseContract(schema, input),
    safeParse: (input: unknown) => safeParseContract(schema, input),
  });
}

const codeModeJsonSchemaAnnotationKeys = new Set([
  "const",
  "exclusiveMaximum",
  "exclusiveMinimum",
  "maximum",
  "maxLength",
  "minimum",
  "minItems",
  "minLength",
  "pattern",
]);

export function toCodeModeJsonSchema(
  schema: Schema.Constraint,
): Record<string, unknown> {
  const document = Schema.toJsonSchemaDocument(Schema.toType(schema), {
    includeAnnotationKey: (key) => codeModeJsonSchemaAnnotationKeys.has(key),
  });
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    ...document.schema,
    ...(Object.keys(document.definitions).length === 0
      ? {}
      : { $defs: document.definitions }),
  };
}

function nonEmptyString() {
  const minimumLength = 1;
  return Schema.String.annotate({ minLength: minimumLength }).check(
    Schema.makeFilter((value) => value.length >= minimumLength, {
      message: "Too small: expected string to have >=1 characters",
    }),
  );
}

function nonEmptyArray<S extends Schema.Constraint>(schema: S) {
  const minimumLength = 1;
  return Schema.Array(schema)
    .pipe(Schema.mutable)
    .annotate({ minItems: minimumLength })
    .check(
      Schema.makeFilter((value) => value.length >= minimumLength, {
        message: "Too small: expected array to have >=1 items",
      }),
    );
}

function optionalContract<S extends Schema.Constraint>(schema: S) {
  const present = Schema.declareConstructor<
    S["Type"] | undefined,
    S["Encoded"] | undefined
  >()(
    [schema],
    ([value]) =>
      (input, _ast, options) =>
        input === undefined
          ? Effect.succeed(undefined)
          : SchemaParser.decodeUnknownEffect(value)(input, options),
    {
      toCodecJson: ([value]) =>
        Schema.link<S["Encoded"] | undefined>()(value, {
          decode: SchemaGetter.passthrough({ strict: false }),
          encode: new SchemaGetter.Getter((input) =>
            Effect.succeed(Option.filter(input, (item) => item !== undefined)),
          ),
        }),
    },
  );
  return Schema.optionalKey(present);
}

function requiredString<S extends Schema.Top>(schema: S): S["Rebuild"] {
  return schema.pipe(
    Schema.annotateKey({
      messageMissingKey: "Invalid input: expected string, received undefined",
    }),
  );
}

function requiredObject<S extends Schema.Top>(schema: S): S["Rebuild"] {
  return schema.pipe(
    Schema.annotateKey({
      messageMissingKey: "Invalid input: expected object, received undefined",
    }),
  );
}

function requiredArray<S extends Schema.Top>(schema: S): S["Rebuild"] {
  return schema.pipe(
    Schema.annotateKey({
      messageMissingKey: "Invalid input: expected array, received undefined",
    }),
  );
}

function literals<
  const Values extends readonly [
    SchemaAST.LiteralValue,
    ...SchemaAST.LiteralValue[],
  ],
>(values: Values) {
  return Schema.Literals(values).annotate({
    message: `Invalid option: expected one of ${values
      .map((value) => JSON.stringify(value))
      .join("|")}`,
  });
}

function stringLiteral<const Value extends string>(value: Value) {
  return Schema.Literal(value).pipe(
    Schema.decodeTo(
      Schema.String.annotate({ const: value }).pipe(
        Schema.refine((input): input is Value => input === value, {
          message: `Invalid literal value, expected ${JSON.stringify(value)}`,
        }),
      ),
    ),
  );
}

function numberLiteral<const Value extends number>(value: Value) {
  return Schema.Literal(value).pipe(
    Schema.decodeTo(
      Schema.Number.annotate({ const: value }).pipe(
        Schema.refine((input): input is Value => input === value, {
          message: `Invalid literal value, expected ${JSON.stringify(value)}`,
        }),
      ),
    ),
  );
}

function booleanLiteral<const Value extends boolean>(value: Value) {
  return Schema.Literal(value).pipe(
    Schema.decodeTo(
      Schema.Boolean.annotate({ const: value }).pipe(
        Schema.refine((input): input is Value => input === value, {
          message: `Invalid literal value, expected ${JSON.stringify(value)}`,
        }),
      ),
    ),
  );
}

const NonEmptyString = nonEmptyString();
const RequiredNonEmptyString = requiredString(NonEmptyString);
const FiniteNumber = Schema.Finite;
const positiveThreshold = 0;
const PositiveNumber = Schema.Number.annotate({
  exclusiveMinimum: positiveThreshold,
}).check(
  Schema.isFinite(),
  Schema.makeFilter((value) => value > positiveThreshold, {
    message: "Too small: expected number to be >0",
  }),
);
const hexColorPattern = /^#[0-9a-fA-F]{6}$/;
function hexColor(defaultValue?: string) {
  return Schema.String.annotate({
    pattern: hexColorPattern.source,
    ...(defaultValue === undefined ? {} : { default: defaultValue }),
  }).check(
    Schema.makeFilter((value) => hexColorPattern.test(value), {
      message: `Invalid string: must match pattern /${hexColorPattern.source}/`,
    }),
  );
}
const HexColor = hexColor();

export const HexColorSchema = withParser(HexColor);

export const ARTIFACT_FORMATS: readonly ["excalidraw", "scene", "png"] = [
  "excalidraw",
  "scene",
  "png",
];
export const INLINE_ARTIFACT_FORMATS: readonly ["excalidraw", "scene"] = [
  "excalidraw",
  "scene",
];

export const ArtifactFormatSchema = Object.assign(
  withParser(literals(ARTIFACT_FORMATS)),
  { options: ARTIFACT_FORMATS },
);
export const InlineArtifactFormatSchema = Object.assign(
  withParser(literals(INLINE_ARTIFACT_FORMATS)),
  { options: INLINE_ARTIFACT_FORMATS },
);
export type ArtifactFormat = typeof ArtifactFormatSchema.Type;
export type InlineArtifactFormat = typeof InlineArtifactFormatSchema.Type;

export class ArtifactProvenance extends Schema.Class<ArtifactProvenance>(
  "ArtifactProvenance",
)(
  {
    sourceArtifactId: RequiredNonEmptyString.pipe(Schema.mutableKey),
  },
  { identifier: undefined },
) {}
export const ArtifactProvenanceSchema = withParser(ArtifactProvenance);

export const CODE_MODE_ISSUE_CODES: readonly [
  "missing_field",
  "invalid_type",
  "invalid_enum",
  "invalid_color",
  "duplicate_node_id",
  "duplicate_edge_id",
  "missing_edge_source",
  "missing_edge_target",
  "self_loop",
  "missing_start",
  "multiple_starts",
  "missing_end",
  "start_has_incoming",
  "end_has_outgoing",
  "unreachable_node",
  "nonterminating_node",
  "missing_outgoing_edge",
  "underbranched_decision",
  "unlabeled_decision_branch",
  "duplicate_decision_branch_label",
  "disconnected_graph",
  "flowchart_too_large",
  "mindmap_too_deep",
  "mindmap_too_large",
  "request_too_large",
  "generic_label",
  "label_too_long",
  "quality_below_threshold",
  "render_failed",
  "text_overflow",
  "arrow_binding_invalid",
  "arrow_overlap",
  "export_invalid_scene",
  "storage_read_failed",
  "storage_write_failed",
  "unsupported_artifact_format",
  "patch_source_unavailable",
  "unknown_patch_target",
  "unsupported_patch_operation",
  "patch_preserve_connectivity_failed",
  "patch_output_invalid",
] = [
  "missing_field",
  "invalid_type",
  "invalid_enum",
  "invalid_color",
  "duplicate_node_id",
  "duplicate_edge_id",
  "missing_edge_source",
  "missing_edge_target",
  "self_loop",
  "missing_start",
  "multiple_starts",
  "missing_end",
  "start_has_incoming",
  "end_has_outgoing",
  "unreachable_node",
  "nonterminating_node",
  "missing_outgoing_edge",
  "underbranched_decision",
  "unlabeled_decision_branch",
  "duplicate_decision_branch_label",
  "disconnected_graph",
  "flowchart_too_large",
  "mindmap_too_deep",
  "mindmap_too_large",
  "request_too_large",
  "generic_label",
  "label_too_long",
  "quality_below_threshold",
  "render_failed",
  "text_overflow",
  "arrow_binding_invalid",
  "arrow_overlap",
  "export_invalid_scene",
  "storage_read_failed",
  "storage_write_failed",
  "unsupported_artifact_format",
  "patch_source_unavailable",
  "unknown_patch_target",
  "unsupported_patch_operation",
  "patch_preserve_connectivity_failed",
  "patch_output_invalid",
];

export const CodeModeIssueCodeSchema = Object.assign(
  withParser(literals(CODE_MODE_ISSUE_CODES)),
  { options: CODE_MODE_ISSUE_CODES },
);
export type CodeModeIssueCode = typeof CodeModeIssueCodeSchema.Type;

const CodeModeIssueKindSchema = literals([
  "request",
  "diagram",
  "node",
  "edge",
  "artifact",
]);
const CodeModeIssueStageSchema = literals([
  "input",
  "flowchart",
  "mindmap",
  "quality",
  "render",
  "export",
  "storage",
]);

export class CodeModeIssueRef extends Schema.Class<CodeModeIssueRef>(
  "CodeModeIssueRef",
)(
  {
    kind: CodeModeIssueKindSchema,
    id: optionalContract(NonEmptyString),
    path: optionalContract(NonEmptyString),
  },
  { identifier: undefined },
) {}
export const CodeModeIssueRefSchema = withParser(CodeModeIssueRef);

export class CodeModeIssue extends Schema.Class<CodeModeIssue>("CodeModeIssue")(
  {
    code: CodeModeIssueCodeSchema,
    severity: literals(["error", "warning"]),
    stage: CodeModeIssueStageSchema,
    ref: optionalContract(CodeModeIssueRef),
    message: RequiredNonEmptyString,
    hint: RequiredNonEmptyString,
  },
  { identifier: undefined },
) {}
export const CodeModeIssueSchema = withParser(CodeModeIssue);

export const FLOWCHART_NODE_KINDS: readonly [
  "start",
  "process",
  "decision",
  "end",
] = ["start", "process", "decision", "end"];
export const FlowchartNodeKindSchema = Object.assign(
  withParser(literals(FLOWCHART_NODE_KINDS)),
  { options: FLOWCHART_NODE_KINDS },
);

export const DIAGRAM_PATCH_OPERATION_NAMES: readonly [
  "setDefaultStyle",
  "setStyle",
  "setShape",
  "translate",
  "replaceText",
  "rerouteEdges",
] = [
  "setDefaultStyle",
  "setStyle",
  "setShape",
  "translate",
  "replaceText",
  "rerouteEdges",
];
export const DiagramPatchOperationNameSchema = Object.assign(
  withParser(literals(DIAGRAM_PATCH_OPERATION_NAMES)),
  { options: DIAGRAM_PATCH_OPERATION_NAMES },
);

export class FlowchartSpecNode extends Schema.Class<FlowchartSpecNode>(
  "FlowchartSpecNode",
)(
  {
    id: RequiredNonEmptyString,
    label: RequiredNonEmptyString,
    kind: FlowchartNodeKindSchema,
    description: optionalContract(NonEmptyString),
  },
  { identifier: undefined },
) {}

export class FlowchartSpecEdge extends Schema.Class<FlowchartSpecEdge>(
  "FlowchartSpecEdge",
)(
  {
    id: optionalContract(NonEmptyString),
    source: RequiredNonEmptyString,
    target: RequiredNonEmptyString,
    label: optionalContract(NonEmptyString),
  },
  { identifier: undefined },
) {}

const FlowchartDirection = literals(["TB", "LR"]);
const flowchartDirectionDefault = "TB";
const FlowchartDirectionWithDefault = FlowchartDirection.annotate({
  default: flowchartDirectionDefault,
}).pipe(Schema.withDecodingDefault(Effect.succeed(flowchartDirectionDefault)));

export class FlowchartSpecLayout extends Schema.Class<FlowchartSpecLayout>(
  "FlowchartSpecLayout",
)(
  {
    direction: FlowchartDirectionWithDefault,
  },
  { identifier: undefined },
) {}

const defaultAccentColor = SKETCHI_DIAGRAM_STYLE.accentColor;
const DefaultAccentColor = hexColor(defaultAccentColor).pipe(
  Schema.withDecodingDefault(Effect.succeed(defaultAccentColor)),
);
const defaultBackgroundColor = SKETCHI_DIAGRAM_STYLE.backgroundColor;
const DefaultBackgroundColor = hexColor(defaultBackgroundColor).pipe(
  Schema.withDecodingDefault(Effect.succeed(defaultBackgroundColor)),
);

export class FlowchartSpecStyle extends Schema.Class<FlowchartSpecStyle>(
  "FlowchartSpecStyle",
)(
  {
    accentColor: DefaultAccentColor,
    backgroundColor: DefaultBackgroundColor,
  },
  { identifier: undefined },
) {}

const flowchartEdgesDefault: FlowchartSpecEdge[] = [];
const FlowchartEdgesWithDefault = Schema.Array(FlowchartSpecEdge)
  .pipe(Schema.mutable)
  .annotate({ default: flowchartEdgesDefault })
  .pipe(Schema.withDecodingDefault(Effect.succeed(flowchartEdgesDefault)));
const flowchartLayoutDefault: { readonly direction: "TB" } = {
  direction: "TB",
};
const FlowchartLayoutWithDefault = FlowchartSpecLayout.annotate({
  default: flowchartLayoutDefault,
}).pipe(Schema.withDecodingDefault(Effect.succeed(flowchartLayoutDefault)));
const flowchartStyleDefault = {
  accentColor: SKETCHI_DIAGRAM_STYLE.accentColor,
  backgroundColor: SKETCHI_DIAGRAM_STYLE.backgroundColor,
};
const FlowchartStyleWithDefault = FlowchartSpecStyle.annotate({
  default: flowchartStyleDefault,
}).pipe(Schema.withDecodingDefault(Effect.succeed(flowchartStyleDefault)));
export class FlowchartSpec extends Schema.Class<FlowchartSpec>("FlowchartSpec")(
  {
    id: optionalContract(NonEmptyString),
    title: RequiredNonEmptyString,
    nodes: requiredArray(nonEmptyArray(FlowchartSpecNode)),
    edges: FlowchartEdgesWithDefault,
    layout: FlowchartLayoutWithDefault,
    style: FlowchartStyleWithDefault,
  },
  { identifier: undefined },
) {}
export const FlowchartSpecSchema = withParser(FlowchartSpec);
export const FlowchartSpecNodeSchema = withParser(FlowchartSpecNode);
export const FlowchartSpecEdgeSchema = withParser(FlowchartSpecEdge);
export const FlowchartSpecLayoutSchema = withParser(FlowchartSpecLayout);
export const FlowchartSpecStyleSchema = withParser(FlowchartSpecStyle);

export class SequenceParticipantSpec extends Schema.Class<SequenceParticipantSpec>(
  "SequenceParticipantSpec",
)(
  {
    id: RequiredNonEmptyString,
    label: RequiredNonEmptyString,
    kind: optionalContract(NonEmptyString),
  },
  { identifier: undefined },
) {}

export class SequenceMessageSpec extends Schema.Class<SequenceMessageSpec>(
  "SequenceMessageSpec",
)(
  {
    id: optionalContract(NonEmptyString),
    source: RequiredNonEmptyString,
    target: RequiredNonEmptyString,
    label: RequiredNonEmptyString,
    type: optionalContract(literals(["message", "return"])),
    style: optionalContract(literals(["solid", "dashed"])),
  },
  { identifier: undefined },
) {}

const sequenceMessagesDefault: SequenceMessageSpec[] = [];
const SequenceMessagesWithDefault = Schema.Array(SequenceMessageSpec)
  .pipe(Schema.mutable)
  .annotate({ default: sequenceMessagesDefault })
  .pipe(Schema.withDecodingDefault(Effect.succeed(sequenceMessagesDefault)));
const sequenceStyleDefault = {
  accentColor: SKETCHI_DIAGRAM_STYLE.accentColor,
  backgroundColor: SKETCHI_DIAGRAM_STYLE.backgroundColor,
};
const SequenceStyleWithDefault = Schema.Struct({
  accentColor: hexColor(defaultAccentColor).pipe(
    Schema.withDecodingDefault(Effect.succeed(defaultAccentColor)),
  ),
  backgroundColor: hexColor(defaultBackgroundColor).pipe(
    Schema.withDecodingDefault(Effect.succeed(defaultBackgroundColor)),
  ),
})
  .annotate({ default: sequenceStyleDefault })
  .pipe(Schema.withDecodingDefault(Effect.succeed(sequenceStyleDefault)));

export class SequenceDiagramSpec extends Schema.Class<SequenceDiagramSpec>(
  "SequenceDiagramSpec",
)(
  {
    id: optionalContract(NonEmptyString),
    title: RequiredNonEmptyString,
    participants: requiredArray(nonEmptyArray(SequenceParticipantSpec)),
    messages: SequenceMessagesWithDefault,
    style: SequenceStyleWithDefault,
  },
  { identifier: undefined },
) {}
export const SequenceDiagramSpecSchema = withParser(SequenceDiagramSpec);
export const SequenceParticipantSpecSchema = withParser(
  SequenceParticipantSpec,
);
export const SequenceMessageSpecSchema = withParser(SequenceMessageSpec);

const ArtifactFormatsOption = optionalContract(
  nonEmptyArray(ArtifactFormatSchema),
);
const InlineArtifactsOption = optionalContract(
  Schema.Array(InlineArtifactFormatSchema).pipe(Schema.mutable),
);
const minimumQualityScore = 0;
const maximumQualityScore = 10;
const QualityScoreOption = optionalContract(
  Schema.Number.annotate({
    minimum: minimumQualityScore,
    maximum: maximumQualityScore,
  }).check(
    Schema.isFinite(),
    Schema.makeFilter((value) => value >= minimumQualityScore, {
      message: `Too small: expected number to be >=${minimumQualityScore}`,
    }),
    Schema.makeFilter((value) => value <= maximumQualityScore, {
      message: `Too big: expected number to be <=${maximumQualityScore}`,
    }),
  ),
);

export class BuildFlowchartOptions extends Schema.Class<BuildFlowchartOptions>(
  "BuildFlowchartOptions",
)(
  {
    artifactFormats: ArtifactFormatsOption,
    inlineArtifacts: InlineArtifactsOption,
    minQualityScore: QualityScoreOption,
  },
  { identifier: undefined },
) {}
export const BuildFlowchartOptionsSchema = withParser(
  optionalContract(BuildFlowchartOptions),
);

export class BuildFlowchartRequest extends Schema.Class<BuildFlowchartRequest>(
  "BuildFlowchartRequest",
)(
  {
    requestId: optionalContract(NonEmptyString),
    spec: requiredObject(FlowchartSpec),
    options: optionalContract(BuildFlowchartOptions),
  },
  { identifier: undefined },
) {}

const FlowchartToolSpecContract = FlowchartSpec.mapFields(
  ({ id, title, nodes, edges, layout }) => ({
    id,
    title,
    nodes,
    edges,
    layout,
  }),
);
const BuildFlowchartToolInputContract = Schema.Struct({
  requestId: optionalContract(NonEmptyString),
  spec: requiredObject(FlowchartToolSpecContract),
});
type ModelBuildFlowchartToolInput = typeof BuildFlowchartToolInputContract.Type;
/**
 * The model contract intentionally excludes style. This public input type stays
 * wide enough for existing direct callback callers; the runtime accepts their
 * legacy field and normalizes it to the Sketchi palette.
 */
export type BuildFlowchartToolInput = ModelBuildFlowchartToolInput & {
  readonly spec: ModelBuildFlowchartToolInput["spec"] & {
    readonly style?: typeof FlowchartSpecStyle.Type;
  };
};
type BuildFlowchartToolInputContractWithLegacyType = Omit<
  typeof BuildFlowchartToolInputContract,
  "Type"
> & {
  readonly Type: BuildFlowchartToolInput;
};
const BuildFlowchartToolInputStandardSchema = Schema.toStandardSchemaV1(
  BuildFlowchartToolInputContract,
  { leafHook: contractLeafHook, parseOptions: { errors: "all" } },
);
Object.assign(BuildFlowchartToolInputStandardSchema["~standard"], {
  jsonSchema: {
    input: () =>
      toCodeModeJsonSchema(BuildFlowchartToolInputContract) as Record<
        string,
        unknown
      >,
    output: () =>
      toCodeModeJsonSchema(BuildFlowchartToolInputContract) as Record<
        string,
        unknown
      >,
  },
});
export const BuildFlowchartToolInputSchema: StandardSchemaV1<
  typeof BuildFlowchartToolInputContract.Encoded,
  BuildFlowchartToolInput
> &
  StandardJSONSchemaV1<
    typeof BuildFlowchartToolInputContract.Encoded,
    BuildFlowchartToolInput
  > &
  BuildFlowchartToolInputContractWithLegacyType =
  BuildFlowchartToolInputStandardSchema as unknown as BuildFlowchartToolInputContractWithLegacyType &
    StandardSchemaV1<
      typeof BuildFlowchartToolInputContract.Encoded,
      BuildFlowchartToolInput
    > &
    StandardJSONSchemaV1<
      typeof BuildFlowchartToolInputContract.Encoded,
      BuildFlowchartToolInput
    >;
export const BuildFlowchartRequestSchema = Object.assign(
  withParser(BuildFlowchartRequest),
  {
    omit: (_keys: { readonly options: true }) => BuildFlowchartToolInputSchema,
  },
);

export class BuildSequenceDiagramRequest extends Schema.Class<BuildSequenceDiagramRequest>(
  "BuildSequenceDiagramRequest",
)(
  {
    requestId: optionalContract(NonEmptyString),
    spec: requiredObject(SequenceDiagramSpec),
    options: optionalContract(BuildFlowchartOptions),
  },
  { identifier: undefined },
) {}
export const BuildSequenceDiagramRequestSchema = withParser(
  BuildSequenceDiagramRequest,
);

export interface MindmapTopicInput {
  label: string;
  children?: MindmapTopicInput[] | undefined;
}

function hasSemanticText(value: string): boolean {
  const cleaned = cleanToolString(value);
  return cleaned.length > 0 && !/^(?:""|''|``)$/.test(cleaned);
}

const semanticTextMinimumLength = 1;
const MindmapSemanticString = Schema.String.annotate({
  minLength: semanticTextMinimumLength,
}).check(
  Schema.makeFilter((value) => value.length >= semanticTextMinimumLength, {
    message: `Too small: expected string to have >=${semanticTextMinimumLength} characters`,
  }),
  Schema.makeFilter(hasSemanticText, {
    message: "Must contain semantic text after normalization.",
  }),
);

const MindmapTopicReference: Schema.Codec<
  MindmapTopicInput,
  MindmapTopicInput
> = requiredObject(
  Schema.suspend(() => MindmapTopic).annotate({ identifier: "__schema0" }),
);

export const MindmapTopic: Schema.Codec<MindmapTopicInput, MindmapTopicInput> =
  Schema.Struct({
    label: requiredString(MindmapSemanticString),
    children: Schema.optionalKey(
      Schema.Array(MindmapTopicReference).pipe(Schema.mutable),
    ),
  });
export const MindmapTopicSchema = withParser(MindmapTopicReference);

export class MindmapSpecLayout extends Schema.Class<MindmapSpecLayout>(
  "MindmapSpecLayout",
)(
  {
    direction: literals(["LR", "RL"])
      .annotate({ default: "LR" })
      .pipe(Schema.withDecodingDefault(Effect.succeed("LR"))),
  },
  { identifier: undefined },
) {}

const mindmapLayoutDefault: { readonly direction: "LR" } = {
  direction: "LR",
};
const MindmapLayoutWithDefault = MindmapSpecLayout.annotate({
  default: mindmapLayoutDefault,
}).pipe(Schema.withDecodingDefault(Effect.succeed(mindmapLayoutDefault)));
const mindmapStyleDefault = {
  accentColor: SKETCHI_DIAGRAM_STYLE.accentColor,
  backgroundColor: SKETCHI_DIAGRAM_STYLE.backgroundColor,
};
const MindmapStyleWithDefault = Schema.Struct({
  accentColor: hexColor(defaultAccentColor).pipe(
    Schema.withDecodingDefault(
      Effect.succeed(mindmapStyleDefault.accentColor),
    ),
  ),
  backgroundColor: hexColor(mindmapStyleDefault.backgroundColor).pipe(
    Schema.withDecodingDefault(
      Effect.succeed(mindmapStyleDefault.backgroundColor),
    ),
  ),
})
  .annotate({ default: mindmapStyleDefault })
  .pipe(Schema.withDecodingDefault(Effect.succeed(mindmapStyleDefault)));

const MindmapSpecContract = Schema.Struct({
  id: optionalContract(NonEmptyString),
  title: requiredString(MindmapSemanticString),
  root: MindmapTopicReference,
  layout: MindmapLayoutWithDefault,
  style: MindmapStyleWithDefault,
});
export class MindmapSpec extends Schema.Class<MindmapSpec>("MindmapSpec")(
  MindmapSpecContract,
  { identifier: undefined },
) {}
export const MindmapSpecSchema = withParser(MindmapSpec);

const BuildMindmapRequestContract = Schema.Struct({
  requestId: optionalContract(NonEmptyString),
  spec: requiredObject(MindmapSpecContract),
  options: optionalContract(BuildFlowchartOptions),
});
export class BuildMindmapRequest extends Schema.Class<BuildMindmapRequest>(
  "BuildMindmapRequest",
)(BuildMindmapRequestContract, { identifier: undefined }) {}
export const BuildMindmapRequestSchema = withParser(
  BuildMindmapRequestContract,
);

export class ScenePoint extends Schema.Class<ScenePoint>("ScenePoint")(
  {
    x: FiniteNumber.pipe(Schema.mutableKey),
    y: FiniteNumber.pipe(Schema.mutableKey),
  },
  { identifier: undefined },
) {}
export const ScenePointSchema = withParser(ScenePoint);

export class NodeSceneElement extends Schema.Class<NodeSceneElement>(
  "NodeSceneElement",
)(
  {
    type: stringLiteral("node"),
    id: RequiredNonEmptyString,
    nodeId: RequiredNonEmptyString,
    kind: optionalContract(NonEmptyString),
    rendererRole: optionalContract(literals(["sequence-lifeline"])),
    shape: literals(["rectangle", "ellipse", "diamond", "circle"]).pipe(
      Schema.mutableKey,
    ),
    fillColor: optionalContract(HexColor).pipe(Schema.mutableKey),
    strokeColor: optionalContract(HexColor).pipe(Schema.mutableKey),
    textColor: optionalContract(HexColor).pipe(Schema.mutableKey),
    x: FiniteNumber.pipe(Schema.mutableKey),
    y: FiniteNumber.pipe(Schema.mutableKey),
    width: PositiveNumber.pipe(Schema.mutableKey),
    height: PositiveNumber.pipe(Schema.mutableKey),
    label: RequiredNonEmptyString.pipe(Schema.mutableKey),
  },
  { identifier: undefined },
) {}

export class TextSceneElement extends Schema.Class<TextSceneElement>(
  "TextSceneElement",
)(
  {
    type: stringLiteral("text"),
    id: RequiredNonEmptyString,
    containerId: optionalContract(NonEmptyString),
    textColor: optionalContract(HexColor).pipe(Schema.mutableKey),
    x: FiniteNumber.pipe(Schema.mutableKey),
    y: FiniteNumber.pipe(Schema.mutableKey),
    text: RequiredNonEmptyString.pipe(Schema.mutableKey),
    fontSize: PositiveNumber,
    maxWidth: optionalContract(PositiveNumber),
  },
  { identifier: undefined },
) {}

export class ArrowSceneElement extends Schema.Class<ArrowSceneElement>(
  "ArrowSceneElement",
)(
  {
    type: stringLiteral("arrow"),
    id: RequiredNonEmptyString,
    edgeId: RequiredNonEmptyString,
    sourceNodeId: RequiredNonEmptyString,
    targetNodeId: RequiredNonEmptyString.pipe(Schema.mutableKey),
    strokeColor: optionalContract(HexColor).pipe(Schema.mutableKey),
    strokeStyle: optionalContract(
      literals(["dashed", "dotted", "solid"]),
    ).pipe(Schema.mutableKey),
    textColor: optionalContract(HexColor).pipe(Schema.mutableKey),
    points: requiredArray(Schema.Array(ScenePoint).pipe(Schema.mutable))
      .annotate({ minItems: 2 })
      .check(
        Schema.makeFilter((value) => value.length >= 2, {
          message: "Too small: expected array to have >=2 items",
        }),
      )
      .pipe(Schema.mutableKey),
    label: optionalContract(NonEmptyString).pipe(Schema.mutableKey),
  },
  { identifier: undefined },
) {}

export const NodeSceneElementSchema = withParser(NodeSceneElement);
export const TextSceneElementSchema = withParser(TextSceneElement);
export const ArrowSceneElementSchema = withParser(ArrowSceneElement);
export const SceneElementSchema = Schema.Union(
  [NodeSceneElement, TextSceneElement, ArrowSceneElement],
  { mode: "oneOf" },
);

export class RenderedDiagramScene extends Schema.Class<RenderedDiagramScene>(
  "RenderedDiagramScene",
)(
  {
    diagramId: RequiredNonEmptyString,
    title: RequiredNonEmptyString,
    width: PositiveNumber.pipe(Schema.mutableKey),
    height: PositiveNumber.pipe(Schema.mutableKey),
    accentColor: HexColor.pipe(Schema.mutableKey),
    backgroundColor: HexColor.pipe(Schema.mutableKey),
    elements: requiredArray(
      Schema.Array(SceneElementSchema).pipe(Schema.mutable),
    ),
  },
  { identifier: undefined },
) {}
export const RenderedDiagramSceneSchema = withParser(RenderedDiagramScene);
export type PatchableScene = RenderedDiagramScene;

const ExcalidrawElement = Schema.Record(Schema.String, Schema.Unknown).check(
  Schema.makeFilter(
    (value) =>
      typeof value["id"] === "string" &&
      value["id"].length > 0 &&
      typeof value["type"] === "string" &&
      value["type"].length > 0,
    { message: "Invalid input" },
  ),
);
export const ExcalidrawElementSchema = withParser(ExcalidrawElement);

export class ExcalidrawScene extends Schema.Class<ExcalidrawScene>(
  "ExcalidrawScene",
)(
  {
    appState: Schema.Record(Schema.String, Schema.Unknown),
    elements: Schema.Array(ExcalidrawElement).pipe(Schema.mutable),
  },
  { identifier: undefined },
) {}
export const ExcalidrawSceneSchema = withParser(ExcalidrawScene);

export class ExcalidrawFile extends ExcalidrawScene.extend<ExcalidrawFile>(
  "ExcalidrawFile",
)(
  {
    files: Schema.Record(Schema.String, Schema.Unknown),
    source: RequiredNonEmptyString,
    type: stringLiteral("excalidraw"),
    version: numberLiteral(2),
  },
  { identifier: undefined },
) {}
export const ExcalidrawFileSchema = withParser(ExcalidrawFile);

export class GetArtifactRequest extends Schema.Class<GetArtifactRequest>(
  "GetArtifactRequest",
)(
  {
    artifactId: RequiredNonEmptyString,
    format: optionalContract(ArtifactFormatSchema),
    inline: optionalContract(Schema.Boolean),
  },
  { identifier: undefined },
) {}
export const GetArtifactRequestSchema = withParser(GetArtifactRequest);

export class DiagramSelector extends Schema.Class<DiagramSelector>(
  "DiagramSelector",
)(
  {
    ids: optionalContract(Schema.Array(NonEmptyString).pipe(Schema.mutable)),
    nodeIds: optionalContract(
      Schema.Array(NonEmptyString).pipe(Schema.mutable),
    ),
    edgeIds: optionalContract(
      Schema.Array(NonEmptyString).pipe(Schema.mutable),
    ),
    kinds: optionalContract(
      Schema.Array(FlowchartNodeKindSchema).pipe(Schema.mutable),
    ),
    labels: optionalContract(Schema.Array(NonEmptyString).pipe(Schema.mutable)),
    scope: optionalContract(literals(["all", "nodes", "edges"])),
  },
  { identifier: undefined },
) {}
export const DiagramSelectorSchema = withParser(DiagramSelector);

export class DiagramStylePatch extends Schema.Class<DiagramStylePatch>(
  "DiagramStylePatch",
)(
  {
    strokeColor: optionalContract(HexColor),
    fillColor: optionalContract(HexColor),
    textColor: optionalContract(HexColor),
    backgroundColor: optionalContract(HexColor),
  },
  { identifier: undefined },
) {}
export const DiagramStylePatchSchema = withParser(DiagramStylePatch);

export const DIAGRAM_SHAPES: readonly [
  "rectangle",
  "diamond",
  "ellipse",
  "circle",
] = ["rectangle", "diamond", "ellipse", "circle"];
export const DiagramShapeSchema = Object.assign(
  withParser(literals(DIAGRAM_SHAPES)),
  { options: DIAGRAM_SHAPES },
);
export type DiagramShape = typeof DiagramShapeSchema.Type;

export class SetDefaultStyleOperation extends Schema.Class<SetDefaultStyleOperation>(
  "SetDefaultStyleOperation",
)(
  {
    op: stringLiteral("setDefaultStyle"),
    style: requiredObject(DiagramStylePatch),
  },
  { identifier: undefined },
) {}
export class SetStyleOperation extends Schema.Class<SetStyleOperation>(
  "SetStyleOperation",
)(
  {
    op: stringLiteral("setStyle"),
    selector: requiredObject(DiagramSelector),
    style: requiredObject(DiagramStylePatch),
  },
  { identifier: undefined },
) {}
export class SetShapeOperation extends Schema.Class<SetShapeOperation>(
  "SetShapeOperation",
)(
  {
    op: stringLiteral("setShape"),
    selector: requiredObject(DiagramSelector),
    shape: DiagramShapeSchema,
  },
  { identifier: undefined },
) {}
export class TranslateOperation extends Schema.Class<TranslateOperation>(
  "TranslateOperation",
)(
  {
    op: stringLiteral("translate"),
    selector: requiredObject(DiagramSelector),
    dx: FiniteNumber,
    dy: FiniteNumber,
  },
  { identifier: undefined },
) {}
export class ReplaceTextOperation extends Schema.Class<ReplaceTextOperation>(
  "ReplaceTextOperation",
)(
  {
    op: stringLiteral("replaceText"),
    selector: requiredObject(DiagramSelector),
    text: RequiredNonEmptyString,
  },
  { identifier: undefined },
) {}
export class RerouteEdgesOperation extends Schema.Class<RerouteEdgesOperation>(
  "RerouteEdgesOperation",
)(
  {
    op: stringLiteral("rerouteEdges"),
    selector: optionalContract(DiagramSelector),
  },
  { identifier: undefined },
) {}

export const DiagramPatchOperationSchema = Schema.Union(
  [
    SetDefaultStyleOperation,
    SetStyleOperation,
    SetShapeOperation,
    TranslateOperation,
    ReplaceTextOperation,
    RerouteEdgesOperation,
  ],
  { mode: "oneOf" },
).annotate({
  message: `Invalid discriminator value. Expected ${DIAGRAM_PATCH_OPERATION_NAMES.map(
    (name) => `'${name}'`,
  ).join(" | ")}`,
});
export type DiagramPatchOperation = typeof DiagramPatchOperationSchema.Type;

export class ArtifactPatchSource extends Schema.Class<ArtifactPatchSource>(
  "ArtifactPatchSource",
)(
  {
    artifactId: RequiredNonEmptyString,
    format: optionalContract(stringLiteral("scene")),
  },
  { identifier: undefined },
) {}

export class InlineScenePatchSource extends Schema.Class<InlineScenePatchSource>(
  "InlineScenePatchSource",
)(
  {
    scene: requiredObject(RenderedDiagramScene),
  },
  { identifier: undefined },
) {}
export const DiagramPatchSourceSchema = Schema.Union([
  ArtifactPatchSource,
  InlineScenePatchSource,
]).annotate({ message: "Invalid input" });
export type DiagramPatchSource = typeof DiagramPatchSourceSchema.Type;

export class ApplyDiagramPatchOptions extends Schema.Class<ApplyDiagramPatchOptions>(
  "ApplyDiagramPatchOptions",
)(
  {
    artifactFormats: ArtifactFormatsOption,
    inlineArtifacts: InlineArtifactsOption,
    preserveConnectivity: optionalContract(Schema.Boolean),
  },
  { identifier: undefined },
) {}
export const ApplyDiagramPatchOptionsSchema = withParser(
  optionalContract(ApplyDiagramPatchOptions),
);

export class ApplyDiagramPatchRequest extends Schema.Class<ApplyDiagramPatchRequest>(
  "ApplyDiagramPatchRequest",
)(
  {
    requestId: optionalContract(NonEmptyString),
    source: DiagramPatchSourceSchema.annotateKey({
      messageMissingKey: "Invalid input",
    }),
    operations: requiredArray(nonEmptyArray(DiagramPatchOperationSchema)).pipe(
      Schema.annotateEncoded({ minItems: 1 }),
    ),
    options: optionalContract(ApplyDiagramPatchOptions),
    intent: optionalContract(NonEmptyString),
  },
  { identifier: undefined },
) {}
export const ApplyDiagramPatchRequestSchema = withParser(
  ApplyDiagramPatchRequest,
);

export interface NormalizedFlowchartSpec {
  readonly id: string;
  readonly title: string;
  readonly nodes: FlowchartSpecNode[];
  readonly edges: Array<FlowchartSpecEdge & { readonly id: string }>;
  readonly layout: Required<FlowchartSpecLayout>;
  readonly style: Required<FlowchartSpecStyle>;
}

export interface NormalizedMindmapTopic {
  readonly id: string;
  readonly label: string;
  readonly children: NormalizedMindmapTopic[];
}

export interface NormalizedMindmapSpec {
  readonly id: string;
  readonly title: string;
  readonly root: NormalizedMindmapTopic;
  readonly layout: { readonly direction: "LR" | "RL" };
  readonly style: Required<FlowchartSpecStyle>;
}

export interface NormalizedSequenceDiagramSpec {
  readonly id: string;
  readonly title: string;
  readonly participants: SequenceParticipantSpec[];
  readonly messages: Array<SequenceMessageSpec & { readonly id: string }>;
  readonly style: Required<FlowchartSpecStyle>;
}

export interface QualityCheck {
  readonly code: string;
  readonly passed: boolean;
  readonly severity: "error" | "warning";
  readonly message: string;
  readonly refs: CodeModeIssueRef[];
}

export interface QualityReport {
  readonly accepted: boolean;
  readonly score: number;
  readonly threshold: number;
  readonly summary: { readonly nodeCount: number; readonly edgeCount: number };
  readonly checks: QualityCheck[];
}

export interface ArtifactFormatRef {
  readonly format: ArtifactFormat;
  readonly mimeType: string;
  readonly url?: string;
  readonly expiresAt?: string;
  readonly inline?: unknown;
  readonly sizeBytes?: number;
}

export interface ArtifactBundle {
  readonly artifactId: string;
  readonly diagramId: string;
  readonly formats: ArtifactFormatRef[];
  readonly provenance?: ArtifactProvenance;
  readonly preview?: ArtifactFormatRef;
}

export interface PartialArtifactBundle {
  readonly artifactId?: string;
  readonly diagramId?: string;
  readonly formats?: ArtifactFormatRef[];
}

const NormalizedFlowchartSpecSchema = Schema.Struct({
  id: NonEmptyString,
  title: NonEmptyString,
  nodes: Schema.Array(FlowchartSpecNode).pipe(Schema.mutable),
  edges: Schema.Array(
    FlowchartSpecEdge.mapFields((fields) => ({
      ...fields,
      id: NonEmptyString,
    })),
  ).pipe(Schema.mutable),
  layout: Schema.Struct({ direction: FlowchartDirection }),
  style: Schema.Struct({ accentColor: HexColor, backgroundColor: HexColor }),
});
const NormalizedMindmapTopicSchema: Schema.Codec<NormalizedMindmapTopic> =
  Schema.Struct({
    id: NonEmptyString,
    label: NonEmptyString,
    children: Schema.Array(
      Schema.suspend(
        (): Schema.Codec<NormalizedMindmapTopic> =>
          NormalizedMindmapTopicSchema,
      ),
    ).pipe(Schema.mutable),
  });
const NormalizedMindmapSpecSchema = Schema.Struct({
  id: NonEmptyString,
  title: NonEmptyString,
  root: NormalizedMindmapTopicSchema,
  layout: Schema.Struct({ direction: literals(["LR", "RL"]) }),
  style: Schema.Struct({ accentColor: HexColor, backgroundColor: HexColor }),
});
const NormalizedSequenceDiagramSpecSchema = Schema.Struct({
  id: NonEmptyString,
  title: NonEmptyString,
  participants: Schema.Array(SequenceParticipantSpec).pipe(Schema.mutable),
  messages: Schema.Array(
    SequenceMessageSpec.mapFields((fields) => ({
      ...fields,
      id: NonEmptyString,
    })),
  ).pipe(Schema.mutable),
  style: Schema.Struct({ accentColor: HexColor, backgroundColor: HexColor }),
});
const QualityCheckSchema = Schema.Struct({
  code: Schema.String,
  passed: Schema.Boolean,
  severity: literals(["error", "warning"]),
  message: Schema.String,
  refs: Schema.Array(CodeModeIssueRef).pipe(Schema.mutable),
});
const QualityReportSchema = Schema.Struct({
  accepted: Schema.Boolean,
  score: Schema.Number,
  threshold: Schema.Number,
  summary: Schema.Struct({
    nodeCount: Schema.Number,
    edgeCount: Schema.Number,
  }),
  checks: Schema.Array(QualityCheckSchema).pipe(Schema.mutable),
});
const ArtifactFormatRefSchema = Schema.Struct({
  format: ArtifactFormatSchema,
  mimeType: Schema.String,
  url: optionalContract(Schema.String),
  expiresAt: optionalContract(Schema.String),
  inline: optionalContract(Schema.Unknown),
  sizeBytes: optionalContract(Schema.Number),
});
const ArtifactBundleSchema = Schema.Struct({
  artifactId: Schema.String,
  diagramId: Schema.String,
  formats: Schema.Array(ArtifactFormatRefSchema).pipe(Schema.mutable),
  provenance: optionalContract(ArtifactProvenance),
  preview: optionalContract(ArtifactFormatRefSchema),
});
const PartialArtifactBundleSchema = Schema.Struct({
  artifactId: optionalContract(Schema.String),
  diagramId: optionalContract(Schema.String),
  formats: optionalContract(
    Schema.Array(ArtifactFormatRefSchema).pipe(Schema.mutable),
  ),
});

export class BuildFlowchartAccepted extends Schema.Class<BuildFlowchartAccepted>(
  "BuildFlowchartAccepted",
)(
  {
    ok: booleanLiteral(true),
    status: stringLiteral("accepted"),
    buildId: Schema.String,
    requestId: optionalContract(Schema.String),
    normalizedSpec: NormalizedFlowchartSpecSchema,
    quality: QualityReportSchema,
    artifact: ArtifactBundleSchema,
    issues: Schema.Array(CodeModeIssue).pipe(Schema.mutable),
  },
  { identifier: undefined },
) {}
export class BuildFlowchartRejected extends Schema.Class<BuildFlowchartRejected>(
  "BuildFlowchartRejected",
)(
  {
    ok: booleanLiteral(false),
    status: literals([
      "invalid_input",
      "invalid_flowchart",
      "quality_failed",
      "render_failed",
      "export_failed",
      "storage_failed",
    ]),
    buildId: optionalContract(Schema.String),
    requestId: optionalContract(Schema.String),
    normalizedSpec: optionalContract(NormalizedFlowchartSpecSchema),
    quality: optionalContract(QualityReportSchema),
    partial: optionalContract(PartialArtifactBundleSchema),
    issues: Schema.Array(CodeModeIssue).pipe(Schema.mutable),
  },
  { identifier: undefined },
) {}
export const BuildFlowchartResultSchema = Schema.Union([
  BuildFlowchartAccepted,
  BuildFlowchartRejected,
]);
export type BuildFlowchartResult = typeof BuildFlowchartResultSchema.Type;

export class BuildMindmapAccepted extends Schema.Class<BuildMindmapAccepted>(
  "BuildMindmapAccepted",
)(
  {
    ok: booleanLiteral(true),
    status: stringLiteral("accepted"),
    buildId: Schema.String,
    requestId: optionalContract(Schema.String),
    normalizedSpec: NormalizedMindmapSpecSchema,
    quality: QualityReportSchema,
    artifact: ArtifactBundleSchema,
    issues: Schema.Array(CodeModeIssue).pipe(Schema.mutable),
  },
  { identifier: undefined },
) {}
export class BuildMindmapRejected extends Schema.Class<BuildMindmapRejected>(
  "BuildMindmapRejected",
)(
  {
    ok: booleanLiteral(false),
    status: literals([
      "invalid_input",
      "invalid_mindmap",
      "quality_failed",
      "render_failed",
      "export_failed",
      "storage_failed",
    ]),
    buildId: optionalContract(Schema.String),
    requestId: optionalContract(Schema.String),
    normalizedSpec: optionalContract(NormalizedMindmapSpecSchema),
    quality: optionalContract(QualityReportSchema),
    partial: optionalContract(PartialArtifactBundleSchema),
    issues: Schema.Array(CodeModeIssue).pipe(Schema.mutable),
  },
  { identifier: undefined },
) {}
export const BuildMindmapResultSchema = Schema.Union([
  BuildMindmapAccepted,
  BuildMindmapRejected,
]);
export type BuildMindmapResult = typeof BuildMindmapResultSchema.Type;

export class BuildSequenceDiagramAccepted extends Schema.Class<BuildSequenceDiagramAccepted>(
  "BuildSequenceDiagramAccepted",
)(
  {
    ok: booleanLiteral(true),
    status: stringLiteral("accepted"),
    buildId: Schema.String,
    requestId: optionalContract(Schema.String),
    normalizedSpec: NormalizedSequenceDiagramSpecSchema,
    quality: QualityReportSchema,
    artifact: ArtifactBundleSchema,
    issues: Schema.Array(CodeModeIssue).pipe(Schema.mutable),
  },
  { identifier: undefined },
) {}
export class BuildSequenceDiagramRejected extends Schema.Class<BuildSequenceDiagramRejected>(
  "BuildSequenceDiagramRejected",
)(
  {
    ok: booleanLiteral(false),
    status: literals([
      "invalid_input",
      "invalid_sequence",
      "quality_failed",
      "render_failed",
      "export_failed",
      "storage_failed",
    ]),
    buildId: optionalContract(Schema.String),
    requestId: optionalContract(Schema.String),
    normalizedSpec: optionalContract(NormalizedSequenceDiagramSpecSchema),
    quality: optionalContract(QualityReportSchema),
    partial: optionalContract(PartialArtifactBundleSchema),
    issues: Schema.Array(CodeModeIssue).pipe(Schema.mutable),
  },
  { identifier: undefined },
) {}
export const BuildSequenceDiagramResultSchema = Schema.Union([
  BuildSequenceDiagramAccepted,
  BuildSequenceDiagramRejected,
]);
export type BuildSequenceDiagramResult =
  typeof BuildSequenceDiagramResultSchema.Type;

export class GetArtifactAccepted extends Schema.Class<GetArtifactAccepted>(
  "GetArtifactAccepted",
)(
  {
    ok: booleanLiteral(true),
    artifactId: Schema.String,
    diagramId: Schema.String,
    format: ArtifactFormatSchema,
    mimeType: Schema.String,
    url: optionalContract(Schema.String),
    expiresAt: optionalContract(Schema.String),
    inline: optionalContract(Schema.Unknown),
    sizeBytes: optionalContract(Schema.Number),
    provenance: optionalContract(ArtifactProvenance),
  },
  { identifier: undefined },
) {}
export class GetArtifactRejected extends Schema.Class<GetArtifactRejected>(
  "GetArtifactRejected",
)(
  {
    ok: booleanLiteral(false),
    status: literals([
      "invalid_input",
      "not_found",
      "format_unavailable",
      "expired",
      "storage_failed",
    ]),
    issues: Schema.Array(CodeModeIssue).pipe(Schema.mutable),
  },
  { identifier: undefined },
) {}
export const GetArtifactResultSchema = Schema.Union([
  GetArtifactAccepted,
  GetArtifactRejected,
]);
export type GetArtifactResult = typeof GetArtifactResultSchema.Type;

export class ApplyDiagramPatchAccepted extends Schema.Class<ApplyDiagramPatchAccepted>(
  "ApplyDiagramPatchAccepted",
)(
  {
    ok: booleanLiteral(true),
    status: stringLiteral("accepted"),
    patchId: Schema.String,
    requestId: optionalContract(Schema.String),
    sourceArtifactId: optionalContract(Schema.String),
    artifact: ArtifactBundleSchema,
    issues: Schema.Array(CodeModeIssue).pipe(Schema.mutable),
  },
  { identifier: undefined },
) {}
export class ApplyDiagramPatchRejected extends Schema.Class<ApplyDiagramPatchRejected>(
  "ApplyDiagramPatchRejected",
)(
  {
    ok: booleanLiteral(false),
    status: literals([
      "invalid_input",
      "source_unavailable",
      "target_not_found",
      "unsupported_operation",
      "connectivity_changed",
      "render_failed",
      "export_failed",
      "storage_failed",
    ]),
    patchId: optionalContract(Schema.String),
    requestId: optionalContract(Schema.String),
    sourceArtifactId: optionalContract(Schema.String),
    partial: optionalContract(PartialArtifactBundleSchema),
    issues: Schema.Array(CodeModeIssue).pipe(Schema.mutable),
  },
  { identifier: undefined },
) {}
export const ApplyDiagramPatchResultSchema = Schema.Union([
  ApplyDiagramPatchAccepted,
  ApplyDiagramPatchRejected,
]);
export type ApplyDiagramPatchResult = typeof ApplyDiagramPatchResultSchema.Type;
