import { Effect, Schema, SchemaAST, SchemaGetter, SchemaIssue } from "effect";
import type { StandardJSONSchemaV1, StandardSchemaV1 } from "@standard-schema/spec";
import {
	CANVAS_LIMITS,
	CANVAS_NODE_ICON,
	CANVAS_RENDERER_ROLES,
	CANVAS_SPEC_VERSION,
	SEQUENCE_MESSAGE_STYLES,
	SEQUENCE_MESSAGE_TYPES,
	SKETCHI_DIAGRAM_STYLE,
} from "@sketchi/diagram-core";

import { cleanToolString } from "../clean-tool-string.js";

export class ContractSchemaIssue extends Schema.Class<ContractSchemaIssue>("ContractSchemaIssue")(
	{
		code: stringLiteral("custom"),
		issueTag: Schema.Literals([
			"Filter",
			"InvalidType",
			"InvalidValue",
			"MissingKey",
			"UnexpectedKey",
			"Forbidden",
			"OneOf",
			"AnyOf",
		]),
		astKind: Schema.optionalKey(Schema.String),
		missingKeyCode: Schema.optionalKey(Schema.Literal("invalid_type")),
		message: Schema.String,
		path: Schema.Array(Schema.PropertyKey),
	},
	{ identifier: undefined },
) {}

export class ContractSchemaError extends Schema.TaggedError<ContractSchemaError>()(
	"ContractSchemaError",
	{ issues: Schema.Array(Schema.toEncoded(ContractSchemaIssue)) },
) {}

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
	const actual = SchemaIssue.hasInput(issue) ? issue.input : undefined;
	return `Invalid input: expected ${expectedType(issue.ast)}, received ${actualType(actual)}`;
};

const contractFormatter = SchemaIssue.makeFormatterStandardSchemaV1({
	leafHook: contractLeafHook,
});

function contractIssues(
	error: Schema.SchemaError,
): ReadonlyArray<typeof ContractSchemaIssue.Encoded> {
	const issues: Array<typeof ContractSchemaIssue.Encoded> = [];
	const visit = (
		node: SchemaIssue.Issue,
		path: readonly PropertyKey[],
		ast?: SchemaAST.AST,
	): void => {
		switch (node._tag) {
			case "Pointer":
				return visit(node.issue, [...path, ...node.path], ast);
			case "Encoding":
				return visit(node.issue, path, ast);
			case "Composite":
				for (const child of node.issues) visit(child, path, node.ast);
				return;
			case "AnyOf":
				if (node.issues.length > 0) {
					for (const child of node.issues) visit(child, path, node.ast);
					return;
				}
				break;
			case "Filter":
				if (
					SchemaIssue.defaultCheckHook(node) === undefined &&
					node.issue._tag !== "InvalidValue"
				) {
					return visit(node.issue, path, ast);
				}
				break;
			default:
				// Leaf issues are formatted below.
				break;
		}
		const nodeAst = "ast" in node ? node.ast : ast;
		const missingKeyCode =
			node._tag === "MissingKey" &&
			node.annotations?.[contractMissingKeyCodeAnnotation] === "invalid_type"
				? ("invalid_type" as const)
				: undefined;
		const astKind =
			nodeAst && SchemaAST.isUnion(nodeAst) && nodeAst.types.every(SchemaAST.isLiteral)
				? "LiteralUnion"
				: nodeAst?._tag;
		const discriminator = nodeAst?.annotations?.[contractDiscriminatorAnnotation];
		const issuePath = typeof discriminator === "string" ? [...path, discriminator] : path;
		for (const formatted of contractFormatter(node).issues) {
			issues.push({
				code: "custom",
				issueTag: node._tag,
				...(missingKeyCode ? { missingKeyCode } : {}),
				...(astKind ? { astKind } : {}),
				message: formatted.message,
				path: issuePath,
			});
		}
	};
	visit(error.issue, []);
	if (issues.length > 1 && issues.every((issue) => issue.path[0] === "source")) {
		return [
			{
				code: "custom",
				issueTag: "AnyOf",
				astKind: "Union",
				message: "Invalid input",
				path: ["source"],
			},
		];
	}
	return issues;
}

export function formatContractSchemaError(error: Schema.SchemaError): ContractSchemaError {
	return new ContractSchemaError({ issues: contractIssues(error) });
}

const codeModeJsonSchemaAnnotationKeys = new Set([
	"x-sketchi-default",
	"x-sketchi-one-of",
	"const",
	"exclusiveMaximum",
	"exclusiveMinimum",
	"maximum",
	"maxLength",
	"maxItems",
	"minimum",
	"minItems",
	"minLength",
	"pattern",
]);

const contractDefaultAnnotation = "x-sketchi-default";
const contractOneOfAnnotation = "x-sketchi-one-of";
const contractDiscriminatorAnnotation = "codeModeDiscriminator";
const contractMissingKeyCodeAnnotation = "codeModeMissingKeyCode";

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Effect 4 preserves soundness by downgrading `oneOf` to `anyOf` whenever a
 * branch contains a JSON Schema approximation. Our tagged scene and patch
 * unions remain mutually exclusive because every branch has a distinct
 * discriminator, so retain their established public contract. Effect also
 * renders property annotations on class-backed defaults through `allOf`; fold
 * those metadata-only annotations back into the property schema.
 */
function normalizeCodeModeJsonSchema(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(normalizeCodeModeJsonSchema);
	}
	if (!isRecord(value)) return value;

	const normalized = Object.fromEntries(
		Object.entries(value).map(([key, nested]) => [key, normalizeCodeModeJsonSchema(nested)]),
	);

	const forceOneOf = normalized[contractOneOfAnnotation] === true;
	delete normalized[contractOneOfAnnotation];
	if (forceOneOf && Array.isArray(normalized["anyOf"])) {
		normalized["oneOf"] = normalized["anyOf"];
		delete normalized["anyOf"];
	}

	const allOf = normalized["allOf"];
	if (Array.isArray(allOf)) {
		const remaining: unknown[] = [];
		for (const clause of allOf) {
			if (isRecord(clause) && Object.hasOwn(clause, contractDefaultAnnotation)) {
				normalized["default"] = clause[contractDefaultAnnotation];
			} else {
				remaining.push(clause);
			}
		}
		if (remaining.length === 0) delete normalized["allOf"];
		else normalized["allOf"] = remaining;
	}

	return normalized;
}

export function toCodeModeJsonSchema(schema: Schema.Constraint): Record<string, unknown> {
	const document = Schema.toJsonSchemaDocument(Schema.toType(schema), {
		includeAnnotationKey: (key) => codeModeJsonSchemaAnnotationKeys.has(key),
		onExcessProperty: "error",
	});
	return normalizeCodeModeJsonSchema({
		$schema: "https://json-schema.org/draft/2020-12/schema",
		...document.schema,
		...(Object.keys(document.definitions).length === 0 ? {} : { $defs: document.definitions }),
	}) as Record<string, unknown>;
}

function nonEmptyString() {
	const minimumLength = 1;
	return Schema.String.check(
		Schema.isMinLength(minimumLength, {
			message: "Too small: expected string to have >=1 characters",
		}),
	);
}

function nonEmptyArray<S extends Schema.Constraint>(schema: S) {
	const minimumLength = 1;
	return Schema.Array(schema)
		.pipe(Schema.mutable)
		.check(
			Schema.isMinLength(minimumLength, {
				message: "Too small: expected array to have >=1 items",
			}),
		);
}

function optionalContract<S extends Schema.Constraint>(schema: S): Schema.optionalKey<S> {
	return Schema.optionalKey(schema);
}

function requiredString<S extends Schema.Top>(schema: S): S["Rebuild"] {
	return schema.pipe(
		Schema.annotateKey({
			[contractMissingKeyCodeAnnotation]: "invalid_type",
			messageMissingKey: "Invalid input: expected string, received undefined",
		}),
	);
}

function requiredObject<S extends Schema.Top>(schema: S): S["Rebuild"] {
	return schema.pipe(
		Schema.annotateKey({
			[contractMissingKeyCodeAnnotation]: "invalid_type",
			messageMissingKey: "Invalid input: expected object, received undefined",
		}),
	);
}

function requiredArray<S extends Schema.Top>(schema: S): S["Rebuild"] {
	return schema.pipe(
		Schema.annotateKey({
			[contractMissingKeyCodeAnnotation]: "invalid_type",
			messageMissingKey: "Invalid input: expected array, received undefined",
		}),
	);
}

function literals<
	const Values extends readonly [SchemaAST.LiteralValue, ...SchemaAST.LiteralValue[]],
>(values: Values) {
	return Schema.Literals(values).annotate({
		message: `Invalid option: expected one of ${values
			.map((value) => JSON.stringify(value))
			.join("|")}`,
	});
}

function stringLiteral<const Value extends string>(value: Value) {
	return literalDeclaration<string, Value>(value, Schema.String);
}

function numberLiteral<const Value extends number>(value: Value) {
	return literalDeclaration<number, Value>(value, Schema.Number);
}

function booleanLiteral<const Value extends boolean>(value: Value) {
	return literalDeclaration<boolean, Value>(value, Schema.Boolean);
}

function literalDeclaration<
	Primitive extends string | number | boolean,
	const Value extends Primitive,
>(value: Value, primitive: Schema.Codec<Primitive>) {
	const declaration = Schema.declareConstructor<Value>()(
		[],
		() => (input, ast, options) =>
			input === value
				? Effect.succeed(value)
				: Effect.fail(new SchemaIssue.InvalidType(ast, input, options)),
		{
			message: `Invalid literal value, expected ${JSON.stringify(value)}`,
			toCodecJson: () =>
				Schema.link<Value>()(primitive.annotate({ const: value }), {
					decode: SchemaGetter.transform(() => value),
					encode: SchemaGetter.transform((input) => input as Primitive),
				}),
		},
	);
	return Schema.Literal(value).pipe(Schema.decodeTo(declaration));
}

const NonEmptyString = nonEmptyString();
const RequiredNonEmptyString = requiredString(NonEmptyString);
const FiniteNumber = Schema.Finite;
const positiveThreshold = 0;
const PositiveNumber = Schema.Number.check(
	Schema.isFinite(),
	Schema.isGreaterThan(positiveThreshold, {
		message: "Too small: expected number to be >0",
	}),
);
const hexColorPattern = /^#[0-9a-fA-F]{6}$/u;
function hexColor(defaultValue?: string) {
	return Schema.String.annotate(defaultValue === undefined ? {} : { default: defaultValue }).check(
		Schema.isPattern(hexColorPattern, {
			message: `Invalid string: must match pattern /${hexColorPattern.source}/`,
		}),
	);
}
const HexColor = hexColor();

export const HexColorSchema = HexColor;

export const ARTIFACT_FORMATS = ["excalidraw", "scene", "png"] as const;
export const INLINE_ARTIFACT_FORMATS = ["excalidraw", "scene"] as const;

export const ArtifactFormatSchema = Object.assign(literals(ARTIFACT_FORMATS), {
	options: ARTIFACT_FORMATS,
});
export const InlineArtifactFormatSchema = Object.assign(literals(INLINE_ARTIFACT_FORMATS), {
	options: INLINE_ARTIFACT_FORMATS,
});
export type ArtifactFormat = typeof ArtifactFormatSchema.Type;
export type InlineArtifactFormat = typeof InlineArtifactFormatSchema.Type;

export class ArtifactProvenance extends Schema.Class<ArtifactProvenance>("ArtifactProvenance")(
	{
		sourceArtifactId: RequiredNonEmptyString.pipe(Schema.mutableKey),
	},
	{ identifier: undefined },
) {}
export const ArtifactProvenanceSchema = ArtifactProvenance;

export const CODE_MODE_ISSUE_CODES = [
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
	"sequence_too_large",
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
	"duplicate_element_id",
	"duplicate_layer_id",
	"invalid_canvas_binding",
	"invalid_canvas_composition",
	"invalid_canvas_geometry",
	"invalid_polygon",
	"canvas_limit_exceeded",
	"invalid_z_order",
	"unknown_layout_target",
	"unknown_icon",
	"invalid_canvas_icon",
	"icon_dropped",
] as const;

export const CodeModeIssueCodeSchema = Object.assign(literals(CODE_MODE_ISSUE_CODES), {
	options: CODE_MODE_ISSUE_CODES,
});
export type CodeModeIssueCode = typeof CodeModeIssueCodeSchema.Type;

const CodeModeIssueKindSchema = literals([
	"request",
	"diagram",
	"node",
	"edge",
	"element",
	"layer",
	"artifact",
]);
const CodeModeIssueStageSchema = literals([
	"input",
	"canvas",
	"flowchart",
	"mindmap",
	"quality",
	"render",
	"export",
	"storage",
]);

export class CodeModeIssueRef extends Schema.Class<CodeModeIssueRef>("CodeModeIssueRef")(
	{
		kind: CodeModeIssueKindSchema,
		id: optionalContract(NonEmptyString),
		path: optionalContract(NonEmptyString),
	},
	{ identifier: undefined },
) {}
export const CodeModeIssueRefSchema = CodeModeIssueRef;

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
export const CodeModeIssueSchema = CodeModeIssue;

export const FLOWCHART_NODE_KINDS = ["start", "process", "decision", "end"] as const;
export const FlowchartNodeKindSchema = Object.assign(literals(FLOWCHART_NODE_KINDS), {
	options: FLOWCHART_NODE_KINDS,
});

export const DIAGRAM_PATCH_OPERATION_NAMES = [
	"setDefaultStyle",
	"setStyle",
	"setShape",
	"translate",
	"replaceText",
	"rerouteEdges",
	"insert",
	"remove",
	"replace",
	"reorder",
	"group",
	"ungroup",
] as const;
export const DiagramPatchOperationNameSchema = Object.assign(
	literals(DIAGRAM_PATCH_OPERATION_NAMES),
	{ options: DIAGRAM_PATCH_OPERATION_NAMES },
);

const maximumIconSlugInputLength = 128;
const IconSlugInput = requiredString(
	nonEmptyString().check(
		Schema.isMaxLength(maximumIconSlugInputLength, {
			message: `Too big: expected string to have <=${maximumIconSlugInputLength} characters`,
		}),
	),
);

/**
 * A logo from the Sketchi icon catalog. Use an exact slug returned by
 * sketchi.searchIcons; unknown slugs are dropped with an unknown_icon warning.
 */
export class NodeIconSpec extends Schema.Class<NodeIconSpec>("NodeIconSpec")(
	{
		slug: IconSlugInput,
	},
	{ identifier: undefined },
) {}
export const NodeIconSpecSchema = NodeIconSpec;

export class FlowchartSpecNode extends Schema.Class<FlowchartSpecNode>("FlowchartSpecNode")(
	{
		id: RequiredNonEmptyString,
		label: RequiredNonEmptyString,
		kind: FlowchartNodeKindSchema,
		description: optionalContract(NonEmptyString),
		icon: optionalContract(NodeIconSpec),
	},
	{ identifier: undefined },
) {}

export class FlowchartSpecEdge extends Schema.Class<FlowchartSpecEdge>("FlowchartSpecEdge")(
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
}).pipe(Schema.withDecodingDefaultKey(Effect.succeed(flowchartDirectionDefault)));

export class FlowchartSpecLayout extends Schema.Class<FlowchartSpecLayout>("FlowchartSpecLayout")(
	{
		direction: FlowchartDirectionWithDefault,
	},
	{ identifier: undefined },
) {}

const defaultAccentColor = SKETCHI_DIAGRAM_STYLE.accentColor;
const DefaultAccentColor = hexColor(defaultAccentColor).pipe(
	Schema.withDecodingDefaultKey(Effect.succeed(defaultAccentColor)),
);
const defaultBackgroundColor = SKETCHI_DIAGRAM_STYLE.backgroundColor;
const DefaultBackgroundColor = hexColor(defaultBackgroundColor).pipe(
	Schema.withDecodingDefaultKey(Effect.succeed(defaultBackgroundColor)),
);

export class FlowchartSpecStyle extends Schema.Class<FlowchartSpecStyle>("FlowchartSpecStyle")(
	{
		accentColor: DefaultAccentColor,
		backgroundColor: DefaultBackgroundColor,
	},
	{ identifier: undefined },
) {}

const flowchartEdgesDefault: Array<typeof FlowchartSpecEdge.Encoded> = [];
const FlowchartEdgesWithDefault = Schema.Array(FlowchartSpecEdge)
	.pipe(Schema.mutable)
	.annotate({ default: flowchartEdgesDefault })
	.pipe(Schema.withDecodingDefaultKey(Effect.succeed(flowchartEdgesDefault)));
const flowchartLayoutDefault: { readonly direction: "TB" } = {
	direction: "TB",
};
const FlowchartLayoutWithDefault = FlowchartSpecLayout.annotate({
	default: flowchartLayoutDefault,
}).pipe(
	Schema.withDecodingDefaultKey(Effect.succeed(flowchartLayoutDefault)),
	Schema.annotateKey({
		[contractDefaultAnnotation]: flowchartLayoutDefault,
	}),
);
const diagramStyleDefault = {
	accentColor: SKETCHI_DIAGRAM_STYLE.accentColor,
	backgroundColor: SKETCHI_DIAGRAM_STYLE.backgroundColor,
};
const DiagramStyleWithDefault = FlowchartSpecStyle.annotate({
	default: diagramStyleDefault,
}).pipe(
	Schema.withDecodingDefaultKey(Effect.succeed(diagramStyleDefault)),
	Schema.annotateKey({ [contractDefaultAnnotation]: diagramStyleDefault }),
);
export class FlowchartSpec extends Schema.Class<FlowchartSpec>("FlowchartSpec")(
	{
		id: optionalContract(NonEmptyString),
		title: RequiredNonEmptyString,
		nodes: requiredArray(nonEmptyArray(FlowchartSpecNode)),
		edges: FlowchartEdgesWithDefault,
		layout: FlowchartLayoutWithDefault,
		style: DiagramStyleWithDefault,
	},
	{ identifier: undefined },
) {}
export const FlowchartSpecSchema = FlowchartSpec;
export const FlowchartSpecNodeSchema = FlowchartSpecNode;
export const FlowchartSpecEdgeSchema = FlowchartSpecEdge;
export const FlowchartSpecLayoutSchema = FlowchartSpecLayout;
export const FlowchartSpecStyleSchema = FlowchartSpecStyle;

/**
 * The authoring form of diagram-core's canonical SequenceDiagram: message ids
 * are optional and style is defaulted. buildSequenceDiagram normalizes it into
 * the core contract, which owns every sequence invariant.
 */
export class SequenceParticipantSpec extends Schema.Class<SequenceParticipantSpec>(
	"SequenceParticipantSpec",
)(
	{
		id: RequiredNonEmptyString,
		label: RequiredNonEmptyString,
		kind: optionalContract(NonEmptyString),
		icon: optionalContract(NodeIconSpec),
	},
	{ identifier: undefined },
) {}

export class SequenceMessageSpec extends Schema.Class<SequenceMessageSpec>("SequenceMessageSpec")(
	{
		id: optionalContract(NonEmptyString),
		source: RequiredNonEmptyString,
		target: RequiredNonEmptyString,
		label: RequiredNonEmptyString,
		type: optionalContract(literals(SEQUENCE_MESSAGE_TYPES)),
		style: optionalContract(literals(SEQUENCE_MESSAGE_STYLES)),
	},
	{ identifier: undefined },
) {}

const sequenceMessagesDefault: Array<typeof SequenceMessageSpec.Encoded> = [];
const SequenceMessagesWithDefault = Schema.Array(SequenceMessageSpec)
	.pipe(Schema.mutable)
	.annotate({ default: sequenceMessagesDefault })
	.pipe(Schema.withDecodingDefaultKey(Effect.succeed(sequenceMessagesDefault)));
export class SequenceDiagramSpec extends Schema.Class<SequenceDiagramSpec>("SequenceDiagramSpec")(
	{
		id: optionalContract(NonEmptyString),
		title: RequiredNonEmptyString,
		participants: requiredArray(nonEmptyArray(SequenceParticipantSpec)),
		messages: SequenceMessagesWithDefault,
		style: DiagramStyleWithDefault,
	},
	{ identifier: undefined },
) {}
export const SequenceDiagramSpecSchema = SequenceDiagramSpec;
export const SequenceParticipantSpecSchema = SequenceParticipantSpec;
export const SequenceMessageSpecSchema = SequenceMessageSpec;

const ArtifactFormatsOption = optionalContract(nonEmptyArray(ArtifactFormatSchema));
const InlineArtifactsOption = optionalContract(
	Schema.Array(InlineArtifactFormatSchema).pipe(Schema.mutable),
);
const minimumQualityScore = 0;
const maximumQualityScore = 10;
const QualityScoreOption = optionalContract(
	Schema.Number.check(
		Schema.isFinite(),
		Schema.isGreaterThanOrEqualTo(minimumQualityScore, {
			message: `Too small: expected number to be >=${minimumQualityScore}`,
		}),
		Schema.isLessThanOrEqualTo(maximumQualityScore, {
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
export const BuildFlowchartOptionsSchema = optionalContract(BuildFlowchartOptions);

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
const BuildFlowchartToolInputStandardSchema = Schema.toStandardSchemaV1(
	BuildFlowchartToolInputContract,
	{ leafHook: contractLeafHook, parseOptions: { errors: "all" } },
);
export const BuildFlowchartToolInputSchema = Object.assign(BuildFlowchartToolInputStandardSchema, {
	"~standard": {
		...BuildFlowchartToolInputStandardSchema["~standard"],
		jsonSchema: {
			input: () => toCodeModeJsonSchema(BuildFlowchartToolInputContract),
			output: () => toCodeModeJsonSchema(BuildFlowchartToolInputContract),
		},
	},
}) satisfies StandardSchemaV1<
	typeof BuildFlowchartToolInputContract.Encoded,
	BuildFlowchartToolInput
> &
	StandardJSONSchemaV1<typeof BuildFlowchartToolInputContract.Encoded, BuildFlowchartToolInput>;
export const BuildFlowchartRequestSchema = Object.assign(BuildFlowchartRequest, {
	omit: (_keys: { readonly options: true }) => BuildFlowchartToolInputSchema,
});

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
export const BuildSequenceDiagramRequestSchema = BuildSequenceDiagramRequest;

/**
 * What a chat model passes to a sequence build tool: the host supplies artifact
 * options, and style is always the Sketchi palette.
 */
export const BuildSequenceDiagramToolInputSchema = Schema.Struct({
	requestId: optionalContract(NonEmptyString),
	spec: requiredObject(
		SequenceDiagramSpec.mapFields(({ id, title, participants, messages }) => ({
			id,
			title,
			participants,
			messages,
		})),
	),
});
export type BuildSequenceDiagramToolInput = typeof BuildSequenceDiagramToolInputSchema.Type;

export interface MindmapTopicInput {
	label: string;
	children?: MindmapTopicInput[] | undefined;
}

function hasSemanticText(value: string): boolean {
	const cleaned = cleanToolString(value);
	return cleaned.length > 0 && !/^(?:""|''|``)$/.test(cleaned);
}

const semanticTextMinimumLength = 1;
const MindmapSemanticString = Schema.String.check(
	Schema.isMinLength(semanticTextMinimumLength, {
		message: `Too small: expected string to have >=${semanticTextMinimumLength} characters`,
	}),
	Schema.makeFilter(hasSemanticText, {
		message: "Must contain semantic text after normalization.",
	}),
);

const MindmapTopicReference: Schema.Codec<MindmapTopicInput, MindmapTopicInput> = requiredObject(
	Schema.suspend(() => MindmapTopic).annotate({ identifier: "__schema0" }),
);

export const MindmapTopic: Schema.Codec<MindmapTopicInput, MindmapTopicInput> = Schema.Struct({
	label: requiredString(MindmapSemanticString),
	children: Schema.optionalKey(Schema.Array(MindmapTopicReference).pipe(Schema.mutable)),
});
export const MindmapTopicSchema = MindmapTopicReference;

export class MindmapSpecLayout extends Schema.Class<MindmapSpecLayout>("MindmapSpecLayout")(
	{
		direction: literals(["LR", "RL"])
			.annotate({ default: "LR" })
			.pipe(Schema.withDecodingDefaultKey(Effect.succeed("LR"))),
	},
	{ identifier: undefined },
) {}

const mindmapLayoutDefault: { readonly direction: "LR" } = {
	direction: "LR",
};
const MindmapLayoutWithDefault = MindmapSpecLayout.annotate({
	default: mindmapLayoutDefault,
}).pipe(
	Schema.withDecodingDefaultKey(Effect.succeed(mindmapLayoutDefault)),
	Schema.annotateKey({ [contractDefaultAnnotation]: mindmapLayoutDefault }),
);
const MindmapSpecContract = Schema.Struct({
	id: optionalContract(NonEmptyString),
	title: requiredString(MindmapSemanticString),
	root: MindmapTopicReference,
	layout: MindmapLayoutWithDefault,
	style: DiagramStyleWithDefault,
});
export class MindmapSpec extends Schema.Class<MindmapSpec>("MindmapSpec")(MindmapSpecContract, {
	identifier: undefined,
}) {}
export const MindmapSpecSchema = MindmapSpec;

const BuildMindmapRequestContract = Schema.Struct({
	requestId: optionalContract(NonEmptyString),
	spec: requiredObject(MindmapSpecContract),
	options: optionalContract(BuildFlowchartOptions),
});
export class BuildMindmapRequest extends Schema.Class<BuildMindmapRequest>("BuildMindmapRequest")(
	BuildMindmapRequestContract,
	{ identifier: undefined },
) {}
export const BuildMindmapRequestSchema = BuildMindmapRequestContract;

export class ScenePoint extends Schema.Class<ScenePoint>("ScenePoint")(
	{
		x: FiniteNumber.pipe(Schema.mutableKey),
		y: FiniteNumber.pipe(Schema.mutableKey),
	},
	{ identifier: undefined },
) {}
export const ScenePointSchema = ScenePoint;

// Count limits are advertised here and enforced before compilation/patching by
// the runtime's canvas validator, preserving limit-specific failure responses.
const CanvasCompositionFields = {
	frameId: optionalContract(NonEmptyString).pipe(Schema.mutableKey),
	groupIds: optionalContract(
		Schema.Array(NonEmptyString)
			.pipe(Schema.mutable)
			.annotate({ maxItems: CANVAS_LIMITS.maxGroupsPerElement }),
	).pipe(Schema.mutableKey),
	layerId: optionalContract(NonEmptyString).pipe(Schema.mutableKey),
	locked: optionalContract(Schema.Boolean).pipe(Schema.mutableKey),
	opacity: optionalContract(
		Schema.Number.check(Schema.isFinite(), Schema.isBetween({ minimum: 0, maximum: 100 })),
	).pipe(Schema.mutableKey),
	zIndex: optionalContract(Schema.Int).pipe(Schema.mutableKey),
};

const CanvasStrokeFields = {
	fillColor: optionalContract(HexColor).pipe(Schema.mutableKey),
	fillStyle: optionalContract(literals(["cross-hatch", "hachure", "solid"])).pipe(
		Schema.mutableKey,
	),
	roughness: optionalContract(literals([0, 1, 2])).pipe(Schema.mutableKey),
	strokeColor: optionalContract(HexColor).pipe(Schema.mutableKey),
	strokeStyle: optionalContract(literals(["dashed", "dotted", "solid"])).pipe(Schema.mutableKey),
	strokeWidth: optionalContract(literals([1, 2, 4])).pipe(Schema.mutableKey),
};

const CanvasArrowhead = Schema.NullOr(literals(["arrow", "bar", "circle", "diamond", "triangle"]));

const CanvasPointList = Schema.Array(ScenePoint)
	.pipe(Schema.mutable)
	.check(
		Schema.isMinLength(2, {
			message: "Too small: expected array to have >=2 items",
		}),
		Schema.isMaxLength(CANVAS_LIMITS.maxPointsPerElement, {
			message: `Too big: expected array to have <=${CANVAS_LIMITS.maxPointsPerElement} items`,
		}),
	);

/** A catalog logo drawn top-center inside a node; size is its square edge. */
export class CanvasNodeIcon extends Schema.Class<CanvasNodeIcon>("CanvasNodeIcon")(
	{
		slug: IconSlugInput.pipe(Schema.mutableKey),
		size: Schema.Number.check(
			Schema.isFinite(),
			Schema.isBetween(
				{
					minimum: CANVAS_NODE_ICON.minSize,
					maximum: CANVAS_NODE_ICON.maxSize,
				},
				{
					message: `Expected a number between ${CANVAS_NODE_ICON.minSize} and ${CANVAS_NODE_ICON.maxSize}`,
				},
			),
		).pipe(Schema.mutableKey),
	},
	{ identifier: undefined },
) {}
export const CanvasNodeIconSchema = CanvasNodeIcon;

/** Derived SVG asset for one icon slug; Sketchi replaces any authored value. */
export class CanvasIconAsset extends Schema.Class<CanvasIconAsset>("CanvasIconAsset")(
	{
		name: Schema.String,
		svg: Schema.String,
	},
	{ identifier: undefined },
) {}
export const CanvasIconAssetSchema = CanvasIconAsset;

export class NodeSceneElement extends Schema.Class<NodeSceneElement>("NodeSceneElement")(
	{
		...CanvasCompositionFields,
		...CanvasStrokeFields,
		type: stringLiteral("node"),
		id: RequiredNonEmptyString,
		nodeId: RequiredNonEmptyString,
		kind: optionalContract(NonEmptyString),
		icon: optionalContract(CanvasNodeIcon).pipe(Schema.mutableKey),
		rendererRole: optionalContract(literals(CANVAS_RENDERER_ROLES)),
		shape: literals(["rectangle", "ellipse", "diamond", "circle", "polygon"]).pipe(
			Schema.mutableKey,
		),
		points: optionalContract(CanvasPointList).pipe(Schema.mutableKey),
		textColor: optionalContract(HexColor).pipe(Schema.mutableKey),
		x: FiniteNumber.pipe(Schema.mutableKey),
		y: FiniteNumber.pipe(Schema.mutableKey),
		width: PositiveNumber.pipe(Schema.mutableKey),
		height: PositiveNumber.pipe(Schema.mutableKey),
		label: RequiredNonEmptyString.pipe(Schema.mutableKey),
	},
	{ identifier: undefined },
) {}

export class TextSceneElement extends Schema.Class<TextSceneElement>("TextSceneElement")(
	{
		...CanvasCompositionFields,
		type: stringLiteral("text"),
		id: RequiredNonEmptyString,
		containerId: optionalContract(NonEmptyString),
		textColor: optionalContract(HexColor).pipe(Schema.mutableKey),
		x: FiniteNumber.pipe(Schema.mutableKey),
		y: FiniteNumber.pipe(Schema.mutableKey),
		text: RequiredNonEmptyString.pipe(Schema.mutableKey),
		fontSize: PositiveNumber,
		fontFamily: optionalContract(literals(["hand", "mono", "sans"])),
		maxWidth: optionalContract(PositiveNumber),
		textAlign: optionalContract(literals(["center", "left", "right"])),
		verticalAlign: optionalContract(literals(["bottom", "middle", "top"])),
	},
	{ identifier: undefined },
) {}

export class ArrowSceneElement extends Schema.Class<ArrowSceneElement>("ArrowSceneElement")(
	{
		...CanvasCompositionFields,
		...CanvasStrokeFields,
		type: stringLiteral("arrow"),
		id: RequiredNonEmptyString,
		edgeId: RequiredNonEmptyString,
		sourceNodeId: RequiredNonEmptyString,
		targetNodeId: RequiredNonEmptyString.pipe(Schema.mutableKey),
		startArrowhead: optionalContract(CanvasArrowhead).pipe(Schema.mutableKey),
		endArrowhead: optionalContract(CanvasArrowhead).pipe(Schema.mutableKey),
		textColor: optionalContract(HexColor).pipe(Schema.mutableKey),
		points: requiredArray(CanvasPointList).pipe(Schema.mutableKey),
		label: optionalContract(NonEmptyString).pipe(Schema.mutableKey),
	},
	{ identifier: undefined },
) {}

export class CanvasLineBinding extends Schema.Class<CanvasLineBinding>("CanvasLineBinding")(
	{
		elementId: RequiredNonEmptyString,
		focus: optionalContract(FiniteNumber),
		gap: optionalContract(FiniteNumber),
	},
	{ identifier: undefined },
) {}

export class LineSceneElement extends Schema.Class<LineSceneElement>("LineSceneElement")(
	{
		...CanvasCompositionFields,
		...CanvasStrokeFields,
		type: stringLiteral("line"),
		id: RequiredNonEmptyString,
		points: requiredArray(CanvasPointList).pipe(Schema.mutableKey),
		startBinding: optionalContract(CanvasLineBinding).pipe(Schema.mutableKey),
		endBinding: optionalContract(CanvasLineBinding).pipe(Schema.mutableKey),
		startArrowhead: optionalContract(CanvasArrowhead).pipe(Schema.mutableKey),
		endArrowhead: optionalContract(CanvasArrowhead).pipe(Schema.mutableKey),
		label: optionalContract(NonEmptyString).pipe(Schema.mutableKey),
		textColor: optionalContract(HexColor).pipe(Schema.mutableKey),
	},
	{ identifier: undefined },
) {}

export class FrameSceneElement extends Schema.Class<FrameSceneElement>("FrameSceneElement")(
	{
		...CanvasCompositionFields,
		...CanvasStrokeFields,
		type: stringLiteral("frame"),
		id: RequiredNonEmptyString,
		name: optionalContract(NonEmptyString).pipe(Schema.mutableKey),
		x: FiniteNumber.pipe(Schema.mutableKey),
		y: FiniteNumber.pipe(Schema.mutableKey),
		width: PositiveNumber.pipe(Schema.mutableKey),
		height: PositiveNumber.pipe(Schema.mutableKey),
	},
	{ identifier: undefined },
) {}

export class CanvasLayer extends Schema.Class<CanvasLayer>("CanvasLayer")(
	{
		id: RequiredNonEmptyString,
		name: optionalContract(NonEmptyString),
		locked: optionalContract(Schema.Boolean),
		visible: optionalContract(Schema.Boolean),
	},
	{ identifier: undefined },
) {}

const CanvasLayoutIds = requiredArray(nonEmptyArray(NonEmptyString));

export class CanvasFlowLayout extends Schema.Class<CanvasFlowLayout>("CanvasFlowLayout")(
	{
		type: literals(["row", "column", "stack"]),
		ids: CanvasLayoutIds,
		x: optionalContract(FiniteNumber),
		y: optionalContract(FiniteNumber),
		gap: optionalContract(FiniteNumber),
	},
	{ identifier: undefined },
) {}

export class CanvasGridLayout extends Schema.Class<CanvasGridLayout>("CanvasGridLayout")(
	{
		type: stringLiteral("grid"),
		ids: CanvasLayoutIds,
		columns: Schema.Int.check(
			Schema.isGreaterThanOrEqualTo(1, {
				message: "Too small: expected number to be >=1",
			}),
		),
		x: optionalContract(FiniteNumber),
		y: optionalContract(FiniteNumber),
		columnGap: optionalContract(FiniteNumber),
		rowGap: optionalContract(FiniteNumber),
	},
	{ identifier: undefined },
) {}

export class CanvasAlignLayout extends Schema.Class<CanvasAlignLayout>("CanvasAlignLayout")(
	{
		type: stringLiteral("align"),
		ids: CanvasLayoutIds,
		axis: literals(["x", "y"]),
		alignment: literals(["center", "end", "start"]),
	},
	{ identifier: undefined },
) {}

export class CanvasDistributeLayout extends Schema.Class<CanvasDistributeLayout>(
	"CanvasDistributeLayout",
)(
	{
		type: stringLiteral("distribute"),
		ids: CanvasLayoutIds,
		axis: literals(["x", "y"]),
		gap: optionalContract(FiniteNumber),
	},
	{ identifier: undefined },
) {}

export const NodeSceneElementSchema = NodeSceneElement;
export const TextSceneElementSchema = TextSceneElement;
export const ArrowSceneElementSchema = ArrowSceneElement;
export const LineSceneElementSchema = LineSceneElement;
export const FrameSceneElementSchema = FrameSceneElement;
export const SceneElementSchema = Schema.Union(
	[NodeSceneElement, TextSceneElement, ArrowSceneElement, LineSceneElement, FrameSceneElement],
	{ mode: "oneOf" },
).annotate({ [contractOneOfAnnotation]: true });

const CanvasLayoutSchema = Schema.Union(
	[CanvasFlowLayout, CanvasGridLayout, CanvasAlignLayout, CanvasDistributeLayout],
	{ mode: "oneOf" },
);

const EmptyCanvasLayers = Schema.Array(CanvasLayer)
	.pipe(Schema.mutable)
	.annotate({ default: [], maxItems: CANVAS_LIMITS.maxLayers })
	.pipe(Schema.withDecodingDefaultKey(Effect.succeed([])));
const EmptyCanvasLayouts = Schema.Array(CanvasLayoutSchema)
	.pipe(Schema.mutable)
	.annotate({ default: [], maxItems: CANVAS_LIMITS.maxLayouts })
	.pipe(Schema.withDecodingDefaultKey(Effect.succeed([])));
const EmptyCanvasZOrder = Schema.Array(NonEmptyString)
	.pipe(Schema.mutable)
	.annotate({ default: [], maxItems: CANVAS_LIMITS.maxZOrderEntries })
	.pipe(Schema.withDecodingDefaultKey(Effect.succeed([])));

export class CanvasSpec extends Schema.Class<CanvasSpec>("CanvasSpec")(
	{
		kind: stringLiteral("canvas"),
		version: numberLiteral(CANVAS_SPEC_VERSION),
		diagramId: RequiredNonEmptyString,
		title: RequiredNonEmptyString,
		width: PositiveNumber.pipe(Schema.mutableKey),
		height: PositiveNumber.pipe(Schema.mutableKey),
		accentColor: HexColor.pipe(Schema.mutableKey),
		backgroundColor: HexColor.pipe(Schema.mutableKey),
		elements: requiredArray(
			Schema.Array(SceneElementSchema)
				.pipe(Schema.mutable)
				.annotate({ maxItems: CANVAS_LIMITS.maxElements }),
		),
		icons: optionalContract(Schema.Record(Schema.String, CanvasIconAsset)).pipe(Schema.mutableKey),
		layers: EmptyCanvasLayers,
		layouts: EmptyCanvasLayouts,
		zOrder: EmptyCanvasZOrder,
	},
	{ identifier: undefined },
) {}
export const CanvasSpecSchema = CanvasSpec;
export type RenderedDiagramScene = CanvasSpec;
export const RenderedDiagramSceneSchema = CanvasSpecSchema;
export type PatchableScene = CanvasSpec;

export class CreateCanvasRequest extends Schema.Class<CreateCanvasRequest>("CreateCanvasRequest")(
	{
		requestId: optionalContract(NonEmptyString),
		spec: requiredObject(CanvasSpec),
		options: optionalContract(BuildFlowchartOptions),
	},
	{ identifier: undefined },
) {}
export const CreateCanvasRequestSchema = CreateCanvasRequest;

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
export const ExcalidrawElementSchema = ExcalidrawElement;

export class ExcalidrawScene extends Schema.Class<ExcalidrawScene>("ExcalidrawScene")(
	{
		appState: Schema.Record(Schema.String, Schema.Unknown),
		elements: Schema.Array(ExcalidrawElement).pipe(Schema.mutable),
	},
	{ identifier: undefined },
) {}
export const ExcalidrawSceneSchema = ExcalidrawScene;

export class ExcalidrawFile extends ExcalidrawScene.extend<ExcalidrawFile>("ExcalidrawFile")(
	{
		files: Schema.Record(Schema.String, Schema.Unknown),
		source: RequiredNonEmptyString,
		type: stringLiteral("excalidraw"),
		version: numberLiteral(2),
	},
	{ identifier: undefined },
) {}
export const ExcalidrawFileSchema = ExcalidrawFile;

export class GetArtifactRequest extends Schema.Class<GetArtifactRequest>("GetArtifactRequest")(
	{
		artifactId: RequiredNonEmptyString,
		format: optionalContract(ArtifactFormatSchema),
		inline: optionalContract(Schema.Boolean),
	},
	{ identifier: undefined },
) {}
export const GetArtifactRequestSchema = GetArtifactRequest;

export class DiagramSelector extends Schema.Class<DiagramSelector>("DiagramSelector")(
	{
		ids: optionalContract(Schema.Array(NonEmptyString).pipe(Schema.mutable)),
		nodeIds: optionalContract(Schema.Array(NonEmptyString).pipe(Schema.mutable)),
		edgeIds: optionalContract(Schema.Array(NonEmptyString).pipe(Schema.mutable)),
		kinds: optionalContract(Schema.Array(FlowchartNodeKindSchema).pipe(Schema.mutable)),
		labels: optionalContract(Schema.Array(NonEmptyString).pipe(Schema.mutable)),
		scope: optionalContract(literals(["all", "nodes", "edges"])),
	},
	{ identifier: undefined },
) {}
export const DiagramSelectorSchema = DiagramSelector;

export class DiagramStylePatch extends Schema.Class<DiagramStylePatch>("DiagramStylePatch")(
	{
		strokeColor: optionalContract(HexColor),
		fillColor: optionalContract(HexColor),
		textColor: optionalContract(HexColor),
		backgroundColor: optionalContract(HexColor),
	},
	{ identifier: undefined },
) {}
export const DiagramStylePatchSchema = DiagramStylePatch;

export const DIAGRAM_SHAPES = ["rectangle", "diamond", "ellipse", "circle", "polygon"] as const;
export const DiagramShapeSchema = Object.assign(literals(DIAGRAM_SHAPES), {
	options: DIAGRAM_SHAPES,
});
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
export class SetStyleOperation extends Schema.Class<SetStyleOperation>("SetStyleOperation")(
	{
		op: stringLiteral("setStyle"),
		selector: requiredObject(DiagramSelector),
		style: requiredObject(DiagramStylePatch),
	},
	{ identifier: undefined },
) {}
export class SetShapeOperation extends Schema.Class<SetShapeOperation>("SetShapeOperation")(
	{
		op: stringLiteral("setShape"),
		selector: requiredObject(DiagramSelector),
		shape: DiagramShapeSchema,
	},
	{ identifier: undefined },
) {}
export class TranslateOperation extends Schema.Class<TranslateOperation>("TranslateOperation")(
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

const PatchElementIds = requiredArray(nonEmptyArray(NonEmptyString));

export class InsertElementsOperation extends Schema.Class<InsertElementsOperation>(
	"InsertElementsOperation",
)(
	{
		op: stringLiteral("insert"),
		elements: requiredArray(nonEmptyArray(SceneElementSchema)),
		beforeId: optionalContract(NonEmptyString),
		afterId: optionalContract(NonEmptyString),
	},
	{ identifier: undefined },
) {}

export class RemoveElementsOperation extends Schema.Class<RemoveElementsOperation>(
	"RemoveElementsOperation",
)(
	{
		op: stringLiteral("remove"),
		selector: requiredObject(DiagramSelector),
	},
	{ identifier: undefined },
) {}

export class ReplaceElementOperation extends Schema.Class<ReplaceElementOperation>(
	"ReplaceElementOperation",
)(
	{
		op: stringLiteral("replace"),
		id: RequiredNonEmptyString,
		element: requiredObject(SceneElementSchema),
	},
	{ identifier: undefined },
) {}

export class ReorderElementsOperation extends Schema.Class<ReorderElementsOperation>(
	"ReorderElementsOperation",
)(
	{
		op: stringLiteral("reorder"),
		ids: PatchElementIds,
		beforeId: optionalContract(NonEmptyString),
		afterId: optionalContract(NonEmptyString),
	},
	{ identifier: undefined },
) {}

export class GroupElementsOperation extends Schema.Class<GroupElementsOperation>(
	"GroupElementsOperation",
)(
	{
		op: stringLiteral("group"),
		ids: PatchElementIds,
		groupId: RequiredNonEmptyString,
	},
	{ identifier: undefined },
) {}

export class UngroupElementsOperation extends Schema.Class<UngroupElementsOperation>(
	"UngroupElementsOperation",
)(
	{
		op: stringLiteral("ungroup"),
		ids: PatchElementIds,
		groupId: optionalContract(NonEmptyString),
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
		InsertElementsOperation,
		RemoveElementsOperation,
		ReplaceElementOperation,
		ReorderElementsOperation,
		GroupElementsOperation,
		UngroupElementsOperation,
	],
	{ mode: "oneOf" },
).annotate({
	[contractOneOfAnnotation]: true,
	[contractDiscriminatorAnnotation]: "op",
	message: `Invalid discriminator value. Expected ${DIAGRAM_PATCH_OPERATION_NAMES.map(
		(name) => `'${name}'`,
	).join(" | ")}`,
});
export type DiagramPatchOperation = typeof DiagramPatchOperationSchema.Type;

export class ArtifactPatchSource extends Schema.Class<ArtifactPatchSource>("ArtifactPatchSource")(
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
		scene: requiredObject(CanvasSpec),
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
export const ApplyDiagramPatchOptionsSchema = optionalContract(ApplyDiagramPatchOptions);

export class ApplyDiagramPatchRequest extends Schema.Class<ApplyDiagramPatchRequest>(
	"ApplyDiagramPatchRequest",
)(
	{
		requestId: optionalContract(NonEmptyString),
		source: DiagramPatchSourceSchema.annotateKey({
			messageMissingKey: "Invalid input",
		}),
		operations: requiredArray(nonEmptyArray(DiagramPatchOperationSchema)),
		options: optionalContract(ApplyDiagramPatchOptions),
		intent: optionalContract(NonEmptyString),
	},
	{ identifier: undefined },
) {}
export const ApplyDiagramPatchRequestSchema = ApplyDiagramPatchRequest;

export type NormalizedFlowchartSpec = typeof NormalizedFlowchartSpecSchema.Type;
export type NormalizedMindmapSpec = typeof NormalizedMindmapSpecSchema.Type;
export type NormalizedSequenceDiagramSpec = typeof NormalizedSequenceDiagramSpecSchema.Type;

export class NormalizedMindmapTopic extends Schema.Class<NormalizedMindmapTopic>(
	"NormalizedMindmapTopic",
)(
	{
		id: NonEmptyString,
		label: NonEmptyString,
		children: Schema.Array(
			Schema.suspend((): Schema.Codec<NormalizedMindmapTopic> => NormalizedMindmapTopic),
		).pipe(Schema.mutable),
	},
	{ identifier: undefined },
) {}

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
const NormalizedMindmapSpecSchema = Schema.Struct({
	id: NonEmptyString,
	title: NonEmptyString,
	root: NormalizedMindmapTopic,
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
	formats: optionalContract(Schema.Array(ArtifactFormatRefSchema).pipe(Schema.mutable)),
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
export const BuildMindmapResultSchema = Schema.Union([BuildMindmapAccepted, BuildMindmapRejected]);
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
export type BuildSequenceDiagramResult = typeof BuildSequenceDiagramResultSchema.Type;

export class GetArtifactAccepted extends Schema.Class<GetArtifactAccepted>("GetArtifactAccepted")(
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
export class GetArtifactRejected extends Schema.Class<GetArtifactRejected>("GetArtifactRejected")(
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
export const GetArtifactResultSchema = Schema.Union([GetArtifactAccepted, GetArtifactRejected]);
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

export class CreateCanvasAccepted extends Schema.Class<CreateCanvasAccepted>(
	"CreateCanvasAccepted",
)(
	{
		ok: booleanLiteral(true),
		status: stringLiteral("accepted"),
		buildId: Schema.String,
		requestId: optionalContract(Schema.String),
		normalizedSpec: CanvasSpec,
		artifact: ArtifactBundleSchema,
		issues: Schema.Array(CodeModeIssue).pipe(Schema.mutable),
	},
	{ identifier: undefined },
) {}

export class CreateCanvasRejected extends Schema.Class<CreateCanvasRejected>(
	"CreateCanvasRejected",
)(
	{
		ok: booleanLiteral(false),
		status: literals([
			"invalid_input",
			"invalid_canvas",
			"limit_exceeded",
			"render_failed",
			"export_failed",
			"storage_failed",
		]),
		buildId: optionalContract(Schema.String),
		requestId: optionalContract(Schema.String),
		normalizedSpec: optionalContract(CanvasSpec),
		partial: optionalContract(PartialArtifactBundleSchema),
		issues: Schema.Array(CodeModeIssue).pipe(Schema.mutable),
	},
	{ identifier: undefined },
) {}

export const CreateCanvasResultSchema = Schema.Union([CreateCanvasAccepted, CreateCanvasRejected]);
export type CreateCanvasResult = typeof CreateCanvasResultSchema.Type;

const maximumIconQueryLength = 120;
const minimumIconSearchLimit = 1;
const maximumIconSearchLimit = 25;
export const DEFAULT_ICON_SEARCH_LIMIT = 10;

/** Ranked search over the logos a node may carry (see NodeIconSpec). */
export class SearchIconsRequest extends Schema.Class<SearchIconsRequest>("SearchIconsRequest")(
	{
		q: requiredString(
			nonEmptyString().check(
				Schema.isMaxLength(maximumIconQueryLength, {
					message: `Too big: expected string to have <=${maximumIconQueryLength} characters`,
				}),
			),
		),
		limit: optionalContract(
			Schema.Int.check(
				Schema.isBetween(
					{
						minimum: minimumIconSearchLimit,
						maximum: maximumIconSearchLimit,
					},
					{
						message: `Expected an integer between ${minimumIconSearchLimit} and ${maximumIconSearchLimit}`,
					},
				),
			),
		),
	},
	{ identifier: undefined },
) {}
export const SearchIconsRequestSchema = SearchIconsRequest;

export class SearchIconsMatch extends Schema.Class<SearchIconsMatch>("SearchIconsMatch")(
	{
		slug: Schema.String,
		name: Schema.String,
		collection: Schema.String,
	},
	{ identifier: undefined },
) {}

export class SearchIconsAccepted extends Schema.Class<SearchIconsAccepted>("SearchIconsAccepted")(
	{
		ok: booleanLiteral(true),
		status: stringLiteral("accepted"),
		query: Schema.String,
		icons: Schema.Array(SearchIconsMatch).pipe(Schema.mutable),
		issues: Schema.Array(CodeModeIssue).pipe(Schema.mutable),
	},
	{ identifier: undefined },
) {}

export class SearchIconsRejected extends Schema.Class<SearchIconsRejected>("SearchIconsRejected")(
	{
		ok: booleanLiteral(false),
		status: literals(["invalid_input"]),
		issues: Schema.Array(CodeModeIssue).pipe(Schema.mutable),
	},
	{ identifier: undefined },
) {}

export const SearchIconsResultSchema = Schema.Union([SearchIconsAccepted, SearchIconsRejected]);
export type SearchIconsResult = typeof SearchIconsResultSchema.Type;
