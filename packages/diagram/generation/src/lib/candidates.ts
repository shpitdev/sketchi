import {
	type CanonicalDiagram,
	CanonicalDiagramSchema,
	DIAGRAM_TYPES,
	DiagramValidationError,
	ClassDiagramSchema,
	classNodeName,
	ClassValidationError,
	ErDiagramSchema,
	erEntityName,
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
	wireframeComponents,
	wireframeComponentWords,
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
	stateTransitionLabel,
	stateLabel,
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
	type DiagramRequirement,
	GeneratedDiagramIntent,
	GeneratedDiagramResponse,
	modelTitleOrFallback,
} from "./intent.js";
import { placeNodeLogos } from "./logo-placement.js";
import { isUnknownRecord, objectValue } from "./unknown-record.js";
import { DiagramGenerationPrompt } from "./messages.js";
import { GeneratedMindmapTree, generatedMindmapTreeToDiagram } from "./mindmap-tree.js";

export const diagramGenerationProviderIds: readonly [
	"fixture",
	"cloudflare-google-ai-studio",
	"google-ai-studio",
] = ["fixture", "cloudflare-google-ai-studio", "google-ai-studio"];

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
	intent: Schema.optional(GeneratedDiagramIntent),
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
	intent: Schema.optional(GeneratedDiagramIntent),
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

function normalizeGeneratedFlowchartInput(input: unknown, diagnostics: string[]): unknown {
	const styled = withSketchiDiagramStyle(input);
	if (!isUnknownRecord(styled)) return styled;
	const groups = styled["groups"];
	const withIcons: Record<string, unknown> = {
		...styled,
		nodes: sanitizeGeneratedNodeIcons(styled["nodes"], diagnostics),
		// Group logos are filled by Code Mode builds only; generation draws none.
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
		edges: edges.map((edge) =>
			isUnknownRecord(edge) &&
			typeof edge["label"] === "string" &&
			edge["label"].trim().length === 0
				? Object.fromEntries(Object.entries(edge).filter(([key]) => key !== "label"))
				: edge,
		),
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
 * Number transitions the model left without ids, by source and target, and
 * drop empty event, guard and action strings, which mean "none".
 */
function normalizeGeneratedStateMachineInput(input: unknown): unknown {
	const styled = withSketchiDiagramStyle(input);
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
	readonly diagram?: CanonicalDiagram;
	readonly intent: GeneratedDiagramIntent;
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

/** Decode only the typed intent envelope when artifact validation has failed. */
export function decodedIntentFromText(text: string): GeneratedDiagramIntent | undefined {
	try {
		const response = Schema.decodeUnknownResult(GeneratedDiagramResponse)(extractJsonObject(text));
		return Result.isSuccess(response) ? response.success.intent : undefined;
	} catch {
		return undefined;
	}
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

	const { diagram: rawDiagram, intent, title } = response.success;
	if (intent.nativeKind === null) {
		if (rawDiagram !== undefined) {
			return {
				diagnostics: [
					"intent_diagram_mismatch: nativeKind is null, but the response included a diagram. Hint: omit diagram for unsupported requests.",
				],
				error: "Generated intent and diagram did not agree.",
				success: false,
			};
		}
		return { intent, success: true };
	}
	if (!isUnknownRecord(rawDiagram)) {
		return {
			diagnostics: ["intent_diagram_missing: a native diagram kind requires one diagram object."],
			error: "Generated response omitted its native diagram.",
			success: false,
		};
	}
	if (rawDiagram["type"] !== intent.nativeKind) {
		return {
			diagnostics: [
				`intent_diagram_mismatch: nativeKind is ${intent.nativeKind}, but diagram.type is ${String(rawDiagram["type"])}.`,
			],
			error: "Generated intent and diagram did not agree.",
			success: false,
		};
	}

	const id = typeof rawDiagram["id"] === "string" ? rawDiagram["id"] : "";
	const titledDiagram = {
		...rawDiagram,
		title: modelTitleOrFallback(title, id, intent.nativeKind),
	};

	const repairs: string[] = [];
	const warnings: StateMachineDefaultWarning[] = [];
	const parsers = {
		chart: () =>
			decodeAndValidate(
				ChartDiagramSchema,
				withSketchiDiagramStyle(titledDiagram),
				validateChartDiagram,
				intent,
			),
		timeline: () =>
			decodeAndValidate(
				TimelineDiagramSchema,
				withSketchiDiagramStyle(titledDiagram),
				validateTimelineDiagram,
				intent,
			),
		flowchart: () => {
			const result = decodeAndValidate(
				FlowchartDiagramSchema,
				normalizeGeneratedFlowchartInput(titledDiagram, repairs),
				validateFlowchartDiagram,
				intent,
			);
			return result.success && repairs.length > 0 ? { ...result, diagnostics: repairs } : result;
		},
		mindmap: () =>
			"root" in titledDiagram
				? decodeAndValidate(
						GeneratedMindmapTree,
						titledDiagram,
						generatedMindmapTreeToDiagram,
						intent,
						"Generated mindmap schema validation failed.",
					)
				: decodeAndValidate(
						MindmapDiagramSchema,
						withSketchiDiagramStyle(titledDiagram),
						validateMindmapDiagram,
						intent,
					),
		gantt: () =>
			decodeAndValidate(
				GanttDiagramSchema,
				withSketchiDiagramStyle(titledDiagram),
				validateGanttDiagram,
				intent,
			),
		"state-machine": () => {
			const result = decodeAndValidate(
				StateMachineDiagramSchema,
				normalizeGeneratedStateMachineInput(titledDiagram),
				(diagram) => {
					warnings.push(...getStateMachineDefaultWarnings(diagram));
					return validateStateMachineDiagram(diagram);
				},
				intent,
			);
			return result.success && warnings.length > 0 ? { ...result, warnings } : result;
		},
		er: () =>
			decodeAndValidate(
				ErDiagramSchema,
				normalizeGeneratedErInput(titledDiagram),
				validateErDiagram,
				intent,
			),
		class: () =>
			decodeAndValidate(
				ClassDiagramSchema,
				normalizeGeneratedClassInput(titledDiagram),
				validateClassDiagram,
				intent,
			),
		sankey: () =>
			decodeAndValidate(
				SankeyDiagramSchema,
				resolveSankeyShorthand(withSketchiDiagramStyle(titledDiagram)),
				validateSankeyDiagram,
				intent,
			),
		"org-chart": () =>
			decodeAndValidate(
				OrgChartDiagramSchema,
				resolveOrgChartShorthand(withSketchiDiagramStyle(titledDiagram)),
				validateOrgChartDiagram,
				intent,
			),
		venn: () =>
			decodeAndValidate(
				VennDiagramSchema,
				resolveVennShorthand(withSketchiDiagramStyle(titledDiagram)),
				validateVennDiagram,
				intent,
			),
		journey: () =>
			decodeAndValidate(
				JourneyDiagramSchema,
				resolveJourneyShorthand(withSketchiDiagramStyle(titledDiagram)),
				validateJourneyDiagram,
				intent,
			),
		wireframe: () =>
			decodeAndValidate(
				WireframeDiagramSchema,
				resolveWireframeShorthand(withSketchiDiagramStyle(titledDiagram)),
				validateWireframeDiagram,
				intent,
			),
		quadrant: () =>
			decodeAndValidate(
				QuadrantDiagramSchema,
				withSketchiDiagramStyle(titledDiagram),
				validateQuadrantDiagram,
				intent,
			),
		sequence: () => {
			const result = decodeAndValidate(
				SequenceDiagramSchema,
				normalizeGeneratedSequenceInput(titledDiagram, repairs),
				validateSequenceDiagram,
				intent,
			);
			return result.success && repairs.length > 0 ? { ...result, diagnostics: repairs } : result;
		},
	};
	return parsers[intent.nativeKind]();
}

function decodeAndValidate<S extends Schema.ConstraintDecoder<unknown>>(
	schema: S,
	input: unknown,
	validate: (decoded: S["Type"]) => NonNullable<CandidateParseSuccess["diagram"]>,
	intent: GeneratedDiagramIntent,
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
		return { diagram: validate(decoded.success), intent, success: true };
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
			...(parsed.diagram ? { diagram: parsed.diagram } : {}),
			intent: parsed.intent,
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
 * Independent loops in a graph: per strongly connected component, its internal
 * edges minus its nodes plus one. A self-loop is a loop of its own.
 */
function cycleRank(diagram: {
	readonly edges: readonly { readonly source: string; readonly target: string }[];
	readonly nodes: readonly { readonly id: string }[];
}): number {
	const adjacency = new Map<string, string[]>();
	for (const node of diagram.nodes) adjacency.set(node.id, []);
	for (const edge of diagram.edges) adjacency.get(edge.source)?.push(edge.target);

	let nextIndex = 0;
	const indexes = new Map<string, number>();
	const lowLinks = new Map<string, number>();
	const stack: string[] = [];
	const onStack = new Set<string>();
	let rank = 0;

	const visit = (nodeId: string): void => {
		indexes.set(nodeId, nextIndex);
		lowLinks.set(nodeId, nextIndex);
		nextIndex += 1;
		stack.push(nodeId);
		onStack.add(nodeId);

		for (const target of adjacency.get(nodeId) ?? []) {
			if (!indexes.has(target)) {
				visit(target);
				lowLinks.set(nodeId, Math.min(lowLinks.get(nodeId) ?? 0, lowLinks.get(target) ?? 0));
			} else if (onStack.has(target)) {
				lowLinks.set(nodeId, Math.min(lowLinks.get(nodeId) ?? 0, indexes.get(target) ?? 0));
			}
		}

		if (lowLinks.get(nodeId) !== indexes.get(nodeId)) return;
		const component = new Set<string>();
		for (;;) {
			const member = stack.pop();
			if (!member) break;
			onStack.delete(member);
			component.add(member);
			if (member === nodeId) break;
		}
		const internalEdges = diagram.edges.filter(
			(edge) => component.has(edge.source) && component.has(edge.target),
		).length;
		if (internalEdges > 0) {
			rank += Math.max(0, internalEdges - component.size + 1);
		}
	};

	for (const node of diagram.nodes) {
		if (!indexes.has(node.id)) visit(node.id);
	}
	return rank;
}

function labelsForRequirement(
	diagram: NonNullable<DiagramGenerationCandidate["diagram"]>,
	requirement: Extract<DiagramRequirement, { readonly kind: "label" }>,
): readonly string[] | undefined {
	if (diagram.type === "flowchart") {
		if (requirement.target === "node") {
			return diagram.nodes.map((node) => node.label);
		}
		if (requirement.target === "branch") {
			return diagram.edges.flatMap((edge) => (edge.label === undefined ? [] : [edge.label]));
		}
		return undefined;
	}
	if (diagram.type === "mindmap") {
		return requirement.target === "topic" ? diagram.nodes.map((node) => node.label) : undefined;
	}
	if (diagram.type === "timeline")
		return requirement.target === "event" ? diagram.events.map((event) => event.label) : undefined;
	if (diagram.type === "chart")
		return requirement.target === "category"
			? diagram.categories
			: requirement.target === "series"
				? diagram.series.flatMap((series) => (series.name === undefined ? [] : [series.name]))
				: undefined;
	if (diagram.type === "gantt")
		return requirement.target === "task"
			? diagram.tasks.map((task) => task.label)
			: requirement.target === "phase"
				? diagram.tasks.flatMap((task) => (task.phase === undefined ? [] : [task.phase]))
				: undefined;
	if (diagram.type === "state-machine") {
		if (requirement.target === "state")
			return diagram.states.flatMap((state) => {
				const label = stateLabel(state);
				return label === undefined ? [] : [label];
			});
		// A transition is named by its event or by its whole label.
		if (requirement.target === "transition")
			return diagram.transitions.flatMap((transition) => [
				...(transition.event ? [transition.event] : []),
				stateTransitionLabel(transition),
			]);
		return undefined;
	}
	if (diagram.type === "class") {
		if (requirement.target === "class") return diagram.classes.map(classNodeName);
		if (requirement.target === "member")
			return diagram.classes.flatMap((node) => [
				...node.attributes.map((attribute) => attribute.name),
				...node.methods.map((method) => method.name),
			]);
		return undefined;
	}
	if (diagram.type === "sankey")
		return requirement.target === "node" ? diagram.nodes.map((node) => node.label) : undefined;
	if (diagram.type === "org-chart")
		return requirement.target === "person"
			? diagram.people.map((person) => person.name)
			: undefined;
	if (diagram.type === "venn")
		return requirement.target === "set"
			? diagram.sets.map((set) => set.label)
			: requirement.target === "item"
				? diagram.regions.flatMap((region) => region.items ?? [])
				: undefined;
	// A journey's stages read as phases and its steps as tasks, as Mermaid's sections and tasks.
	if (diagram.type === "journey")
		return requirement.target === "task"
			? diagram.stages.flatMap((stage) => stage.steps.map((step) => step.label))
			: requirement.target === "phase"
				? diagram.stages.map((stage) => stage.name)
				: undefined;
	if (diagram.type === "wireframe")
		return requirement.target === "screen"
			? diagram.screens.map((screen) => screen.name)
			: requirement.target === "component"
				? [...wireframeComponents(diagram)].flatMap(({ component }) =>
						wireframeComponentWords(component),
					)
				: undefined;
	if (diagram.type === "quadrant")
		return requirement.target === "point"
			? diagram.points.map((point) => point.label)
			: requirement.target === "quadrant"
				? Object.values(diagram.quadrants)
				: undefined;
	if (diagram.type === "er") {
		if (requirement.target === "entity") return diagram.entities.map(erEntityName);
		if (requirement.target === "field")
			return diagram.entities.flatMap((entity) => entity.fields.map((field) => field.name));
		return undefined;
	}
	if (requirement.target === "participant") {
		return diagram.participants.map((participant) => participant.label);
	}
	if (requirement.target === "message") {
		return diagram.messages.map((message) => message.label);
	}
	return undefined;
}

function countForRequirement(
	diagram: NonNullable<DiagramGenerationCandidate["diagram"]>,
	target: Extract<DiagramRequirement, { readonly kind: "count" }>["target"],
): number | undefined {
	if (diagram.type === "flowchart") {
		switch (target) {
			case "nodes":
				return diagram.nodes.length;
			case "decision_nodes":
				return diagram.nodes.filter((node) => node.kind === "decision").length;
			case "terminal_nodes":
				return diagram.nodes.filter((node) => node.kind === "end").length;
			case "cycles":
				return cycleRank(diagram);
			default:
				return undefined;
		}
	}
	if (diagram.type === "mindmap") {
		return target === "topics" ? diagram.nodes.length : undefined;
	}
	if (diagram.type === "timeline") return target === "events" ? diagram.events.length : undefined;
	if (diagram.type === "chart")
		return target === "categories" ? diagram.categories.length : undefined;
	if (diagram.type === "gantt") return target === "tasks" ? diagram.tasks.length : undefined;
	if (diagram.type === "state-machine")
		return target === "states"
			? diagram.states.length
			: target === "transitions"
				? diagram.transitions.length
				: target === "cycles"
					? cycleRank({ nodes: diagram.states, edges: diagram.transitions })
					: undefined;
	if (diagram.type === "class")
		return target === "classes"
			? diagram.classes.length
			: target === "relationships"
				? diagram.relationships.length
				: undefined;
	if (diagram.type === "org-chart") return target === "people" ? diagram.people.length : undefined;
	if (diagram.type === "venn")
		return target === "sets"
			? diagram.sets.length
			: target === "items"
				? diagram.regions.reduce((sum, region) => sum + (region.items?.length ?? 0), 0)
				: undefined;
	if (diagram.type === "journey")
		return target === "tasks"
			? diagram.stages.reduce((total, stage) => total + stage.steps.length, 0)
			: undefined;
	if (diagram.type === "sankey")
		return target === "nodes"
			? diagram.nodes.length
			: target === "links"
				? diagram.links.length
				: undefined;
	if (diagram.type === "wireframe")
		return target === "screens" ? diagram.screens.length : undefined;
	if (diagram.type === "quadrant") return target === "points" ? diagram.points.length : undefined;
	if (diagram.type === "er")
		return target === "entities"
			? diagram.entities.length
			: target === "relationships"
				? diagram.relationships.length
				: undefined;
	if (target === "participants") return diagram.participants.length;
	return target === "messages" ? diagram.messages.length : undefined;
}

function normalizeLabel(value: string): string {
	return value.replace(/\s+/gu, " ").trim().toLocaleLowerCase("en-US");
}

function requirementDiagnostic(
	diagram: NonNullable<DiagramGenerationCandidate["diagram"]>,
	requirement: DiagramRequirement,
): string | undefined {
	if (requirement.kind === "label") {
		const labels = labelsForRequirement(diagram, requirement);
		if (!labels) {
			return `requirement_target_invalid: ${requirement.target} labels do not apply to ${diagram.type}.`;
		}
		const expected = normalizeLabel(requirement.value);
		if (labels.some((label) => normalizeLabel(label) === expected)) {
			return undefined;
		}
		return `requirement_label_not_met: required ${requirement.target} label "${requirement.value}" was not present.`;
	}

	const actual =
		requirement.kind === "depth"
			? diagram.type === "mindmap"
				? Math.max(...diagram.nodes.map((node) => node.metadata.depth)) + 1
				: undefined
			: countForRequirement(diagram, requirement.target);
	if (actual === undefined) {
		return `requirement_target_invalid: ${requirement.target} does not apply to ${diagram.type}.`;
	}
	const satisfied =
		requirement.comparator === "exact" ? actual === requirement.value : actual >= requirement.value;
	if (satisfied) return undefined;
	return `requirement_count_not_met: ${requirement.target} must be ${requirement.comparator === "exact" ? "exactly" : "at least"} ${requirement.value}, but the generated ${diagram.type} contained ${actual}.`;
}

function requirementsAreEqual(
	expected: readonly DiagramRequirement[],
	actual: readonly DiagramRequirement[],
): boolean {
	if (expected.length !== actual.length) return false;
	return expected.every((requirement, index) => {
		const candidate = actual[index];
		if (!candidate || candidate.kind !== requirement.kind) return false;
		if (requirement.kind === "label") {
			return (
				candidate.kind === "label" &&
				candidate.target === requirement.target &&
				candidate.value === requirement.value
			);
		}
		return (
			candidate.kind === requirement.kind &&
			candidate.comparator === requirement.comparator &&
			candidate.target === requirement.target &&
			candidate.value === requirement.value
		);
	});
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

/** Deterministically enforce the original model-authored plan against the artifact. */
export function enforceCandidateRequestRequirements(
	input: DiagramGenerationCandidate,
	request: DiagramGenerationRequest,
	originalRequirements?: readonly DiagramRequirement[],
): DiagramGenerationCandidate {
	if (!input.intent || input.error) return input;
	const grounding = input.diagram ? groundDiagramIcons(input.diagram, request) : undefined;
	const candidate =
		grounding && grounding.diagnostics.length > 0
			? {
					...input,
					diagram: grounding.diagram,
					diagnostics: [...input.diagnostics, ...grounding.diagnostics],
				}
			: input;
	const { diagram, intent } = candidate;
	if (!intent) return candidate;

	const requestDiagnostics: string[] = [];
	const requirements = originalRequirements ?? intent.requirements;
	if (originalRequirements && !requirementsAreEqual(originalRequirements, intent.requirements)) {
		requestDiagnostics.push(
			"intent_requirements_changed: semantic repair altered or omitted the original typed requirement plan.",
		);
	}
	const requestedKindIsNative = DIAGRAM_TYPES.some((type) => type === intent.requestedKind);
	if (
		request.prompt.requestedType &&
		(intent.requestedKind !== request.prompt.requestedType ||
			intent.nativeKind !== request.prompt.requestedType)
	) {
		requestDiagnostics.push(
			`explicit_type_not_met: the caller required ${request.prompt.requestedType}, but the response selected requestedKind ${intent.requestedKind} and nativeKind ${String(intent.nativeKind)}.`,
		);
	}
	if (
		(intent.nativeKind === null && requestedKindIsNative) ||
		(intent.nativeKind !== null && intent.requestedKind !== intent.nativeKind)
	) {
		requestDiagnostics.push(
			`intent_kind_mismatch: requestedKind ${intent.requestedKind} cannot be generated as nativeKind ${intent.nativeKind}.`,
		);
	}
	if (diagram) {
		requestDiagnostics.push(
			...requirements.flatMap((requirement) => {
				const diagnostic = requirementDiagnostic(diagram, requirement);
				return diagnostic ? [diagnostic] : [];
			}),
		);
	}
	if (requestDiagnostics.length === 0) return candidate;

	const { diagram: _diagram, ...withoutDiagram } = candidate;
	return {
		...withoutDiagram,
		diagnostics: [...candidate.diagnostics, ...requestDiagnostics],
		error: "Generated diagram did not satisfy its typed intent contract.",
	};
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
		...(candidate.intent ? { intent: candidate.intent } : {}),
		...(candidate.usage ? { usage: candidate.usage } : {}),
	};
}
