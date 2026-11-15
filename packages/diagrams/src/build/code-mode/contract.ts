import { contractDiscriminatorAnnotation, contractMissingKeyCodeAnnotation } from "../input.js";
import { flowchartBuild, FlowchartRequestText } from "../../families/flowchart/build.js";
import { BuildOptions, CodeModeIssue, QualityReportSchema } from "../result.js";

import {
	BuildArtifactFormatSchema,
	ArtifactFormatSchema,
	InlineArtifactFormatSchema,
	ArtifactProvenance,
	ArtifactBundleSchema,
	PartialArtifactBundleSchema,
} from "@sketchi/drawing/artifacts";
import { Effect, Schema, SchemaAST, SchemaGetter, SchemaIssue } from "effect";

import {
	CANVAS_LIMITS,
	CanvasSpec,
	CanvasPoint,
	CanvasNodeIcon,
	CanvasShapeElement,
	CanvasTextElement,
	CanvasConnectorElement,
	CanvasLineElement,
	CanvasFrameElement,
	CanvasIconElement,
	SKETCHI_DIAGRAM_STYLE,
	DrawnIconSchema,
} from "@sketchi/drawing";

import { FlowchartEditsSchema } from "../../families/flowchart/edits.js";
import {
	CLASS_KINDS,
	CLASS_RELATIONSHIP_KINDS,
	CLASS_VISIBILITIES,
} from "../../families/class/document.js";
import { ER_CARDINALITIES } from "../../families/er/document.js";

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
const hexColorPattern = /^#[0-9a-fA-F]{6}$/u;
function hexColor(defaultValue?: string) {
	return Schema.String.annotate(defaultValue === undefined ? {} : { default: defaultValue }).check(
		Schema.isPattern(hexColorPattern, {
			message: `Invalid string: must match pattern /${hexColorPattern.source}/`,
		}),
	);
}
const HexColor = hexColor();

/** Formats a build can export. */

/**
 * Formats an artifact can hold: what its build exported, and for a flowchart its
 * document, which editFlowchart starts from.
 */

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
 * A logo: an exact slug returned by sketchi.searchIcons, or a drawn icon (what
 * sketchi.drawIcon returns, or any name and recipe). Unknown slugs and
 * undrawable recipes are dropped with a warning.
 */
export const NodeIconSpec = Schema.Struct({
	slug: optionalContract(IconSlugInput),
	...DrawnIconSchema.fields,
}).annotate({ identifier: undefined });

export interface NodeIconSpec extends Schema.Schema.Type<typeof NodeIconSpec> {}

const defaultAccentColor = SKETCHI_DIAGRAM_STYLE.accentColor;
const DefaultAccentColor = hexColor(defaultAccentColor).pipe(
	Schema.withDecodingDefaultKey(Effect.succeed(defaultAccentColor)),
);
const defaultBackgroundColor = SKETCHI_DIAGRAM_STYLE.backgroundColor;
const DefaultBackgroundColor = hexColor(defaultBackgroundColor).pipe(
	Schema.withDecodingDefaultKey(Effect.succeed(defaultBackgroundColor)),
);

/** The fixed Sketchi palette a spec may still carry; builds always draw it. */
export const DiagramSpecStyle = Schema.Struct({
	accentColor: DefaultAccentColor,
	backgroundColor: DefaultBackgroundColor,
}).annotate({ identifier: undefined });

export interface DiagramSpecStyle extends Schema.Schema.Type<typeof DiagramSpecStyle> {}

const diagramStyleDefault = {
	accentColor: SKETCHI_DIAGRAM_STYLE.accentColor,
	backgroundColor: SKETCHI_DIAGRAM_STYLE.backgroundColor,
};
const DiagramStyleWithDefault = DiagramSpecStyle.annotate({
	default: diagramStyleDefault,
}).pipe(
	Schema.withDecodingDefaultKey(Effect.succeed(diagramStyleDefault)),
	Schema.annotateKey({ [contractDefaultAnnotation]: diagramStyleDefault }),
);

/**
 * A flowchart is diagram-core's flowchart document: nodes as an id → label map,
 * edges as [from, to, label?], and groups and lanes that list what they contain.
 */

/**
 * The authoring form of diagram-core's canonical ErDiagram: a field may be one
 * string (`"id uuid PK"`), relationship ids are optional and style is
 * defaulted. buildErDiagram normalizes it into the core contract, which owns
 * every invariant.
 */
export const ErFieldSpec = Schema.Struct({
	name: RequiredNonEmptyString,
	type: optionalContract(NonEmptyString),
	pk: optionalContract(Schema.Boolean),
	fk: optionalContract(Schema.Boolean),
	unique: optionalContract(Schema.Boolean),
	nullable: optionalContract(Schema.Boolean),
}).annotate({ identifier: undefined });

export interface ErFieldSpec extends Schema.Schema.Type<typeof ErFieldSpec> {}

const erFieldsDefault: Array<string | typeof ErFieldSpec.Encoded> = [];
export const ErEntitySpec = Schema.Struct({
	id: RequiredNonEmptyString,
	name: optionalContract(NonEmptyString),
	fields: Schema.Array(Schema.Union([NonEmptyString, ErFieldSpec]))
		.pipe(Schema.mutable)
		.annotate({ default: erFieldsDefault })
		.pipe(Schema.withDecodingDefaultKey(Effect.succeed(erFieldsDefault))),
}).annotate({ identifier: undefined });

export interface ErEntitySpec extends Schema.Schema.Type<typeof ErEntitySpec> {}

export const ErRelationshipSpec = Schema.Struct({
	id: optionalContract(NonEmptyString),
	from: RequiredNonEmptyString,
	to: RequiredNonEmptyString,
	fromCardinality: literals(ER_CARDINALITIES),
	toCardinality: literals(ER_CARDINALITIES),
	label: optionalContract(NonEmptyString),
}).annotate({ identifier: undefined });

export interface ErRelationshipSpec extends Schema.Schema.Type<typeof ErRelationshipSpec> {}

const erRelationshipsDefault: Array<typeof ErRelationshipSpec.Encoded> = [];
const ErRelationshipsWithDefault = Schema.Array(ErRelationshipSpec)
	.pipe(Schema.mutable)
	.annotate({ default: erRelationshipsDefault })
	.pipe(Schema.withDecodingDefaultKey(Effect.succeed(erRelationshipsDefault)));
export const ErSpec = Schema.Struct({
	id: optionalContract(NonEmptyString),
	title: RequiredNonEmptyString,
	entities: requiredArray(nonEmptyArray(ErEntitySpec)),
	relationships: ErRelationshipsWithDefault,
	style: DiagramStyleWithDefault,
}).annotate({ identifier: undefined });

export interface ErSpec extends Schema.Schema.Type<typeof ErSpec> {}

/**
 * The authoring form of diagram-core's canonical ClassDiagram: a member may be
 * one string (`"- radius: double"`, `"+ area(): double"`), relationship ids are
 * optional and style is defaulted. buildClassDiagram normalizes it into the
 * core contract, which owns every invariant.
 */
export const ClassAttributeSpec = Schema.Struct({
	name: RequiredNonEmptyString,
	type: optionalContract(NonEmptyString),
	visibility: optionalContract(literals(CLASS_VISIBILITIES)),
	static: optionalContract(Schema.Boolean),
}).annotate({ identifier: undefined });

export interface ClassAttributeSpec extends Schema.Schema.Type<typeof ClassAttributeSpec> {}

export const ClassParameterSpec = Schema.Struct({
	name: RequiredNonEmptyString,
	type: optionalContract(NonEmptyString),
}).annotate({ identifier: undefined });

export interface ClassParameterSpec extends Schema.Schema.Type<typeof ClassParameterSpec> {}

const classParamsDefault: Array<string | typeof ClassParameterSpec.Encoded> = [];
export const ClassMethodSpec = Schema.Struct({
	name: RequiredNonEmptyString,
	params: Schema.Array(Schema.Union([NonEmptyString, ClassParameterSpec]))
		.pipe(Schema.mutable)
		.annotate({ default: classParamsDefault })
		.pipe(Schema.withDecodingDefaultKey(Effect.succeed(classParamsDefault))),
	returns: optionalContract(NonEmptyString),
	visibility: optionalContract(literals(CLASS_VISIBILITIES)),
	static: optionalContract(Schema.Boolean),
	abstract: optionalContract(Schema.Boolean),
}).annotate({ identifier: undefined });

export interface ClassMethodSpec extends Schema.Schema.Type<typeof ClassMethodSpec> {}

const classAttributesDefault: Array<string | typeof ClassAttributeSpec.Encoded> = [];
// No member is the same decoded or encoded, so one empty list serves both.
const classMethodsDefault: never[] = [];
export const ClassNodeSpec = Schema.Struct({
	id: RequiredNonEmptyString,
	name: optionalContract(NonEmptyString),
	kind: optionalContract(literals(CLASS_KINDS)),
	stereotype: optionalContract(NonEmptyString),
	attributes: Schema.Array(Schema.Union([NonEmptyString, ClassAttributeSpec]))
		.pipe(Schema.mutable)
		.annotate({ default: classAttributesDefault })
		.pipe(Schema.withDecodingDefaultKey(Effect.succeed(classAttributesDefault))),
	methods: Schema.Array(Schema.Union([NonEmptyString, ClassMethodSpec]))
		.pipe(Schema.mutable)
		.annotate({ default: classMethodsDefault })
		.pipe(Schema.withDecodingDefaultKey(Effect.succeed(classMethodsDefault))),
}).annotate({ identifier: undefined });

export interface ClassNodeSpec extends Schema.Schema.Type<typeof ClassNodeSpec> {}

export const ClassRelationshipSpec = Schema.Struct({
	id: optionalContract(NonEmptyString),
	kind: literals(CLASS_RELATIONSHIP_KINDS),
	from: RequiredNonEmptyString,
	to: RequiredNonEmptyString,
	fromMultiplicity: optionalContract(NonEmptyString),
	toMultiplicity: optionalContract(NonEmptyString),
	fromRole: optionalContract(NonEmptyString),
	toRole: optionalContract(NonEmptyString),
	navigable: optionalContract(Schema.Boolean),
	label: optionalContract(NonEmptyString),
}).annotate({ identifier: undefined });

export interface ClassRelationshipSpec extends Schema.Schema.Type<typeof ClassRelationshipSpec> {}

const classRelationshipsDefault: Array<typeof ClassRelationshipSpec.Encoded> = [];
const ClassRelationshipsWithDefault = Schema.Array(ClassRelationshipSpec)
	.pipe(Schema.mutable)
	.annotate({ default: classRelationshipsDefault })
	.pipe(Schema.withDecodingDefaultKey(Effect.succeed(classRelationshipsDefault)));
export const ClassSpec = Schema.Struct({
	id: optionalContract(NonEmptyString),
	title: RequiredNonEmptyString,
	classes: requiredArray(nonEmptyArray(ClassNodeSpec)),
	relationships: ClassRelationshipsWithDefault,
	style: DiagramStyleWithDefault,
}).annotate({ identifier: undefined });

export interface ClassSpec extends Schema.Schema.Type<typeof ClassSpec> {}

const ArtifactFormatsOption = optionalContract(nonEmptyArray(BuildArtifactFormatSchema));
const InlineArtifactsOption = optionalContract(
	Schema.Array(InlineArtifactFormatSchema).pipe(Schema.mutable),
);

/**
 * A change to a built flowchart: the artifact it starts from and the edits, by id. The edited
 * document builds as a new artifact.
 */
export const EditFlowchartRequest = Schema.Struct({
	requestId: optionalContract(NonEmptyString),
	artifactId: RequiredNonEmptyString,
	edits: requiredObject(FlowchartEditsSchema),
	request: optionalContract(FlowchartRequestText),
	options: optionalContract(BuildOptions),
}).annotate({ identifier: undefined });

export interface EditFlowchartRequest extends Schema.Schema.Type<typeof EditFlowchartRequest> {}

export const BuildErDiagramRequest = Schema.Struct({
	requestId: optionalContract(NonEmptyString),
	spec: requiredObject(ErSpec),
	options: optionalContract(BuildOptions),
}).annotate({ identifier: undefined });

export interface BuildErDiagramRequest extends Schema.Schema.Type<typeof BuildErDiagramRequest> {}
/** The ER spec a model authors; style is always the Sketchi palette. */
export const ErToolSpecSchema = ErSpec.mapFields(({ style: _style, ...fields }) => fields);
export const BuildErDiagramToolInputSchema = Schema.Struct({
	requestId: optionalContract(NonEmptyString),
	spec: requiredObject(ErToolSpecSchema),
});
export type BuildErDiagramToolInput = typeof BuildErDiagramToolInputSchema.Type;
export const BuildClassDiagramRequest = Schema.Struct({
	requestId: optionalContract(NonEmptyString),
	spec: requiredObject(ClassSpec),
	options: optionalContract(BuildOptions),
}).annotate({ identifier: undefined });

export interface BuildClassDiagramRequest extends Schema.Schema.Type<
	typeof BuildClassDiagramRequest
> {}
/** The class diagram spec a model authors; style is always the Sketchi palette. */
export const ClassToolSpecSchema = ClassSpec.mapFields(({ style: _style, ...fields }) => fields);
export const BuildClassDiagramToolInputSchema = Schema.Struct({
	requestId: optionalContract(NonEmptyString),
	spec: requiredObject(ClassToolSpecSchema),
});
export type BuildClassDiagramToolInput = typeof BuildClassDiagramToolInputSchema.Type;
/** The mindmap spec a model authors; style is always the Sketchi palette. */

/** Authoring adds inline recipes; accepted scenes resolve them to slugs and assets. */
const CanvasIconInput = Schema.Struct({
	...CanvasNodeIcon.fields,
	slug: optionalContract(CanvasNodeIcon.fields.slug).pipe(Schema.mutableKey),
	...DrawnIconSchema.fields,
});
const CanvasInputPoints = Schema.Array(CanvasPoint)
	.pipe(Schema.mutable)
	.check(Schema.isMinLength(2), Schema.isMaxLength(CANVAS_LIMITS.maxPointsPerElement));
const CanvasElementInput = Schema.Union(
	[
		CanvasShapeElement.mapFields((fields) => ({
			...fields,
			icon: optionalContract(CanvasIconInput).pipe(Schema.mutableKey),
			points: optionalContract(CanvasInputPoints).pipe(Schema.mutableKey),
		})),
		CanvasTextElement,
		CanvasConnectorElement.mapFields((fields) => ({
			...fields,
			points: CanvasInputPoints.pipe(Schema.mutableKey),
		})),
		CanvasLineElement.mapFields((fields) => ({
			...fields,
			points: CanvasInputPoints.pipe(Schema.mutableKey),
		})),
		CanvasFrameElement.mapFields((fields) => ({
			...fields,
			icon: optionalContract(CanvasIconInput).pipe(Schema.mutableKey),
		})),
		CanvasIconElement.mapFields((fields) => ({
			...fields,
			slug: optionalContract(fields.slug).pipe(Schema.mutableKey),
			...DrawnIconSchema.fields,
		})),
	],
	{ mode: "oneOf" },
);
const CanvasInput = CanvasSpec.mapFields((fields) => ({
	...fields,
	elements: requiredArray(
		Schema.Array(CanvasElementInput)
			.pipe(Schema.mutable)
			.annotate({ maxItems: CANVAS_LIMITS.maxElements }),
	),
}));

export const CreateCanvasRequest = Schema.Struct({
	requestId: optionalContract(NonEmptyString),
	spec: requiredObject(CanvasInput),
	options: optionalContract(BuildOptions),
}).annotate({ identifier: undefined });

export interface CreateCanvasRequest extends Schema.Schema.Type<typeof CreateCanvasRequest> {}

export const GetArtifactRequest = Schema.Struct({
	artifactId: RequiredNonEmptyString,
	format: optionalContract(ArtifactFormatSchema),
	inline: optionalContract(Schema.Boolean),
}).annotate({ identifier: undefined });

export interface GetArtifactRequest extends Schema.Schema.Type<typeof GetArtifactRequest> {}

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
export const ApplyDiagramPatchOptionsSchema = optionalContract(ApplyDiagramPatchOptions);

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

const NormalizedErSpecSchema = Schema.Struct({
	id: NonEmptyString,
	title: NonEmptyString,
	entities: Schema.Array(
		Schema.Struct({
			id: NonEmptyString,
			name: optionalContract(NonEmptyString),
			fields: Schema.Array(ErFieldSpec).pipe(Schema.mutable),
		}),
	).pipe(Schema.mutable),
	relationships: Schema.Array(
		ErRelationshipSpec.mapFields((fields) => ({ ...fields, id: NonEmptyString })),
	).pipe(Schema.mutable),
	style: Schema.Struct({ accentColor: HexColor, backgroundColor: HexColor }),
});
export type NormalizedErSpec = typeof NormalizedErSpecSchema.Type;
const NormalizedClassSpecSchema = Schema.Struct({
	id: NonEmptyString,
	title: NonEmptyString,
	classes: Schema.Array(
		Schema.Struct({
			id: NonEmptyString,
			name: optionalContract(NonEmptyString),
			kind: optionalContract(literals(CLASS_KINDS)),
			stereotype: optionalContract(NonEmptyString),
			attributes: Schema.Array(ClassAttributeSpec).pipe(Schema.mutable),
			methods: Schema.Array(
				ClassMethodSpec.mapFields((fields) => ({
					...fields,
					params: Schema.Array(ClassParameterSpec).pipe(Schema.mutable),
				})),
			).pipe(Schema.mutable),
		}),
	).pipe(Schema.mutable),
	relationships: Schema.Array(
		ClassRelationshipSpec.mapFields((fields) => ({ ...fields, id: NonEmptyString })),
	).pipe(Schema.mutable),
	style: Schema.Struct({ accentColor: HexColor, backgroundColor: HexColor }),
});
export type NormalizedClassSpec = typeof NormalizedClassSpecSchema.Type;
/** An edited flowchart, built as a new artifact whose provenance names the one it changed. */
export const EditFlowchartAccepted = Schema.Struct({
	...flowchartBuild.accepted.fields,
	/** The edits as applied. */
	edits: FlowchartEditsSchema,
}).annotate({ identifier: undefined });

export interface EditFlowchartAccepted extends Schema.Schema.Type<typeof EditFlowchartAccepted> {}
/**
 * An edit that stored nothing: no flowchart document to start from, an edit naming what the
 * document lacks, or an edited document that does not build.
 */
export const EditFlowchartRejected = Schema.Struct({
	...flowchartBuild.rejected.fields,
	status: literals([
		...flowchartBuild.rejected.fields.status.literals,
		"not_found",
		"invalid_edit",
	]),
}).annotate({ identifier: undefined });

export interface EditFlowchartRejected extends Schema.Schema.Type<typeof EditFlowchartRejected> {}
export const EditFlowchartResultSchema = Schema.Union([
	EditFlowchartAccepted,
	EditFlowchartRejected,
]);
export type EditFlowchartResult = typeof EditFlowchartResultSchema.Type;

export const BuildErDiagramAccepted = Schema.Struct({
	ok: booleanLiteral(true),
	status: stringLiteral("accepted"),
	buildId: Schema.String,
	requestId: optionalContract(Schema.String),
	normalizedSpec: NormalizedErSpecSchema,
	quality: QualityReportSchema,
	artifact: ArtifactBundleSchema,
	issues: Schema.Array(CodeModeIssue).pipe(Schema.mutable),
}).annotate({ identifier: undefined });

export interface BuildErDiagramAccepted extends Schema.Schema.Type<typeof BuildErDiagramAccepted> {}
export const BuildErDiagramRejected = Schema.Struct({
	ok: booleanLiteral(false),
	status: literals([
		"invalid_input",
		"invalid_er_diagram",
		"quality_failed",
		"limit_exceeded",
		"render_failed",
		"export_failed",
		"storage_failed",
	]),
	buildId: optionalContract(Schema.String),
	requestId: optionalContract(Schema.String),
	normalizedSpec: optionalContract(NormalizedErSpecSchema),
	quality: optionalContract(QualityReportSchema),
	partial: optionalContract(PartialArtifactBundleSchema),
	issues: Schema.Array(CodeModeIssue).pipe(Schema.mutable),
}).annotate({ identifier: undefined });

export interface BuildErDiagramRejected extends Schema.Schema.Type<typeof BuildErDiagramRejected> {}
export const BuildErDiagramResultSchema = Schema.Union([
	BuildErDiagramAccepted,
	BuildErDiagramRejected,
]);
export type BuildErDiagramResult = typeof BuildErDiagramResultSchema.Type;

export const BuildClassDiagramAccepted = Schema.Struct({
	ok: booleanLiteral(true),
	status: stringLiteral("accepted"),
	buildId: Schema.String,
	requestId: optionalContract(Schema.String),
	normalizedSpec: NormalizedClassSpecSchema,
	quality: QualityReportSchema,
	artifact: ArtifactBundleSchema,
	issues: Schema.Array(CodeModeIssue).pipe(Schema.mutable),
}).annotate({ identifier: undefined });

export interface BuildClassDiagramAccepted extends Schema.Schema.Type<
	typeof BuildClassDiagramAccepted
> {}
export const BuildClassDiagramRejected = Schema.Struct({
	ok: booleanLiteral(false),
	status: literals([
		"invalid_input",
		"invalid_class_diagram",
		"quality_failed",
		"limit_exceeded",
		"render_failed",
		"export_failed",
		"storage_failed",
	]),
	buildId: optionalContract(Schema.String),
	requestId: optionalContract(Schema.String),
	normalizedSpec: optionalContract(NormalizedClassSpecSchema),
	quality: optionalContract(QualityReportSchema),
	partial: optionalContract(PartialArtifactBundleSchema),
	issues: Schema.Array(CodeModeIssue).pipe(Schema.mutable),
}).annotate({ identifier: undefined });

export interface BuildClassDiagramRejected extends Schema.Schema.Type<
	typeof BuildClassDiagramRejected
> {}
export const BuildClassDiagramResultSchema = Schema.Union([
	BuildClassDiagramAccepted,
	BuildClassDiagramRejected,
]);
export type BuildClassDiagramResult = typeof BuildClassDiagramResultSchema.Type;

export const GetArtifactAccepted = Schema.Struct({
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
}).annotate({ identifier: undefined });

export interface GetArtifactAccepted extends Schema.Schema.Type<typeof GetArtifactAccepted> {}
export const GetArtifactRejected = Schema.Struct({
	ok: booleanLiteral(false),
	status: literals([
		"invalid_input",
		"not_found",
		"format_unavailable",
		"expired",
		"storage_failed",
	]),
	issues: Schema.Array(CodeModeIssue).pipe(Schema.mutable),
}).annotate({ identifier: undefined });

export interface GetArtifactRejected extends Schema.Schema.Type<typeof GetArtifactRejected> {}
export const GetArtifactResultSchema = Schema.Union([GetArtifactAccepted, GetArtifactRejected]);
export type GetArtifactResult = typeof GetArtifactResultSchema.Type;

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

export const CreateCanvasAccepted = Schema.Struct({
	ok: booleanLiteral(true),
	status: stringLiteral("accepted"),
	buildId: Schema.String,
	requestId: optionalContract(Schema.String),
	normalizedSpec: CanvasSpec,
	artifact: ArtifactBundleSchema,
	issues: Schema.Array(CodeModeIssue).pipe(Schema.mutable),
}).annotate({ identifier: undefined });

export interface CreateCanvasAccepted extends Schema.Schema.Type<typeof CreateCanvasAccepted> {}

export const CreateCanvasRejected = Schema.Struct({
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
}).annotate({ identifier: undefined });

export interface CreateCanvasRejected extends Schema.Schema.Type<typeof CreateCanvasRejected> {}

export const CreateCanvasResultSchema = Schema.Union([CreateCanvasAccepted, CreateCanvasRejected]);
export type CreateCanvasResult = typeof CreateCanvasResultSchema.Type;

const maximumIconQueryLength = 120;
const minimumIconSearchLimit = 1;
const maximumIconSearchLimit = 25;
export const DEFAULT_ICON_SEARCH_LIMIT = 10;

/** Ranked search over the logos a node may carry (see NodeIconSpec). */
export const SearchIconsRequest = Schema.Struct({
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
}).annotate({ identifier: undefined });

export interface SearchIconsRequest extends Schema.Schema.Type<typeof SearchIconsRequest> {}

export const SearchIconsMatch = Schema.Struct({
	slug: Schema.String,
	name: Schema.String,
	collection: Schema.String,
	/** exact: the product's own mark; vendor: its vendor's or platform's; weak: fuzzier. */
	match: literals(["exact", "vendor", "weak"]),
}).annotate({ identifier: undefined });

export interface SearchIconsMatch extends Schema.Schema.Type<typeof SearchIconsMatch> {}

export const SearchIconsAccepted = Schema.Struct({
	ok: booleanLiteral(true),
	status: stringLiteral("accepted"),
	query: Schema.String,
	icons: Schema.Array(SearchIconsMatch).pipe(Schema.mutable),
	issues: Schema.Array(CodeModeIssue).pipe(Schema.mutable),
}).annotate({ identifier: undefined });

export interface SearchIconsAccepted extends Schema.Schema.Type<typeof SearchIconsAccepted> {}

export const SearchIconsRejected = Schema.Struct({
	ok: booleanLiteral(false),
	status: literals(["invalid_input"]),
	issues: Schema.Array(CodeModeIssue).pipe(Schema.mutable),
}).annotate({ identifier: undefined });

export interface SearchIconsRejected extends Schema.Schema.Type<typeof SearchIconsRejected> {}

export const SearchIconsResultSchema = Schema.Union([SearchIconsAccepted, SearchIconsRejected]);
export type SearchIconsResult = typeof SearchIconsResultSchema.Type;
