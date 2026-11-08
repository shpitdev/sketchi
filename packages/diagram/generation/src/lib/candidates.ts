import {
	type CanonicalDiagram,
	CanonicalDiagramSchema,
	DiagramNodeShapeSchema,
	DiagramZoneKindSchema,
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
	splitContinuingFinalStates,
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
	decodeFlowchartDocument,
	FLOWCHART_RULES,
	flowchartDiagramFromDocument,
	flowchartNodeDetails,
	resolveFlowchartReferences,
	FlowchartDocumentSchema,
	type FlowchartDocument,
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
import { withoutUnstatedGanttDependencies } from "./gantt-dependencies.js";
import { placeNodeLogos, type OfferedLogo } from "./logo-placement.js";
import { isUnknownRecord, objectValue } from "./unknown-record.js";
import { DiagramGenerationPrompt } from "./messages.js";
import { GeneratedMindmapTree, generatedMindmapTreeToDiagram } from "./mindmap-tree.js";
import { repeatedJsonKeys } from "./repeated-keys.js";
import { DiagramStyle, generatedStyles } from "./styling.js";

export const diagramGenerationProviderIds: readonly [
	"fixture",
	"cloudflare-anthropic",
	"cloudflare-google-ai-studio",
	"google-ai-studio",
] = ["fixture", "cloudflare-anthropic", "cloudflare-google-ai-studio", "google-ai-studio"];

export const DiagramGenerationProviderIdSchema = Schema.Literals(diagramGenerationProviderIds);
export type DiagramGenerationProviderId = typeof DiagramGenerationProviderIdSchema.Type;

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
	/** Model calls the request made, counting retries and repairs. */
	attempts: Schema.optional(Schema.Number),
	diagnostics: Schema.Array(Schema.String).pipe(Schema.mutable),
	warnings: Schema.optionalKey(Schema.Array(StateMachineDefaultWarningSchema).pipe(Schema.mutable)),
	diagram: Schema.optional(CanonicalDiagramSchema),
	/** A flowchart's document as the model wrote it, checked; `diagram` is what it draws. */
	flowchart: Schema.optional(FlowchartDocumentSchema),
	durationMs: Schema.optional(Schema.Number),
	error: Schema.optional(Schema.String),
	model: Schema.String,
	provider: DiagramGenerationProviderIdSchema,
	raw: Schema.optional(Schema.Unknown),
	/** Colors and shapes the request asked for, for the host to apply after the build. */
	styles: Schema.optional(Schema.Array(DiagramStyle).pipe(Schema.mutable)),
	text: Schema.String,
	usage: Schema.optional(DiagramGenerationUsage),
}) {}

export class DiagramGenerationCandidateSummary extends Schema.Class<DiagramGenerationCandidateSummary>(
	"DiagramGenerationCandidateSummary",
)({
	attempts: Schema.optional(Schema.Number),
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
	maxOutputTokens: Schema.optional(Schema.Number),
	model: Schema.String.check(
		Schema.isPattern(/^(?:(?:anthropic|google|google-ai-studio)\/)?[A-Za-z0-9._-]{1,128}$/),
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

/** Models name shapes such as "ellipse" that Sketchi doesn't draw; such a node draws plain. */
function withKnownShape(id: string, node: unknown, diagnostics: string[]): unknown {
	if (!isUnknownRecord(node) || node["shape"] === undefined) return node;
	if (node["shape"] === "diamond" || Schema.is(DiagramNodeShapeSchema)(node["shape"])) return node;
	const { shape, ...withoutShape } = node;
	diagnostics.push(
		`shape_dropped: node "${id}" shape ${JSON.stringify(shape)} is not a Sketchi shape; the node draws plain.`,
	);
	return withoutShape;
}

/** A generated team's stray kind is presentation metadata, not a reason to rebuild the graph. */
function withKnownGroupKind(id: string, group: unknown, diagnostics: string[]): unknown {
	if (
		!isUnknownRecord(group) ||
		group["kind"] === undefined ||
		Schema.is(DiagramZoneKindSchema)(group["kind"])
	)
		return group;
	const { kind, ...plain } = group;
	diagnostics.push(
		`group_kind_dropped: group "${id}" kind ${JSON.stringify(kind)} is not a zone kind; the group draws plain.`,
	);
	return plain;
}

/**
 * A generated flowchart document as a build reads it, or the problems that send it back for
 * repair: a node, group or lane key the response repeats (JSON keeps only the last), a schema
 * problem, or a graph the document can't draw. Unsupported shapes and group kinds draw plain, with a diagnostic note.
 */
function parseGeneratedFlowchart(
	input: Record<string, unknown>,
	repeated: readonly string[],
	diagnostics: string[],
): CandidateParseResult {
	const repeats = repeated.flatMap((path) => {
		const match = /^diagram\.(nodes|groups|lanes)\.([^.[\]]+)$/u.exec(path);
		return match?.[1] && match[2] !== undefined ? [{ kind: match[1], id: match[2] }] : [];
	});
	if (repeats.length > 0) {
		const noun = { nodes: "node", groups: "group", lanes: "lane" } as const;
		return {
			diagnostics: repeats.map(({ kind, id }) => {
				const name = noun[kind as keyof typeof noun];
				return `flowchart.duplicate_${name}_id: ${kind} repeats the id "${id}", and JSON keeps only the last one. Hint: Give each ${name} its own id.`;
			}),
			error: "Generated flowchart repeats an id.",
			success: false,
		};
	}
	const { type: _type, style: _style, ...fields } = input;
	const nodes = fields["nodes"];
	const groups = fields["groups"];
	const edges = fields["edges"];
	// A drawn graph's node and edge objects fail on every entry; one line says what to write.
	if (Array.isArray(nodes) || (Array.isArray(edges) && edges.some(isUnknownRecord))) {
		const diagnostic = `flowchart.invalid_type: nodes map each id to its label, and each edge is a list, not an object. Hint: ${FLOWCHART_RULES.documentShape}`;
		return { diagnostics: [diagnostic], error: diagnostic, success: false };
	}
	const decoded = decodeFlowchartDocument({
		...fields,
		...(isUnknownRecord(groups)
			? {
					groups: Object.fromEntries(
						Object.entries(groups).map(([id, group]) => [
							id,
							withKnownGroupKind(id, group, diagnostics),
						]),
					),
				}
			: {}),
		...(isUnknownRecord(nodes)
			? {
					nodes: Object.fromEntries(
						Object.entries(nodes).map(([id, node]) => [id, withKnownShape(id, node, diagnostics)]),
					),
				}
			: {}),
	});
	if (Result.isFailure(decoded)) {
		const schemaDiagnostics = schemaIssueFormatter(decoded.failure.issue).issues.map(
			schemaIssueDiagnostic,
		);
		return {
			diagnostics: schemaDiagnostics,
			error: schemaDiagnostics[0] ?? "Generated flowchart schema validation failed.",
			success: false,
		};
	}
	return drawnFlowchart(decoded.success, diagnostics);
}

/** The drawing a flowchart document builds as, each catalog-shaped icon its node's logo. */
function drawnFlowchart(
	input: FlowchartDocument,
	diagnostics: readonly string[] = [],
): CandidateParseResult {
	const { document, notes } = resolveFlowchartReferences(input);
	const buildNotes = [...diagnostics, ...notes.map((note) => `reference_resolved: ${note}`)];
	const nodeIcons = new Map(
		Object.entries(document.nodes).flatMap(([id, node]) => {
			const icon = flowchartNodeDetails(node).icon?.trim().toLowerCase();
			return icon && isDiagramIconSlug(icon) ? [[id, icon] as const] : [];
		}),
	);
	const built = flowchartDiagramFromDocument(document, { nodeIcons });
	if (!built.ok) {
		return {
			diagnostics: built.issues.map(
				(entry) => `flowchart.${entry.code}: ${entry.message} Hint: ${entry.hint}`,
			),
			error: built.issues[0]?.message ?? "Generated flowchart is not a valid graph.",
			success: false,
		};
	}
	return {
		diagram: built.diagram,
		flowchart: document,
		success: true,
		...(buildNotes.length > 0 ? { diagnostics: buildNotes } : {}),
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
 * Number transitions the model left without ids, by source and target, and
 * drop empty event, guard and action strings, which mean "none".
 */
function normalizeGeneratedStateMachineInput(input: unknown): unknown {
	const styled = splitContinuingFinalStates(withSketchiDiagramStyle(input));
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
	readonly styles?: DiagramStyle[];
	readonly warnings?: StateMachineDefaultWarning[];
	/** Non-fatal repairs applied while decoding. */
	readonly diagnostics?: readonly string[];
	readonly diagram: CanonicalDiagram;
	readonly flowchart?: FlowchartDocument;
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
			error instanceof TimelineValidationError
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

/** "API p50 latency, one week" as "api-p50-latency-one-week". */
function idFromTitle(title: string): string {
	return title
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[^a-z0-9]+/gu, "-")
		.replace(/^-+|-+$/gu, "")
		.slice(0, 60)
		.replace(/-+$/u, "");
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

	const { diagram: rawDiagram, styles: rawStyles, title } = response.success;
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
	const finalTitle = modelTitleOrFallback(title, id, type);
	const titledDiagram = {
		...rawDiagram,
		// A diagram the model left without an id takes one from its title; nothing else reads it.
		...(id.trim() ? {} : { id: idFromTitle(finalTitle) || type }),
		title: finalTitle,
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
		flowchart: () => parseGeneratedFlowchart(titledDiagram, repeatedJsonKeys(text), repairs),
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
	const parsed = parsers[type]();
	if (!parsed.success || rawStyles === undefined) return parsed;
	const styleDiagnostics: string[] = [];
	const styles = generatedStyles(rawStyles, styleDiagnostics);
	return {
		...parsed,
		...(styles.length > 0 ? { styles } : {}),
		...(styleDiagnostics.length > 0
			? { diagnostics: [...(parsed.diagnostics ?? []), ...styleDiagnostics] }
			: {}),
	};
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

/**
 * Arrows and comparison signs a model copies from a request ("dept → service"), in ASCII. The
 * CLI's export font has no arrows, so one "→" in a label would fail the whole PNG.
 */
const ASCII_GLYPHS: ReadonlyArray<readonly [RegExp, string]> = [
	[/[→⟶➔➜➝➞➡]/gu, "->"],
	[/[←⟵⬅]/gu, "<-"],
	[/[↔⟷]/gu, "<->"],
	[/[⇒⟹]/gu, "=>"],
	[/[⇐⟸]/gu, "<="],
	[/[⇔⟺]/gu, "<=>"],
	[/≥/gu, ">="],
	[/≤/gu, "<="],
	[/≠/gu, "!="],
];

function withPlainGlyphs(text: string): string {
	return ASCII_GLYPHS.reduce((value, [glyph, ascii]) => value.replace(glyph, ascii), text);
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

	const plain = withPlainGlyphs(input.text);
	const parsed = parseCandidateDiagram(plain);
	if (parsed.success) {
		if (plain !== input.text) {
			diagnostics.push(
				"glyph_replaced: arrows and comparison signs are written in ASCII, which every export font draws.",
			);
		}
		diagnostics.push(...(parsed.diagnostics ?? []));
		return {
			...input,
			diagnostics,
			...(parsed.warnings?.length ? { warnings: parsed.warnings } : {}),
			...(parsed.styles?.length ? { styles: parsed.styles } : {}),
			diagram: parsed.diagram,
			...(parsed.flowchart ? { flowchart: parsed.flowchart } : {}),
		};
	}

	diagnostics.push(...parsed.diagnostics);
	return {
		...input,
		diagnostics,
		error: parsed.error,
	};
}

/** The offered logo an authored icon names, by slug, name or alias, or the icon as written. */
function offeredSlug(icon: string, logos: readonly OfferedLogo[]): string {
	const wanted = icon.trim().toLowerCase();
	return (
		logos.find((logo) =>
			[logo.slug, logo.name, ...(logo.aliases ?? [])].some((name) => name.toLowerCase() === wanted),
		)?.slug ?? wanted
	);
}

/**
 * A flowchart document's logos settled to the ones the prompt offered: each node whose label
 * names one draws it, and every other icon is dropped. With logos on, every other node is set to
 * draw none, so the build fills no logo from the catalog that the request never named.
 */
function groundFlowchartLogos(
	document: FlowchartDocument,
	logos: readonly OfferedLogo[],
): { readonly diagnostics: string[]; readonly document: FlowchartDocument } {
	const entries = Object.entries(document.nodes);
	const placement = placeNodeLogos(
		entries.flatMap(([id, node]) => {
			const details = flowchartNodeDetails(node);
			if (details.icon === null) return [];
			return [
				{
					id,
					label: details.label,
					...(details.icon ? { icon: { slug: offeredSlug(details.icon, logos) } } : {}),
				},
			];
		}),
		logos,
	);
	const placed = new Map(placement.nodes.map((node) => [node.id, node.icon?.slug]));
	let changed = false;
	const nodes = Object.fromEntries(
		entries.map(([id, node]) => {
			const details = flowchartNodeDetails(node);
			if (details.icon === null) return [id, node];
			const slug = placed.get(id);
			const icon = slug ?? (document.logos ? null : undefined);
			if (icon === details.icon) return [id, node];
			changed = true;
			const { icon: _icon, ...rest } = details;
			if (icon !== undefined) return [id, { ...rest, icon }];
			return [id, Object.keys(rest).length === 1 ? rest.label : rest];
		}),
	);
	return {
		diagnostics: placement.diagnostics,
		document: changed ? { ...document, nodes } : document,
	};
}

/**
 * Place logos the prompt offered on the flowchart nodes or sequence
 * participants that name them and drop the rest, so a generated diagram never
 * brands an element with a technology the user did not name, nor shifts a
 * logo onto the wrong one.
 */
function groundDiagramIcons(
	candidate: DiagramGenerationCandidate & { readonly diagram: CanonicalDiagram },
	request: DiagramGenerationRequest,
): {
	readonly diagnostics: string[];
	readonly diagram: CanonicalDiagram;
	readonly flowchart?: FlowchartDocument;
} {
	const logos = request.prompt.logos ?? [];
	const { diagram } = candidate;
	if (diagram.type === "flowchart" && candidate.flowchart) {
		const grounded = groundFlowchartLogos(candidate.flowchart, logos);
		if (grounded.document === candidate.flowchart)
			return { diagnostics: grounded.diagnostics, diagram, flowchart: candidate.flowchart };
		const drawn = drawnFlowchart(grounded.document);
		return drawn.success
			? { diagnostics: grounded.diagnostics, diagram: drawn.diagram, flowchart: grounded.document }
			: { diagnostics: [], diagram, flowchart: candidate.flowchart };
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

/** Hold the answer to the caller's explicit type, and ground its logos and Gantt dependencies in the prompt. */
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
	const grounding = groundDiagramIcons({ ...input, diagram: input.diagram }, request);
	const dependencies = groundGanttDependencies(grounding.diagram, request);
	const diagnostics = [...grounding.diagnostics, ...dependencies.diagnostics];
	return diagnostics.length > 0 || dependencies.diagram !== input.diagram
		? {
				...input,
				diagram: dependencies.diagram,
				...(grounding.flowchart ? { flowchart: grounding.flowchart } : {}),
				diagnostics: [...input.diagnostics, ...diagnostics],
			}
		: input;
}

/**
 * A Gantt chart whose request states no dependency draws none. A revision keeps the
 * dependencies of the chart it revises.
 */
function groundGanttDependencies(
	diagram: CanonicalDiagram,
	request: DiagramGenerationRequest,
): { readonly diagnostics: string[]; readonly diagram: CanonicalDiagram } {
	if (diagram.type !== "gantt" || request.prompt.base) return { diagnostics: [], diagram };
	const grounded = withoutUnstatedGanttDependencies(diagram, request.prompt.request);
	return grounded.dropped === 0
		? { diagnostics: [], diagram }
		: {
				diagnostics: [
					`gantt_dependencies_unstated: removed ${grounded.dropped} ${grounded.dropped === 1 ? "dependency" : "dependencies"} the request does not state.`,
				],
				diagram: grounded.diagram,
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
		...(candidate.attempts !== undefined ? { attempts: candidate.attempts } : {}),
		...(candidate.durationMs !== undefined ? { durationMs: candidate.durationMs } : {}),
		...(candidate.error ? { error: candidate.error } : {}),
		...(candidate.usage ? { usage: candidate.usage } : {}),
	};
}
