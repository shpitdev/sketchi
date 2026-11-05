import {
	type CanonicalDiagram,
	CanonicalDiagramSchema,
	DiagramNodeShapeSchema,
	DiagramValidationError,
	ClassDiagramSchema,
	ClassValidationError,
	ErDiagramSchema,
	ErValidationError,
	isDiagramIconSlug,
	OrgChartDiagramSchema,
	OrgChartValidationError,
	QuadrantDiagramSchema,
	QuadrantValidationError,
	validateQuadrantDiagram,
	resolveOrgChartShorthand,
	validateOrgChartDiagram,
	VennDiagramSchema,
	VennValidationError,
	resolveVennShorthand,
	validateVennDiagram,
	JourneyDiagramSchema,
	JourneyValidationError,
	resolveJourneyShorthand,
	validateJourneyDiagram,
	SankeyDiagramSchema,
	SankeyValidationError,
	resolveSankeyShorthand,
	validateSankeyDiagram,
	resolveWireframeShorthand,
	validateWireframeDiagram,
	WireframeDiagramSchema,
	WireframeValidationError,
	resolveClassShorthand,
	resolveErShorthand,
	validateClassDiagram,
	validateErDiagram,
	FlowchartDiagramSchema,
	FlowchartValidationError,
	MindmapDiagramSchema,
	SKETCHI_DIAGRAM_STYLE,
	SequenceDiagramSchema,
	StateMachineDiagramSchema,
	StateMachineValidationError,
	getStateMachineDefaultWarnings,
	StateMachineDefaultWarningSchema,
	type StateMachineDefaultWarning,
	TimelineDiagramSchema,
	TimelineValidationError,
	validateTimelineDiagram,
	ChartDiagramSchema,
	ChartValidationError,
	GanttDiagramSchema,
	GanttValidationError,
	validateGanttDiagram,
	validateChartDiagram,
	SequenceValidationError,
	validateFlowchartDiagram,
	validateMindmapDiagram,
	validateSequenceDiagram,
	validateStateMachineDiagram,
} from "@sketchi/diagram-core";
import { Result, Schema, SchemaIssue } from "effect";

import {
	DiagramGenerationTypeSchema,
	GeneratedDiagramResponse,
	modelTitleOrFallback,
} from "./intent.js";
import { placeNodeLogos } from "./logo-placement.js";
import { isUnknownRecord, objectValue } from "./unknown-record.js";
import { DiagramGenerationPrompt } from "./messages.js";
import { GeneratedMindmapTree, generatedMindmapTreeToDiagram } from "./mindmap-tree.js";

export const diagramGenerationProviderIds: readonly [
	"fixture",
	"cloudflare-anthropic",
	"cloudflare-google-ai-studio",
	"google-ai-studio",
] = ["fixture", "cloudflare-anthropic", "cloudflare-google-ai-studio", "google-ai-studio"];

export const DiagramGenerationProviderIdSchema = Schema.Literals(diagramGenerationProviderIds);
export type DiagramGenerationProviderId = typeof DiagramGenerationProviderIdSchema.Type;

export const DiagramGenerationCacheModeSchema = Schema.Literals(["default", "fresh"]);
export type DiagramGenerationCacheMode = typeof DiagramGenerationCacheModeSchema.Type;

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
	warnings: Schema.optionalKey(Schema.Array(StateMachineDefaultWarningSchema).pipe(Schema.mutable)),
	diagram: Schema.optional(CanonicalDiagramSchema),
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
	warnings: Schema.optionalKey(Schema.Array(StateMachineDefaultWarningSchema).pipe(Schema.mutable)),
	diagramText: Schema.optional(Schema.String),
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
	candidates: Schema.Array(DiagramGenerationCandidateSummary).pipe(Schema.mutable),
	model: Schema.String,
	scenarioId: Schema.String,
}) {}

export class DiagramGenerationRequest extends Schema.Class<DiagramGenerationRequest>(
	"DiagramGenerationRequest",
)({
	cacheMode: Schema.optional(DiagramGenerationCacheModeSchema),
	maxOutputTokens: Schema.optional(Schema.Number),
	model: Schema.String.check(
		Schema.isPattern(/^(?:(?:google|google-ai-studio)\/)?[A-Za-z0-9._-]{1,128}$/),
	),
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

function withSketchiDiagramStyle(input: unknown): unknown {
	return isUnknownRecord(input) ? { ...input, style: { ...SKETCHI_DIAGRAM_STYLE } } : input;
}

/**
 * Lowercase model-authored icon slugs and drop any that are not catalog-shaped,
 * so a stray icon never fails the whole candidate.
 */
function sanitizeGeneratedNodeIcons(
	nodes: unknown,
	diagnostics: string[],
	noun: "node" | "participant" = "node",
): unknown {
	if (!Array.isArray(nodes)) return nodes;
	return nodes.map((node) => {
		if (!isUnknownRecord(node) || node["icon"] === undefined) return node;
		const { icon, ...withoutIcon } = node;
		const raw = objectValue(icon, "slug");
		const slug = typeof raw === "string" ? raw.trim().toLowerCase() : "";
		if (isDiagramIconSlug(slug)) return { ...withoutIcon, icon: { slug } };
		diagnostics.push(
			`icon_dropped: ${noun} "${String(node["id"])}" icon ${JSON.stringify(raw ?? icon)} is not a catalog slug; the ${noun} renders without a logo.`,
		);
		return withoutIcon;
	});
}

/** Models name shapes such as "ellipse" that a node's kind already decides; it draws by kind. */
function withKnownShape(node: unknown, diagnostics: string[]): unknown {
	if (!isUnknownRecord(node) || node["shape"] === undefined) return node;
	if (Schema.is(DiagramNodeShapeSchema)(node["shape"])) return node;
	const { shape, ...withoutShape } = node;
	diagnostics.push(
		`shape_dropped: node "${String(node["id"])}" shape ${JSON.stringify(shape)} is not a Sketchi shape; the node draws by its kind.`,
	);
	return withoutShape;
}

/** A process step with nothing after it is where its path ends. */
function withEndsWhereStepsStop(nodes: unknown, edges: readonly unknown[]): unknown {
	if (!Array.isArray(nodes)) return nodes;
	const sources = new Set(edges.map((edge) => objectValue(edge, "source")));
	return nodes.map((node) =>
		isUnknownRecord(node) && node["kind"] === "process" && !sources.has(node["id"])
			? { ...node, kind: "end" }
			: node,
	);
}

function normalizeGeneratedFlowchartInput(input: unknown, diagnostics: string[]): unknown {
	const styled = withSketchiDiagramStyle(input);
	if (!isUnknownRecord(styled)) return styled;
	const groups = styled["groups"];
	const nodes = sanitizeGeneratedNodeIcons(styled["nodes"], diagnostics);
	const withIcons: Record<string, unknown> = {
		...styled,
		nodes: Array.isArray(nodes) ? nodes.map((node) => withKnownShape(node, diagnostics)) : nodes,
		// A group's logo comes from the catalog at build time, never from the model.
		...(Array.isArray(groups)
			? {
					groups: groups.map((group) => {
						if (!isUnknownRecord(group)) return group;
						const { icon: _icon, ...withoutIcon } = group;
						return withoutIcon;
					}),
				}
			: {}),
	};
	const edges = withIcons["edges"];
	if (!Array.isArray(edges)) {
		return withIcons;
	}
	return {
		...withIcons,
		nodes: withEndsWhereStepsStop(withIcons["nodes"], edges),
		edges: edges.map((edge) =>
			isUnknownRecord(edge) &&
			typeof edge["label"] === "string" &&
			edge["label"].trim().length === 0
				? Object.fromEntries(Object.entries(edge).filter(([key]) => key !== "label"))
				: edge,
		),
	};
}

/** A leaf topic may omit its empty children, and a mindmap its only layout. */
function normalizeGeneratedMindmapTree(input: Record<string, unknown>): Record<string, unknown> {
	const topic = (value: unknown): unknown => {
		if (!isUnknownRecord(value)) return value;
		const children = value["children"];
		if (children === undefined) return { ...value, children: [] };
		// Anything else malformed reaches the schema, so its content can be repaired and not lost.
		return Array.isArray(children) ? { ...value, children: children.map(topic) } : value;
	};
	return {
		layout: { direction: "LR", edgeRouting: "curved" },
		...input,
		root: topic(input["root"]),
	};
}

function normalizeGeneratedSequenceInput(input: unknown, diagnostics: string[]): unknown {
	const styled = withSketchiDiagramStyle(input);
	if (!isUnknownRecord(styled)) return styled;
	return {
		...styled,
		participants: sanitizeGeneratedNodeIcons(styled["participants"], diagnostics, "participant"),
	};
}

/**
 * A final state with outgoing transitions both ends the machine and continues, so it
 * becomes a regular state with a transition to its own unnamed final state. Ids built
 * only from "end" and digits draw as an anonymous marker, not as a named state.
 */
function withEndsSplitFromFinalStates(input: unknown): unknown {
	if (!isUnknownRecord(input)) return input;
	const { states, transitions } = input;
	if (!Array.isArray(states) || !Array.isArray(transitions)) return input;
	const sources = new Set(transitions.map((transition) => objectValue(transition, "source")));
	const continuing = (state: unknown): state is Record<string, unknown> =>
		isUnknownRecord(state) && state["kind"] === "final" && sources.has(state["id"]);
	if (!states.some(continuing)) return input;
	const unused = (entries: readonly unknown[]) => {
		const used = new Set(entries.map((entry) => objectValue(entry, "id")));
		return (base: string) => {
			let id = base;
			for (let suffix = 2; used.has(id); suffix += 1) id = `${base}-${suffix}`;
			used.add(id);
			return id;
		};
	};
	const stateId = unused(states);
	const transitionId = unused(transitions);
	const added: unknown[] = [];
	const split = states.flatMap((state) => {
		if (!continuing(state)) return [state];
		const { kind: _kind, ...regular } = state;
		const end = stateId("end");
		added.push({
			id: transitionId(`${String(state["id"])}-ends`),
			source: state["id"],
			target: end,
		});
		return [
			regular,
			{
				id: end,
				kind: "final",
				...(state["parent"] === undefined ? {} : { parent: state["parent"] }),
			},
		];
	});
	return { ...input, states: split, transitions: [...transitions, ...added] };
}

/**
 * Number transitions the model left without ids, by source and target, and
 * drop empty event, guard and action strings, which mean "none".
 */
function normalizeGeneratedStateMachineInput(input: unknown): unknown {
	const styled = withEndsSplitFromFinalStates(withSketchiDiagramStyle(input));
	if (!isUnknownRecord(styled) || !Array.isArray(styled["transitions"])) return styled;
	const used = new Set(
		styled["transitions"].flatMap((transition) =>
			isUnknownRecord(transition) && typeof transition["id"] === "string" ? [transition["id"]] : [],
		),
	);
	return {
		...styled,
		transitions: styled["transitions"].map((transition) => {
			if (!isUnknownRecord(transition)) return transition;
			const cleaned = Object.fromEntries(
				Object.entries(transition).filter(
					([key, value]) =>
						!(
							["event", "guard", "action"].includes(key) &&
							typeof value === "string" &&
							!value.trim()
						),
				),
			);
			if (typeof cleaned["id"] === "string" && cleaned["id"].length > 0) return cleaned;
			const base = `${String(cleaned["source"])}-${String(cleaned["target"])}`;
			let id = base;
			for (let suffix = 2; used.has(id); suffix += 1) id = `${base}-${suffix}`;
			used.add(id);
			return { ...cleaned, id };
		}),
	};
}

/**
 * Read one-line fields and cardinality aliases, and number relationships the
 * model left without ids, by their two ends.
 */
function normalizeGeneratedErInput(input: unknown): unknown {
	const resolved = resolveErShorthand(withSketchiDiagramStyle(input));
	if (!isUnknownRecord(resolved) || !Array.isArray(resolved["relationships"])) return resolved;
	const used = new Set(
		resolved["relationships"].flatMap((relationship) =>
			isUnknownRecord(relationship) && typeof relationship["id"] === "string"
				? [relationship["id"]]
				: [],
		),
	);
	return {
		...resolved,
		relationships: resolved["relationships"].map((relationship) => {
			if (!isUnknownRecord(relationship)) return relationship;
			if (typeof relationship["id"] === "string" && relationship["id"].length > 0)
				return relationship;
			const base = `${String(relationship["from"])}-${String(relationship["to"])}`.replace(
				/[^\w-]+/gu,
				"-",
			);
			let id = base;
			for (let suffix = 2; used.has(id); suffix += 1) id = `${base}-${suffix}`;
			used.add(id);
			return { ...relationship, id };
		}),
	};
}

/**
 * Read one-line members, kind and multiplicity aliases, and number
 * relationships the model left without ids, by their kind and two ends.
 */
function normalizeGeneratedClassInput(input: unknown): unknown {
	const resolved = resolveClassShorthand(withSketchiDiagramStyle(input));
	if (!isUnknownRecord(resolved) || !Array.isArray(resolved["relationships"])) return resolved;
	const used = new Set(
		resolved["relationships"].flatMap((relationship) =>
			isUnknownRecord(relationship) && typeof relationship["id"] === "string"
				? [relationship["id"]]
				: [],
		),
	);
	return {
		...resolved,
		relationships: resolved["relationships"].map((relationship) => {
			if (!isUnknownRecord(relationship)) return relationship;
			if (typeof relationship["id"] === "string" && relationship["id"].length > 0)
				return relationship;
			const base =
				`${String(relationship["from"])}-${String(relationship["kind"])}-${String(relationship["to"])}`.replace(
					/[^\w-]+/gu,
					"-",
				);
			let id = base;
			for (let suffix = 2; used.has(id); suffix += 1) id = `${base}-${suffix}`;
			used.add(id);
			return { ...relationship, id };
		}),
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
	const firstErrorMessage = Array.isArray(errors) ? objectValue(errors[0], "message") : undefined;
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

interface CandidateParseFailure {
	readonly diagnostics: readonly string[];
	readonly error: string;
	readonly success: false;
}

interface CandidateParseSuccess {
	readonly warnings?: StateMachineDefaultWarning[];
	/** Non-fatal repairs applied while decoding. */
	readonly diagnostics?: readonly string[];
	readonly diagram: CanonicalDiagram;
	readonly success: true;
}

type CandidateParseResult = CandidateParseFailure | CandidateParseSuccess;

const schemaIssueFormatter = SchemaIssue.makeFormatterStandardSchemaV1();

function schemaIssueDiagnostic(issue: {
	readonly message: string;
	readonly path?: readonly (PropertyKey | { readonly key: PropertyKey })[] | undefined;
}): string {
	const segments = (issue.path ?? []).map((segment) =>
		typeof segment === "object" ? segment.key : segment,
	);
	const path = segments.length > 0 ? segments.map(String).join(".") : "diagram";
	return `schema_error at ${path}: ${issue.message}`;
}

function diagramValidationFailure(error: unknown): CandidateParseFailure {
	if (
		error instanceof FlowchartValidationError ||
		error instanceof SequenceValidationError ||
		error instanceof TimelineValidationError ||
		error instanceof ChartValidationError ||
		error instanceof StateMachineValidationError ||
		error instanceof GanttValidationError ||
		error instanceof ErValidationError ||
		error instanceof ClassValidationError ||
		error instanceof OrgChartValidationError ||
		error instanceof VennValidationError ||
		error instanceof JourneyValidationError ||
		error instanceof SankeyValidationError ||
		error instanceof WireframeValidationError ||
		error instanceof QuadrantValidationError
	) {
		const family =
			error instanceof FlowchartValidationError
				? "flowchart"
				: error instanceof TimelineValidationError
					? "timeline"
					: error instanceof ChartValidationError
						? "chart"
						: error instanceof StateMachineValidationError
							? "state-machine"
							: error instanceof GanttValidationError
								? "gantt"
								: error instanceof ErValidationError
									? "er"
									: error instanceof ClassValidationError
										? "class"
										: error instanceof OrgChartValidationError
											? "org-chart"
											: error instanceof VennValidationError
												? "venn"
												: error instanceof JourneyValidationError
													? "journey"
													: error instanceof SankeyValidationError
														? "sankey"
														: error instanceof WireframeValidationError
															? "wireframe"
															: error instanceof QuadrantValidationError
																? "quadrant"
																: "sequence";
		return {
			diagnostics: error.issues.map(
				(entry) => `${family}.${entry.code}: ${entry.message} Hint: ${entry.hint}`,
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
		const message = error instanceof Error ? error.message : "Generated diagram parse failed.";
		return {
			diagnostics: [`json_parse_error: ${message}`],
			error: message,
			success: false,
		};
	}

	const response = Schema.decodeUnknownResult(GeneratedDiagramResponse)(extracted);
	if (Result.isFailure(response)) {
		const diagnostics = [`response_schema_error: ${String(response.failure)}`];
		return {
			diagnostics,
			error: diagnostics[0] ?? "Generated response schema validation failed.",
			success: false,
		};
	}

	const { diagram: rawDiagram, title } = response.success;
	if (!isUnknownRecord(rawDiagram)) {
		return {
			diagnostics: ["diagram_missing: the response must include one diagram object."],
			error: "Generated response omitted its diagram.",
			success: false,
		};
	}
	const type = rawDiagram["type"];
	if (!Schema.is(DiagramGenerationTypeSchema)(type)) {
		return {
			diagnostics: [
				`diagram_type_invalid: diagram.type ${JSON.stringify(type)} is not a Sketchi diagram type.`,
			],
			error: "Generated diagram has no supported type.",
			success: false,
		};
	}

	const id = typeof rawDiagram["id"] === "string" ? rawDiagram["id"] : "";
	const titledDiagram = {
		...rawDiagram,
		title: modelTitleOrFallback(title, id, type),
	};

	const repairs: string[] = [];
	const warnings: StateMachineDefaultWarning[] = [];
	const parsers = {
		chart: () =>
			decodeAndValidate(
				ChartDiagramSchema,
				withSketchiDiagramStyle(titledDiagram),
				validateChartDiagram,
			),
		timeline: () =>
			decodeAndValidate(
				TimelineDiagramSchema,
				withSketchiDiagramStyle(titledDiagram),
				validateTimelineDiagram,
			),
		flowchart: () => {
			const result = decodeAndValidate(
				FlowchartDiagramSchema,
				normalizeGeneratedFlowchartInput(titledDiagram, repairs),
				validateFlowchartDiagram,
			);
			return result.success && repairs.length > 0 ? { ...result, diagnostics: repairs } : result;
		},
		mindmap: () =>
			"root" in titledDiagram
				? decodeAndValidate(
						GeneratedMindmapTree,
						normalizeGeneratedMindmapTree(titledDiagram),
						generatedMindmapTreeToDiagram,
						"Generated mindmap schema validation failed.",
					)
				: decodeAndValidate(
						MindmapDiagramSchema,
						withSketchiDiagramStyle(titledDiagram),
						validateMindmapDiagram,
					),
		gantt: () =>
			decodeAndValidate(
				GanttDiagramSchema,
				withSketchiDiagramStyle(titledDiagram),
				validateGanttDiagram,
			),
		"state-machine": () => {
			const result = decodeAndValidate(
				StateMachineDiagramSchema,
				normalizeGeneratedStateMachineInput(titledDiagram),
				(diagram) => {
					warnings.push(...getStateMachineDefaultWarnings(diagram));
					return validateStateMachineDiagram(diagram);
				},
			);
			return result.success && warnings.length > 0 ? { ...result, warnings } : result;
		},
		er: () =>
			decodeAndValidate(
				ErDiagramSchema,
				normalizeGeneratedErInput(titledDiagram),
				validateErDiagram,
			),
		class: () =>
			decodeAndValidate(
				ClassDiagramSchema,
				normalizeGeneratedClassInput(titledDiagram),
				validateClassDiagram,
			),
		sankey: () =>
			decodeAndValidate(
				SankeyDiagramSchema,
				resolveSankeyShorthand(withSketchiDiagramStyle(titledDiagram)),
				validateSankeyDiagram,
			),
		"org-chart": () =>
			decodeAndValidate(
				OrgChartDiagramSchema,
				resolveOrgChartShorthand(withSketchiDiagramStyle(titledDiagram)),
				validateOrgChartDiagram,
			),
		venn: () =>
			decodeAndValidate(
				VennDiagramSchema,
				resolveVennShorthand(withSketchiDiagramStyle(titledDiagram)),
				validateVennDiagram,
			),
		journey: () =>
			decodeAndValidate(
				JourneyDiagramSchema,
				resolveJourneyShorthand(withSketchiDiagramStyle(titledDiagram)),
				validateJourneyDiagram,
			),
		wireframe: () =>
			decodeAndValidate(
				WireframeDiagramSchema,
				resolveWireframeShorthand(withSketchiDiagramStyle(titledDiagram)),
				validateWireframeDiagram,
			),
		quadrant: () =>
			decodeAndValidate(
				QuadrantDiagramSchema,
				withSketchiDiagramStyle(titledDiagram),
				validateQuadrantDiagram,
			),
		sequence: () => {
			const result = decodeAndValidate(
				SequenceDiagramSchema,
				normalizeGeneratedSequenceInput(titledDiagram, repairs),
				validateSequenceDiagram,
			);
			return result.success && repairs.length > 0 ? { ...result, diagnostics: repairs } : result;
		},
	};
	return parsers[type]();
}

function decodeAndValidate<S extends Schema.ConstraintDecoder<unknown>>(
	schema: S,
	input: unknown,
	validate: (decoded: S["Type"]) => NonNullable<CandidateParseSuccess["diagram"]>,
	schemaFailureMessage = "Generated diagram schema validation failed.",
): CandidateParseResult {
	const decoded = Schema.decodeUnknownResult(schema, { errors: "all" })(input);
	if (Result.isFailure(decoded)) {
		const diagnostics = schemaIssueFormatter(decoded.failure.issue).issues.map(
			schemaIssueDiagnostic,
		);
		return {
			diagnostics,
			error: diagnostics[0] ?? schemaFailureMessage,
			success: false,
		};
	}
	try {
		return { diagram: validate(decoded.success), success: true };
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
		diagnostics.push(...(parsed.diagnostics ?? []));
		return {
			...input,
			diagnostics,
			...(parsed.warnings?.length ? { warnings: parsed.warnings } : {}),
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

/**
 * Place logos the prompt offered on the flowchart nodes or sequence
 * participants that name them and drop the rest, so a generated diagram never
 * brands an element with a technology the user did not name, nor shifts a
 * logo onto the wrong one.
 */
function groundDiagramIcons(
	diagram: CanonicalDiagram,
	request: DiagramGenerationRequest,
): { readonly diagnostics: string[]; readonly diagram: CanonicalDiagram } {
	const logos = request.prompt.logos ?? [];
	if (diagram.type === "flowchart") {
		const encoded = Schema.encodeSync(FlowchartDiagramSchema)(diagram);
		const placement = placeNodeLogos(encoded.nodes, logos);
		return placement.diagnostics.length === 0
			? { diagnostics: [], diagram }
			: {
					diagnostics: placement.diagnostics,
					diagram: Schema.decodeUnknownSync(FlowchartDiagramSchema)({
						...encoded,
						nodes: placement.nodes,
					}),
				};
	}
	if (diagram.type === "sequence") {
		const encoded = Schema.encodeSync(SequenceDiagramSchema)(diagram);
		const placement = placeNodeLogos(encoded.participants, logos, "participant");
		return placement.diagnostics.length === 0
			? { diagnostics: [], diagram }
			: {
					diagnostics: placement.diagnostics,
					diagram: Schema.decodeUnknownSync(SequenceDiagramSchema)({
						...encoded,
						participants: placement.nodes,
					}),
				};
	}
	return { diagnostics: [], diagram };
}

export const WRONG_DIAGRAM_TYPE_ERROR = "Generated diagram is not the requested type.";

/** Hold the answer to the caller's explicit type, and ground its logos in the prompt. */
export function enforceCandidateRequestRequirements(
	input: DiagramGenerationCandidate,
	request: DiagramGenerationRequest,
): DiagramGenerationCandidate {
	if (!input.diagram || input.error) return input;
	const { requestedType } = request.prompt;
	if (requestedType && input.diagram.type !== requestedType) {
		const { diagram, ...withoutDiagram } = input;
		return {
			...withoutDiagram,
			diagnostics: [
				...input.diagnostics,
				`explicit_type_not_met: the caller required ${requestedType}, but the response returned ${diagram.type}.`,
			],
			error: WRONG_DIAGRAM_TYPE_ERROR,
		};
	}
	const grounding = groundDiagramIcons(input.diagram, request);
	return grounding.diagnostics.length > 0
		? {
				...input,
				diagram: grounding.diagram,
				diagnostics: [...input.diagnostics, ...grounding.diagnostics],
			}
		: input;
}

export function summarizeGenerationCandidate(
	candidate: DiagramGenerationCandidate,
): DiagramGenerationCandidateSummary {
	return {
		diagnostics: candidate.diagnostics,
		...(candidate.warnings?.length ? { warnings: candidate.warnings } : {}),
		...(candidate.diagram ? { diagramText: JSON.stringify(candidate.diagram, null, 2) } : {}),
		diagramValid: Boolean(candidate.diagram) && !candidate.error,
		model: candidate.model,
		provider: candidate.provider,
		text: candidate.text,
		...(candidate.cacheMode ? { cacheMode: candidate.cacheMode } : {}),
		...(candidate.durationMs !== undefined ? { durationMs: candidate.durationMs } : {}),
		...(candidate.error ? { error: candidate.error } : {}),
		...(candidate.usage ? { usage: candidate.usage } : {}),
	};
}
