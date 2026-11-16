import { contractDiscriminatorAnnotation } from "../build/input.js";
import { CodeModeIssue } from "../build/result.js";

import {
	ArtifactBundleSchema,
	BuildArtifactFormatSchema,
	InlineArtifactFormatSchema,
	PartialArtifactBundleSchema,
} from "@sketchi/drawing/artifacts";
import { Schema } from "effect";

import {
	booleanLiteral,
	contractOneOfAnnotation,
	FiniteNumber,
	HexColor,
	literals,
	nonEmptyArray,
	NonEmptyString,
	optionalContract,
	requiredArray,
	requiredObject,
	RequiredNonEmptyString,
	stringLiteral,
} from "../build/code-mode/schema.js";
import { CanvasElementInput, CanvasInput } from "./input.js";

const FLOWCHART_NODE_KINDS = ["start", "process", "decision", "end"] as const;
const FlowchartNodeKindSchema = Object.assign(literals(FLOWCHART_NODE_KINDS), {
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

const ArtifactFormatsOption = optionalContract(nonEmptyArray(BuildArtifactFormatSchema));
const InlineArtifactsOption = optionalContract(
	Schema.Array(InlineArtifactFormatSchema).pipe(Schema.mutable),
);

export const DiagramSelector = Schema.Struct({
	ids: optionalContract(Schema.Array(NonEmptyString).pipe(Schema.mutable)),
	nodeIds: optionalContract(Schema.Array(NonEmptyString).pipe(Schema.mutable)),
	edgeIds: optionalContract(Schema.Array(NonEmptyString).pipe(Schema.mutable)),
	kinds: optionalContract(Schema.Array(FlowchartNodeKindSchema).pipe(Schema.mutable)),
	labels: optionalContract(Schema.Array(NonEmptyString).pipe(Schema.mutable)),
	scope: optionalContract(literals(["all", "nodes", "edges"])),
}).annotate({ identifier: undefined });

export interface DiagramSelector extends Schema.Schema.Type<typeof DiagramSelector> {}

export const DiagramStylePatch = Schema.Struct({
	strokeColor: optionalContract(HexColor),
	fillColor: optionalContract(HexColor),
	textColor: optionalContract(HexColor),
	backgroundColor: optionalContract(HexColor),
}).annotate({ identifier: undefined });

export interface DiagramStylePatch extends Schema.Schema.Type<typeof DiagramStylePatch> {}

export const DIAGRAM_SHAPES = ["rectangle", "diamond", "ellipse", "circle", "polygon"] as const;
export const DiagramShapeSchema = Object.assign(literals(DIAGRAM_SHAPES), {
	options: DIAGRAM_SHAPES,
});
export type DiagramShape = typeof DiagramShapeSchema.Type;

export const SetDefaultStyleOperation = Schema.Struct({
	op: stringLiteral("setDefaultStyle"),
	style: requiredObject(DiagramStylePatch),
}).annotate({ identifier: undefined });

export interface SetDefaultStyleOperation extends Schema.Schema.Type<
	typeof SetDefaultStyleOperation
> {}
export const SetStyleOperation = Schema.Struct({
	op: stringLiteral("setStyle"),
	selector: requiredObject(DiagramSelector),
	style: requiredObject(DiagramStylePatch),
}).annotate({ identifier: undefined });

export interface SetStyleOperation extends Schema.Schema.Type<typeof SetStyleOperation> {}
export const SetShapeOperation = Schema.Struct({
	op: stringLiteral("setShape"),
	selector: requiredObject(DiagramSelector),
	shape: DiagramShapeSchema,
}).annotate({ identifier: undefined });

export interface SetShapeOperation extends Schema.Schema.Type<typeof SetShapeOperation> {}
export const TranslateOperation = Schema.Struct({
	op: stringLiteral("translate"),
	selector: requiredObject(DiagramSelector),
	dx: FiniteNumber,
	dy: FiniteNumber,
}).annotate({ identifier: undefined });

export interface TranslateOperation extends Schema.Schema.Type<typeof TranslateOperation> {}
export const ReplaceTextOperation = Schema.Struct({
	op: stringLiteral("replaceText"),
	selector: requiredObject(DiagramSelector),
	text: RequiredNonEmptyString,
}).annotate({ identifier: undefined });

export interface ReplaceTextOperation extends Schema.Schema.Type<typeof ReplaceTextOperation> {}
export const RerouteEdgesOperation = Schema.Struct({
	op: stringLiteral("rerouteEdges"),
	selector: optionalContract(DiagramSelector),
}).annotate({ identifier: undefined });

export interface RerouteEdgesOperation extends Schema.Schema.Type<typeof RerouteEdgesOperation> {}

const PatchElementIds = requiredArray(nonEmptyArray(NonEmptyString));

export const InsertElementsOperation = Schema.Struct({
	op: stringLiteral("insert"),
	elements: requiredArray(nonEmptyArray(CanvasElementInput)),
	beforeId: optionalContract(NonEmptyString),
	afterId: optionalContract(NonEmptyString),
}).annotate({ identifier: undefined });

export interface InsertElementsOperation extends Schema.Schema.Type<
	typeof InsertElementsOperation
> {}

export const RemoveElementsOperation = Schema.Struct({
	op: stringLiteral("remove"),
	selector: requiredObject(DiagramSelector),
}).annotate({ identifier: undefined });

export interface RemoveElementsOperation extends Schema.Schema.Type<
	typeof RemoveElementsOperation
> {}

export const ReplaceElementOperation = Schema.Struct({
	op: stringLiteral("replace"),
	id: RequiredNonEmptyString,
	element: requiredObject(CanvasElementInput),
}).annotate({ identifier: undefined });

export interface ReplaceElementOperation extends Schema.Schema.Type<
	typeof ReplaceElementOperation
> {}

export const ReorderElementsOperation = Schema.Struct({
	op: stringLiteral("reorder"),
	ids: PatchElementIds,
	beforeId: optionalContract(NonEmptyString),
	afterId: optionalContract(NonEmptyString),
}).annotate({ identifier: undefined });

export interface ReorderElementsOperation extends Schema.Schema.Type<
	typeof ReorderElementsOperation
> {}

export const GroupElementsOperation = Schema.Struct({
	op: stringLiteral("group"),
	ids: PatchElementIds,
	groupId: RequiredNonEmptyString,
}).annotate({ identifier: undefined });

export interface GroupElementsOperation extends Schema.Schema.Type<typeof GroupElementsOperation> {}

export const UngroupElementsOperation = Schema.Struct({
	op: stringLiteral("ungroup"),
	ids: PatchElementIds,
	groupId: optionalContract(NonEmptyString),
}).annotate({ identifier: undefined });

export interface UngroupElementsOperation extends Schema.Schema.Type<
	typeof UngroupElementsOperation
> {}

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

export const ArtifactPatchSource = Schema.Struct({
	artifactId: RequiredNonEmptyString,
	format: optionalContract(stringLiteral("scene")),
}).annotate({ identifier: undefined });

export interface ArtifactPatchSource extends Schema.Schema.Type<typeof ArtifactPatchSource> {}

export const InlineScenePatchSource = Schema.Struct({
	scene: requiredObject(CanvasInput),
}).annotate({ identifier: undefined });

export interface InlineScenePatchSource extends Schema.Schema.Type<typeof InlineScenePatchSource> {}
export const DiagramPatchSourceSchema = Schema.Union([
	ArtifactPatchSource,
	InlineScenePatchSource,
]).annotate({ message: "Invalid input" });
export type DiagramPatchSource = typeof DiagramPatchSourceSchema.Type;

export const ApplyDiagramPatchOptions = Schema.Struct({
	artifactFormats: ArtifactFormatsOption,
	inlineArtifacts: InlineArtifactsOption,
	preserveConnectivity: optionalContract(Schema.Boolean),
}).annotate({ identifier: undefined });

export interface ApplyDiagramPatchOptions extends Schema.Schema.Type<
	typeof ApplyDiagramPatchOptions
> {}

export const ApplyDiagramPatchRequest = Schema.Struct({
	requestId: optionalContract(NonEmptyString),
	source: DiagramPatchSourceSchema.annotateKey({
		messageMissingKey: "Invalid input",
	}),
	operations: requiredArray(nonEmptyArray(DiagramPatchOperationSchema)),
	options: optionalContract(ApplyDiagramPatchOptions),
	intent: optionalContract(NonEmptyString),
}).annotate({ identifier: undefined });

export interface ApplyDiagramPatchRequest extends Schema.Schema.Type<
	typeof ApplyDiagramPatchRequest
> {}

export const ApplyDiagramPatchAccepted = Schema.Struct({
	ok: booleanLiteral(true),
	status: stringLiteral("accepted"),
	patchId: Schema.String,
	requestId: optionalContract(Schema.String),
	sourceArtifactId: optionalContract(Schema.String),
	artifact: ArtifactBundleSchema,
	issues: Schema.Array(CodeModeIssue).pipe(Schema.mutable),
}).annotate({ identifier: undefined });

export interface ApplyDiagramPatchAccepted extends Schema.Schema.Type<
	typeof ApplyDiagramPatchAccepted
> {}
export const ApplyDiagramPatchRejected = Schema.Struct({
	ok: booleanLiteral(false),
	status: literals([
		"invalid_input",
		"source_unavailable",
		"target_not_found",
		"unsupported_operation",
		"connectivity_changed",
		"limit_exceeded",
		"render_failed",
		"export_failed",
		"storage_failed",
	]),
	patchId: optionalContract(Schema.String),
	requestId: optionalContract(Schema.String),
	sourceArtifactId: optionalContract(Schema.String),
	partial: optionalContract(PartialArtifactBundleSchema),
	issues: Schema.Array(CodeModeIssue).pipe(Schema.mutable),
}).annotate({ identifier: undefined });

export interface ApplyDiagramPatchRejected extends Schema.Schema.Type<
	typeof ApplyDiagramPatchRejected
> {}
export const ApplyDiagramPatchResultSchema = Schema.Union([
	ApplyDiagramPatchAccepted,
	ApplyDiagramPatchRejected,
]);
export type ApplyDiagramPatchResult = typeof ApplyDiagramPatchResultSchema.Type;
