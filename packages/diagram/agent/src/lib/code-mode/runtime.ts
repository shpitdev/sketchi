import {
	CANVAS_LIMITS,
	FLOWCHART_MAX_ISSUES,
	FlowchartDiagramSchema,
	SKETCHI_DIAGRAM_STYLE,
	compileCanvasSpec,
	curvedConnectorBetween,
	getCanvasValidationIssues,
	getFlowchartValidationIssues,
	getSequenceValidationIssues,
	getStateMachineValidationIssues,
	stateLabel,
	getErValidationIssues,
	parseErFieldShorthand,
	resolveErShorthand,
	getClassValidationIssues,
	parseClassAttributeShorthand,
	parseClassMethodShorthand,
	parseClassParameterShorthand,
	resolveClassShorthand,
	getTimelineValidationIssues,
	getChartValidationIssues,
	getGanttValidationIssues,
	ganttScheduleConflicts,
	orderedTimelineEvents,
	type GanttDiagram,
	type GanttValidationIssueCode,
	type ChartDiagram,
	type TimelineDiagram,
	mindmapDiagramFromTree,
	validateFlowchartDiagram,
	wrappedLabelWidth,
	wrapTextToWidth,
	type FlowchartDiagram,
	type FlowchartValidationIssueRef,
	type MindmapDiagram,
	type CanvasValidationIssue,
	type SequenceDiagram,
	type SequenceValidationIssueCode,
	type StateMachineDiagram,
	type StateMachineValidationIssueCode,
	type ErDiagram,
	type ErValidationIssueCode,
	type ClassDiagram,
	type ClassValidationIssueCode,
} from "@sketchi/diagram-core";
import {
	convertSceneToExcalidraw,
	createExcalidrawFile,
	type ExcalidrawScene,
	validateExcalidrawScene,
} from "@sketchi/diagram-excalidraw";
import {
	renderIntermediateDiagram,
	renderMindmapDiagram,
	renderSequenceDiagram,
	renderStateMachineDiagram,
	renderErDiagram,
	renderClassDiagram,
	renderTimelineDiagram,
	renderChartDiagram,
	renderGanttDiagram,
	isStructurallyValidGanttMark,
	isStructurallyValidSequenceActivation,
	isStructurallyValidSequenceLifeline,
	isStructurallyValidChartMark,
	isStructurallyValidStateMarker,
	isStructurallyValidErOptional,
	isStructurallyValidErTable,
	isStructurallyValidClassBox,
	isStructurallyValidTimelineMarker,
	type RenderedDiagramScene,
	type ScenePoint,
} from "@sketchi/diagram-renderer";
import {
	recordMetric,
	withTelemetryCorrelation,
	type TelemetryCorrelationInput,
} from "@sketchi/observability";
import { Clock, Context, Effect, Layer, Metric, Result, Schema } from "effect";

import {
	ARTIFACT_MIME_TYPES,
	CodeModeArtifactStorage,
	isInlineArtifactFormat,
	jsonSizeBytes,
	storageIssue,
	type CodeModeArtifactStorageError,
	type StoredArtifactFormat,
} from "./artifacts.js";
import {
	formatContractSchemaError,
	BuildFlowchartRejected,
	BuildMindmapRejected,
	BuildSequenceDiagramRejected,
	BuildStateMachineRejected,
	BuildErDiagramRejected,
	BuildClassDiagramRejected,
	BuildTimelineRejected,
	BuildChartRejected,
	BuildGanttRejected,
	CreateCanvasRejected,
	GetArtifactRejected,
	ApplyDiagramPatchRejected,
	ApplyDiagramPatchRequestSchema,
	BuildFlowchartRequestSchema,
	BuildMindmapRequestSchema,
	BuildSequenceDiagramRequestSchema,
	BuildStateMachineRequestSchema,
	BuildErDiagramRequestSchema,
	BuildClassDiagramRequestSchema,
	BuildTimelineRequestSchema,
	BuildChartRequestSchema,
	BuildGanttRequestSchema,
	CreateCanvasRequestSchema,
	DEFAULT_ICON_SEARCH_LIMIT,
	SearchIconsRejected,
	SearchIconsRequestSchema,
	type SearchIconsResult,
	DIAGRAM_PATCH_OPERATION_NAMES,
	GetArtifactRequestSchema,
	RenderedDiagramSceneSchema,
	type ApplyDiagramPatchRequest,
	type ApplyDiagramPatchResult,
	type ArtifactBundle,
	type ArtifactFormat,
	type BuildFlowchartRequest,
	type BuildFlowchartResult,
	type BuildMindmapResult,
	type BuildSequenceDiagramRequest,
	type BuildStateMachineRequest,
	type BuildErDiagramRequest,
	type BuildClassDiagramRequest,
	type BuildTimelineRequest,
	type BuildChartRequest,
	type BuildGanttRequest,
	type BuildSequenceDiagramResult,
	type BuildStateMachineResult,
	type BuildErDiagramResult,
	type BuildClassDiagramResult,
	type BuildTimelineResult,
	type BuildChartResult,
	type BuildGanttResult,
	type CreateCanvasResult,
	CodeModeIssueSchema,
	type ContractSchemaIssue,
	type CodeModeIssue,
	type CodeModeIssueCode,
	type CodeModeIssueRef,
	type ContractSchemaError,
	type DiagramPatchOperation,
	type DiagramSelector,
	type GetArtifactResult,
	type InlineArtifactFormat,
	type MindmapSpec,
	type NormalizedFlowchartSpec,
	type NormalizedMindmapSpec,
	type NormalizedSequenceDiagramSpec,
	type NormalizedStateMachineSpec,
	type NormalizedErSpec,
	type NormalizedClassSpec,
	type NormalizedTimelineSpec,
	type NormalizedChartSpec,
	type NormalizedGanttSpec,
	type PartialArtifactBundle,
	type PatchableScene,
	type QualityReport,
} from "./contract.js";
import { embedSceneIcons, resolveNodeIcons, type CodeModeIconCatalog } from "./icons.js";
import { cleanToolString } from "../clean-tool-string.js";
import { assessFlowchartQuality } from "../flowchart/quality.js";
import { flowchartDiagramInput, normalizeFlowchartSpec } from "../flowchart/spec.js";
import { FLOWCHART_NODE_KIND_HINT, resolveFlowchartNodeKinds } from "../flowchart/node-kinds.js";

const DEFAULT_BUILD_FORMATS: ArtifactFormat[] = ["excalidraw", "scene"];
const DEFAULT_INLINE_FORMATS: InlineArtifactFormat[] = ["scene"];
const DEFAULT_MIN_QUALITY_SCORE = 8;
const SCENE_PADDING = 48;
const MAX_MINDMAP_DEPTH = 8;
const MAX_MINDMAP_TOPICS = 100;
const MAX_INPUT_ISSUES = 20;

const codeModeRequests = Metric.counter("sketchi_codemode_requests", {
	description: "Code Mode boundary requests by terminal outcome",
	incremental: true,
});
const codeModeFailures = Metric.counter("sketchi_codemode_failures", {
	description: "Code Mode boundary failures by typed status",
	incremental: true,
});
const codeModeArtifacts = Metric.counter("sketchi_codemode_artifacts", {
	description: "Code Mode artifacts accepted at workflow boundaries",
	incremental: true,
});
const codeModeDuration = Metric.histogram("sketchi_codemode_duration_ms", {
	description: "Code Mode boundary duration in milliseconds",
	boundaries: Metric.boundariesFromIterable([
		1, 5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000,
	]),
});

export interface CodeModeRuntimeOptions {
	createId?: (prefix: string) => string;
	/** Node-logo catalog; without one, every node icon is dropped with a warning. */
	icons?: CodeModeIconCatalog;
	renderer?: CodeModeArtifactRenderer;
	artifactUrl?: (input: { artifactId: string; format: ArtifactFormat }) => string;
}

export class CodeModeRuntimeEnvironment extends Context.Service<
	CodeModeRuntimeEnvironment,
	Required<Pick<CodeModeRuntimeOptions, "createId">> &
		Pick<CodeModeRuntimeOptions, "artifactUrl" | "icons" | "renderer">
>()("@sketchi/diagram-agent/CodeModeRuntimeEnvironment") {}

export const CodeModeRuntimeEnvironmentLive = Layer.succeed(CodeModeRuntimeEnvironment, {
	createId: defaultCreateId,
});

export function makeCodeModeRuntimeEnvironmentLayer(options: CodeModeRuntimeOptions = {}) {
	return Layer.succeed(CodeModeRuntimeEnvironment, {
		createId: options.createId ?? defaultCreateId,
		...(options.icons ? { icons: options.icons } : {}),
		...(options.renderer ? { renderer: options.renderer } : {}),
		...(options.artifactUrl ? { artifactUrl: options.artifactUrl } : {}),
	});
}

function unknownRecord(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? Object.fromEntries(Object.entries(value))
		: undefined;
}

type CodeModeBoundaryOperation =
	| "applyDiagramPatch"
	| "buildFlowchart"
	| "buildMindmap"
	| "buildSequenceDiagram"
	| "buildStateMachine"
	| "buildErDiagram"
	| "buildClassDiagram"
	| "buildTimeline"
	| "buildChart"
	| "buildGantt"
	| "createCanvas"
	| "getArtifact"
	| "searchIcons";

interface ObservableCodeModeResult {
	readonly ok: boolean;
	readonly status?: string;
}

function codeModeCorrelation(input: unknown): TelemetryCorrelationInput {
	const record = unknownRecord(input);
	const source = unknownRecord(record?.["source"]);
	const artifactId =
		typeof record?.["artifactId"] === "string"
			? record["artifactId"]
			: typeof source?.["artifactId"] === "string"
				? source["artifactId"]
				: undefined;
	const requestId = typeof record?.["requestId"] === "string" ? record["requestId"] : undefined;
	return {
		...(artifactId ? { artifactId } : {}),
		...(requestId ? { requestId } : {}),
	};
}

function artifactKindForOperation(operation: CodeModeBoundaryOperation): string | undefined {
	if (operation === "buildFlowchart") return "flowchart";
	if (operation === "buildMindmap") return "mindmap";
	if (operation === "buildSequenceDiagram") return "sequence";
	if (operation === "buildTimeline") return "timeline";
	if (operation === "buildChart") return "chart";
	if (operation === "buildGantt") return "gantt";
	if (operation === "buildStateMachine") return "state-machine";
	if (operation === "buildErDiagram") return "er";
	if (operation === "buildClassDiagram") return "class";
	if (operation === "createCanvas") return "canvas";
	if (operation === "applyDiagramPatch") return "patch";
	return undefined;
}

function observeCodeModeBoundary<A extends ObservableCodeModeResult, R>(
	operation: CodeModeBoundaryOperation,
	input: unknown,
	effect: Effect.Effect<A, never, R>,
): Effect.Effect<A, never, R> {
	const observed = Effect.gen(function* () {
		const startedAt = yield* Clock.currentTimeMillis;
		const result = yield* effect;
		const finishedAt = yield* Clock.currentTimeMillis;
		const outcome = result.ok ? "success" : "failure";
		const failureCategory = result.ok ? undefined : (result.status ?? "unknown_failure");
		yield* recordMetric(codeModeRequests, 1, {
			...(failureCategory ? { failureCategory } : {}),
			operation,
			outcome,
			surface: "code_mode",
		});
		yield* recordMetric(codeModeDuration, finishedAt - startedAt, {
			...(failureCategory ? { failureCategory } : {}),
			operation,
			outcome,
			surface: "code_mode",
		});
		if (failureCategory) {
			yield* recordMetric(codeModeFailures, 1, {
				failureCategory,
				operation,
				surface: "code_mode",
			});
		}
		const artifactKind = artifactKindForOperation(operation);
		if (result.ok && artifactKind) {
			yield* recordMetric(codeModeArtifacts, 1, {
				artifactKind,
				operation,
				surface: "code_mode",
			});
		}
		return result;
	});
	return withTelemetryCorrelation(observed, codeModeCorrelation(input));
}

function preflightMindmapInput(input: unknown): CodeModeIssue[] {
	const root = unknownRecord(unknownRecord(unknownRecord(input)?.["spec"])?.["root"]);
	if (!root) return [];

	const stack: Array<{ depth: number; topic: Record<string, unknown> }> = [
		{ depth: 0, topic: root },
	];
	let discoveredSlots = 1;
	while (stack.length > 0) {
		const current = stack.pop();
		if (!current) continue;
		if (current.depth > MAX_MINDMAP_DEPTH) {
			return [
				issue({
					code: "mindmap_too_deep",
					stage: "mindmap",
					ref: { kind: "request", path: "spec.root.children" },
					message: `Mindmap depth exceeds the supported maximum of ${MAX_MINDMAP_DEPTH}.`,
					hint: "Combine overly deep topics into a shallower hierarchy.",
				}),
			];
		}
		const children = current.topic["children"];
		if (!Array.isArray(children)) continue;
		discoveredSlots += children.length;
		if (discoveredSlots > MAX_MINDMAP_TOPICS) {
			return [
				issue({
					code: "mindmap_too_large",
					stage: "mindmap",
					ref: { kind: "request", path: "spec.root" },
					message: `Mindmap exceeds the supported maximum of ${MAX_MINDMAP_TOPICS} topic slots.`,
					hint: "Split this hierarchy into smaller focused mindmaps.",
				}),
			];
		}
		for (let index = children.length - 1; index >= 0; index -= 1) {
			const child = unknownRecord(children[index]);
			if (child) stack.push({ depth: current.depth + 1, topic: child });
		}
	}
	return [];
}

function normalizeMindmapSpec(spec: MindmapSpec): NormalizedMindmapSpec {
	const normalizeTopic = (
		topic: MindmapSpec["root"],
		path: readonly number[],
	): NormalizedMindmapSpec["root"] => ({
		id: `topic-${path.join("-")}`,
		label: cleanToolString(topic.label),
		children: (topic.children ?? []).map((child, index) => normalizeTopic(child, [...path, index])),
	});
	const title = cleanToolString(spec.title);
	return {
		id: cleanOptional(spec.id) ?? (slugify(title) || "sketchi-mindmap"),
		title,
		root: normalizeTopic(spec.root, [0]),
		layout: { direction: spec.layout.direction },
		style: { ...SKETCHI_DIAGRAM_STYLE },
	};
}

function mindmapStats(spec: NormalizedMindmapSpec): {
	count: number;
	depth: number;
} {
	let count = 0;
	let depth = 0;
	const visit = (topic: NormalizedMindmapSpec["root"], currentDepth: number) => {
		count += 1;
		depth = Math.max(depth, currentDepth);
		topic.children.forEach((child) => visit(child, currentDepth + 1));
	};
	visit(spec.root, 0);
	return { count, depth };
}

function validateNormalizedMindmap(spec: NormalizedMindmapSpec): CodeModeIssue[] {
	const stats = mindmapStats(spec);
	const issues: CodeModeIssue[] = [];
	if (stats.count < 2) {
		issues.push(
			issue({
				code: "disconnected_graph",
				stage: "mindmap",
				ref: { kind: "diagram", id: spec.id },
				message: "Mindmap root must contain at least one child topic.",
				hint: "Add one or more nested topics under spec.root.children.",
			}),
		);
	}
	if (stats.depth > MAX_MINDMAP_DEPTH) {
		issues.push(
			issue({
				code: "mindmap_too_deep",
				stage: "mindmap",
				ref: { kind: "diagram", id: spec.id },
				message: `Mindmap depth ${stats.depth} exceeds the supported maximum of ${MAX_MINDMAP_DEPTH}.`,
				hint: "Combine overly deep topics into a shallower hierarchy.",
			}),
		);
	}
	if (stats.count > MAX_MINDMAP_TOPICS) {
		issues.push(
			issue({
				code: "mindmap_too_large",
				stage: "mindmap",
				ref: { kind: "diagram", id: spec.id },
				message: `Mindmap has ${stats.count} topics; the supported maximum is ${MAX_MINDMAP_TOPICS}.`,
				hint: "Split this hierarchy into smaller focused mindmaps.",
			}),
		);
	}
	return issues;
}

function toMindmapDiagram(spec: NormalizedMindmapSpec): MindmapDiagram {
	return mindmapDiagramFromTree({
		id: spec.id,
		title: spec.title,
		root: spec.root,
		direction: spec.layout.direction,
		style: SKETCHI_DIAGRAM_STYLE,
	});
}

function mindmapQuality(diagram: MindmapDiagram, threshold: number): QualityReport {
	const generic = diagram.nodes.filter((node) =>
		/^(topic|branch|item|mindmap)$/i.test(node.label.trim()),
	);
	const score = Math.max(0, 10 - generic.length * 2);
	return {
		accepted: score >= threshold,
		score,
		threshold,
		summary: {
			nodeCount: diagram.nodes.length,
			edgeCount: diagram.edges.length,
		},
		checks: generic.map((node) => ({
			code: "generic_label",
			passed: false,
			severity: "warning",
			message: `Topic "${node.label}" is too generic.`,
			refs: [{ kind: "node", id: node.id }],
		})),
	};
}

function normalizeTimelineSpec(spec: BuildTimelineRequest["spec"]): NormalizedTimelineSpec {
	const title = cleanToolString(spec.title);
	const diagram: TimelineDiagram = {
		id: cleanOptional(spec.id) ?? (slugify(title) || "sketchi-timeline"),
		title,
		type: "timeline",
		style: { ...SKETCHI_DIAGRAM_STYLE },
		events: spec.events.map((event) => ({ ...event })),
	};
	return {
		id: diagram.id,
		title,
		events: orderedTimelineEvents(diagram),
		...(spec.lanes ? { lanes: [...spec.lanes] } : {}),
		...(spec.today ? { today: spec.today } : {}),
		style: diagram.style,
	};
}
function toTimelineDiagram(spec: NormalizedTimelineSpec): TimelineDiagram {
	return { ...spec, type: "timeline" };
}
function validateNormalizedTimeline(spec: NormalizedTimelineSpec): CodeModeIssue[] {
	return getTimelineValidationIssues(toTimelineDiagram(spec)).map((entry) =>
		issue({
			code: entry.code,
			stage: "input",
			ref: { kind: "request", path: `spec.${entry.path}` },
			message: entry.message,
			hint: entry.hint,
		}),
	);
}
function timelineQuality(spec: NormalizedTimelineSpec, threshold: number): QualityReport {
	return {
		accepted: 10 >= threshold,
		score: 10,
		threshold,
		summary: { nodeCount: spec.events.length, edgeCount: 0 },
		checks: [],
	};
}

function normalizeChartSpec(spec: BuildChartRequest["spec"]): NormalizedChartSpec {
	const title = cleanToolString(spec.title);
	const optionalText = (value: string | undefined) => {
		const cleaned = cleanOptional(value);
		return cleaned === undefined ? undefined : cleaned;
	};
	const unit = optionalText(spec.unit);
	const categoryAxisTitle = optionalText(spec.categoryAxisTitle);
	const valueAxisTitle = optionalText(spec.valueAxisTitle);
	return {
		id: cleanOptional(spec.id) ?? (slugify(title) || "sketchi-chart"),
		title,
		kind: spec.kind,
		categories: spec.categories.map(cleanToolString),
		series: spec.series.map((series) => {
			const name = optionalText(series.name);
			return { ...(name ? { name } : {}), values: [...series.values] };
		}),
		...(unit ? { unit } : {}),
		...(categoryAxisTitle ? { categoryAxisTitle } : {}),
		...(valueAxisTitle ? { valueAxisTitle } : {}),
		...(spec.stacked !== undefined ? { stacked: spec.stacked } : {}),
		...(spec.donut !== undefined ? { donut: spec.donut } : {}),
		...(spec.orientation ? { orientation: spec.orientation } : {}),
		style: { ...SKETCHI_DIAGRAM_STYLE },
	};
}
function toChartDiagram(spec: NormalizedChartSpec): ChartDiagram {
	return { ...spec, type: "chart" };
}
function validateNormalizedChart(spec: NormalizedChartSpec): CodeModeIssue[] {
	return getChartValidationIssues(toChartDiagram(spec)).map((entry) =>
		issue({
			code: entry.code,
			stage: "input",
			ref: { kind: "request", path: `spec.${entry.path}` },
			message: entry.message,
			hint: entry.hint,
		}),
	);
}
function chartQuality(spec: NormalizedChartSpec, threshold: number): QualityReport {
	return {
		accepted: 10 >= threshold,
		score: 10,
		threshold,
		summary: { nodeCount: spec.categories.length * spec.series.length, edgeCount: 0 },
		checks: [],
	};
}

function normalizeGanttSpec(spec: BuildGanttRequest["spec"]): NormalizedGanttSpec {
	const title = cleanToolString(spec.title);
	return {
		id: cleanOptional(spec.id) ?? (slugify(title) || "sketchi-gantt"),
		title,
		tasks: spec.tasks.map((task) => {
			const phase = cleanOptional(task.phase);
			return {
				...task,
				id: cleanToolString(task.id),
				label: cleanToolString(task.label),
				start: cleanToolString(task.start),
				...(task.end !== undefined ? { end: cleanToolString(task.end) } : {}),
				...(phase !== undefined ? { phase } : {}),
				...(task.dependsOn ? { dependsOn: task.dependsOn.map(cleanToolString) } : {}),
			};
		}),
		...(spec.phases ? { phases: spec.phases.map(cleanToolString) } : {}),
		...(spec.today ? { today: cleanToolString(spec.today) } : {}),
		style: { ...SKETCHI_DIAGRAM_STYLE },
	};
}
function toGanttDiagram(spec: NormalizedGanttSpec): GanttDiagram {
	return { ...spec, type: "gantt" };
}
/** Code Mode's published issue codes for diagram-core's Gantt invariants. */
const GANTT_ISSUE_CODES = {
	gantt_too_large: "gantt_too_large",
	duplicate_task_id: "duplicate_node_id",
	invalid_gantt_date: "invalid_gantt_date",
	invalid_gantt_span: "invalid_gantt_span",
	invalid_gantt_phase: "invalid_gantt_phase",
	invalid_gantt_progress: "invalid_gantt_progress",
	missing_dependency: "missing_edge_source",
	self_dependency: "self_loop",
	gantt_dependency_cycle: "gantt_dependency_cycle",
} as const satisfies Record<GanttValidationIssueCode, CodeModeIssueCode>;
function validateNormalizedGantt(spec: NormalizedGanttSpec): CodeModeIssue[] {
	return getGanttValidationIssues(toGanttDiagram(spec)).map((entry) =>
		issue({
			code: GANTT_ISSUE_CODES[entry.code],
			stage: "input",
			ref: { kind: "request", path: `spec.${entry.path}` },
			message: entry.message,
			hint: entry.hint,
		}),
	);
}
/** Successors that start before a predecessor finishes still build; the warning names the date to check. */
function ganttScheduleWarnings(spec: NormalizedGanttSpec): CodeModeIssue[] {
	return ganttScheduleConflicts(toGanttDiagram(spec)).map((conflict) =>
		issue({
			code: "gantt_schedule_conflict",
			severity: "warning",
			stage: "input",
			ref: { kind: "request", path: `spec.${conflict.path}` },
			message: `Task "${conflict.task}" starts before "${conflict.dependsOn}" finishes on ${conflict.finishes}.`,
			hint: `Keep dates the prompt states; otherwise start "${conflict.task}" after ${conflict.finishes}.`,
		}),
	);
}
function ganttQuality(spec: NormalizedGanttSpec, threshold: number): QualityReport {
	return {
		accepted: 10 >= threshold,
		score: 10,
		threshold,
		summary: {
			nodeCount: spec.tasks.length,
			edgeCount: spec.tasks.reduce((count, task) => count + (task.dependsOn?.length ?? 0), 0),
		},
		checks: [],
	};
}

function normalizeSequenceDiagramSpec(
	spec: BuildSequenceDiagramRequest["spec"],
): NormalizedSequenceDiagramSpec {
	const title = cleanToolString(spec.title);
	return {
		id: cleanOptional(spec.id) ?? (slugify(title) || "sketchi-sequence"),
		title,
		participants: spec.participants.map((participant) => ({
			id: cleanToolString(participant.id),
			label: cleanToolString(participant.label),
			...(participant.kind ? { kind: cleanToolString(participant.kind) } : {}),
			...(participant.icon ? { icon: { slug: participant.icon.slug } } : {}),
		})),
		messages: spec.messages.map((message, index) => ({
			id:
				cleanOptional(message.id) ??
				`message-${index + 1}-${slugify(message.source)}-${slugify(message.target)}`,
			source: cleanToolString(message.source),
			target: cleanToolString(message.target),
			label: cleanToolString(message.label),
			...(message.type ? { type: message.type } : {}),
			...(message.style ? { style: message.style } : {}),
		})),
		style: { ...SKETCHI_DIAGRAM_STYLE },
	};
}

function toSequenceDiagram(spec: NormalizedSequenceDiagramSpec): SequenceDiagram {
	return {
		id: spec.id,
		title: spec.title,
		type: "sequence",
		participants: spec.participants,
		messages: spec.messages,
		style: spec.style,
	};
}

/** Code Mode's published issue codes for diagram-core's sequence invariants. */
const SEQUENCE_ISSUE_CODES = {
	sequence_too_large: "sequence_too_large",
	duplicate_participant_id: "duplicate_node_id",
	lifeline_id_collision: "duplicate_node_id",
	duplicate_message_id: "duplicate_edge_id",
	missing_message_source: "missing_edge_source",
	missing_message_target: "missing_edge_target",
	self_message: "self_loop",
} as const satisfies Record<SequenceValidationIssueCode, CodeModeIssueCode>;

/**
 * Code Mode requests nest the diagram under `spec`, so hints that name a field
 * keep the published request path rather than diagram-core's.
 */
const SEQUENCE_ISSUE_HINTS: Partial<Record<SequenceValidationIssueCode, string>> = {
	missing_message_source: "Use the id of a participant declared in spec.participants.",
	missing_message_target: "Use the id of a participant declared in spec.participants.",
};

function validateNormalizedSequenceDiagram(spec: NormalizedSequenceDiagramSpec): CodeModeIssue[] {
	return getSequenceValidationIssues(toSequenceDiagram(spec)).map((entry) =>
		issue({
			code: SEQUENCE_ISSUE_CODES[entry.code],
			stage: "input",
			ref: { kind: "request", path: `spec.${entry.path}` },
			message: entry.message,
			hint: SEQUENCE_ISSUE_HINTS[entry.code] ?? entry.hint,
		}),
	);
}

function sequenceQuality(spec: NormalizedSequenceDiagramSpec, threshold: number): QualityReport {
	const score = 10;
	return {
		accepted: score >= threshold,
		score,
		threshold,
		summary: {
			nodeCount: spec.participants.length,
			edgeCount: spec.messages.length,
		},
		checks: [],
	};
}

function normalizeStateMachineSpec(
	spec: BuildStateMachineRequest["spec"],
): NormalizedStateMachineSpec {
	const title = cleanToolString(spec.title);
	const optional = (key: string, value: string | undefined) =>
		value && cleanToolString(value) ? { [key]: cleanToolString(value) } : {};
	return {
		id: cleanOptional(spec.id) ?? (slugify(title) || "sketchi-state-machine"),
		title,
		initial: cleanToolString(spec.initial),
		states: spec.states.map((state) => {
			const id = cleanToolString(state.id);
			const label = stateLabel({ ...state, id });
			return {
				id,
				...(label !== undefined ? { label } : {}),
				...(state.kind ? { kind: state.kind } : {}),
				...optional("parent", state.parent),
				...optional("initial", state.initial),
			};
		}),
		transitions: spec.transitions.map((transition, index) => ({
			id:
				cleanOptional(transition.id) ??
				`transition-${index + 1}-${slugify(transition.source)}-${slugify(transition.target)}`,
			source: cleanToolString(transition.source),
			target: cleanToolString(transition.target),
			...optional("event", transition.event),
			...optional("guard", transition.guard),
			...optional("action", transition.action),
		})),
		...(spec.layout ? { layout: { direction: spec.layout.direction } } : {}),
		style: { ...SKETCHI_DIAGRAM_STYLE },
	};
}

function toStateMachineDiagram(spec: NormalizedStateMachineSpec): StateMachineDiagram {
	return { ...spec, type: "state-machine" };
}

/** Code Mode's published issue codes for diagram-core's state-machine invariants. */
const STATE_MACHINE_ISSUE_CODES = {
	state_machine_too_large: "state_machine_too_large",
	invalid_state_id: "invalid_state",
	duplicate_state_id: "duplicate_node_id",
	duplicate_transition_id: "duplicate_edge_id",
	missing_state_label: "invalid_state",
	unknown_initial_state: "unknown_initial_state",
	unknown_parent_state: "invalid_composite",
	nested_composite: "invalid_composite",
	missing_transition_source: "missing_edge_source",
	missing_transition_target: "missing_edge_target",
	final_has_outgoing: "final_has_outgoing",
	composite_member_transition: "invalid_composite",
	missing_composite_initial: "invalid_composite",
	underbranched_choice: "underbranched_choice",
	unguarded_choice_branch: "unlabeled_decision_branch",
	unreachable_state: "unreachable_node",
} as const satisfies Record<StateMachineValidationIssueCode, CodeModeIssueCode>;

function validateNormalizedStateMachine(spec: NormalizedStateMachineSpec): CodeModeIssue[] {
	return getStateMachineValidationIssues(toStateMachineDiagram(spec)).map((entry) =>
		issue({
			code: STATE_MACHINE_ISSUE_CODES[entry.code],
			stage: "input",
			ref: { kind: "request", path: `spec.${entry.path}` },
			message: entry.message,
			hint: entry.hint,
		}),
	);
}

function stateMachineQuality(spec: NormalizedStateMachineSpec, threshold: number): QualityReport {
	const score = 10;
	return {
		accepted: score >= threshold,
		score,
		threshold,
		summary: { nodeCount: spec.states.length, edgeCount: spec.transitions.length },
		checks: [],
	};
}

function normalizeErSpec(spec: BuildErDiagramRequest["spec"]): NormalizedErSpec {
	const title = cleanToolString(spec.title);
	const optional = (key: string, value: string | undefined) =>
		value && cleanToolString(value) ? { [key]: cleanToolString(value) } : {};
	const flag = (key: string, value: boolean | undefined) => (value ? { [key]: true } : {});
	// An omitted id takes the next `relationship-<n>` no relationship claims explicitly.
	const used = new Set(
		spec.relationships.flatMap((relationship) => cleanOptional(relationship.id) ?? []),
	);
	const relationshipId = (index: number) => {
		let number = index + 1;
		while (used.has(`relationship-${number}`)) number += 1;
		used.add(`relationship-${number}`);
		return `relationship-${number}`;
	};
	return {
		id: cleanOptional(spec.id) ?? (slugify(title) || "sketchi-er-diagram"),
		title,
		entities: spec.entities.map((entity) => ({
			id: cleanToolString(entity.id),
			...optional("name", entity.name),
			fields: entity.fields.map((input) => {
				const field =
					typeof input === "string" ? parseErFieldShorthand(cleanToolString(input)) : input;
				return {
					name: cleanToolString(field.name),
					...optional("type", field.type),
					...flag("pk", field.pk),
					...flag("fk", field.fk),
					...flag("unique", field.unique),
					...flag("nullable", field.nullable),
				};
			}),
		})),
		relationships: spec.relationships.map((relationship, index) => ({
			id: cleanOptional(relationship.id) ?? relationshipId(index),
			from: cleanToolString(relationship.from),
			to: cleanToolString(relationship.to),
			fromCardinality: relationship.fromCardinality,
			toCardinality: relationship.toCardinality,
			...optional("label", relationship.label),
		})),
		style: { ...SKETCHI_DIAGRAM_STYLE },
	};
}

function toErDiagram(spec: NormalizedErSpec): ErDiagram {
	return { ...spec, type: "er" };
}

/** Code Mode's published issue codes for diagram-core's ER invariants. */
const ER_ISSUE_CODES = {
	er_too_large: "er_too_large",
	invalid_entity_id: "invalid_entity",
	duplicate_entity_id: "duplicate_node_id",
	duplicate_entity_name: "invalid_entity",
	duplicate_field_name: "invalid_field",
	er_text_too_long: "label_too_long",
	nullable_primary_key: "invalid_field",
	duplicate_relationship_id: "duplicate_edge_id",
	missing_relationship_entity: "missing_edge_target",
	missing_relationship_field: "unknown_relationship_field",
	self_referencing_field: "invalid_relationship",
} as const satisfies Record<ErValidationIssueCode, CodeModeIssueCode>;

function validateNormalizedEr(spec: NormalizedErSpec): CodeModeIssue[] {
	return getErValidationIssues(toErDiagram(spec)).map((entry) =>
		issue({
			code:
				entry.code === "missing_relationship_entity" && entry.path.endsWith(".from")
					? "missing_edge_source"
					: ER_ISSUE_CODES[entry.code],
			stage: "input",
			ref: { kind: "request", path: `spec.${entry.path}` },
			message: entry.message,
			hint: entry.hint,
		}),
	);
}

function erQuality(spec: NormalizedErSpec, threshold: number): QualityReport {
	const score = 10;
	return {
		accepted: score >= threshold,
		score,
		threshold,
		summary: { nodeCount: spec.entities.length, edgeCount: spec.relationships.length },
		checks: [],
	};
}

/** Read one-line fields, cardinality aliases and from/to aliases before the request is decoded. */
function resolveErRequest(input: unknown): unknown {
	if (typeof input !== "object" || input === null || !("spec" in input)) return input;
	return { ...input, spec: resolveErShorthand(input.spec) };
}

function normalizeClassSpec(spec: BuildClassDiagramRequest["spec"]): NormalizedClassSpec {
	const title = cleanToolString(spec.title);
	const optional = (key: string, value: string | undefined) =>
		value && cleanToolString(value) ? { [key]: cleanToolString(value) } : {};
	const flag = (key: string, value: boolean | undefined) => (value ? { [key]: true } : {});
	// An omitted id takes the next `relationship-<n>` no relationship claims explicitly.
	const used = new Set(
		spec.relationships.flatMap((relationship) => cleanOptional(relationship.id) ?? []),
	);
	const relationshipId = (index: number) => {
		let number = index + 1;
		while (used.has(`relationship-${number}`)) number += 1;
		used.add(`relationship-${number}`);
		return `relationship-${number}`;
	};
	return {
		id: cleanOptional(spec.id) ?? (slugify(title) || "sketchi-class-diagram"),
		title,
		classes: spec.classes.map((node) => ({
			id: cleanToolString(node.id),
			...optional("name", node.name),
			...(node.kind ? { kind: node.kind } : {}),
			...optional("stereotype", node.stereotype),
			attributes: node.attributes.map((input) => {
				const attribute =
					typeof input === "string" ? parseClassAttributeShorthand(cleanToolString(input)) : input;
				return {
					name: cleanToolString(attribute.name),
					...optional("type", attribute.type),
					...(attribute.visibility ? { visibility: attribute.visibility } : {}),
					...flag("static", attribute.static),
				};
			}),
			methods: node.methods.map((input) => {
				const method =
					typeof input === "string" ? parseClassMethodShorthand(cleanToolString(input)) : input;
				return {
					name: cleanToolString(method.name),
					params: method.params.map((param) => {
						const read =
							typeof param === "string"
								? parseClassParameterShorthand(cleanToolString(param))
								: param;
						return { name: cleanToolString(read.name), ...optional("type", read.type) };
					}),
					...optional("returns", method.returns),
					...(method.visibility ? { visibility: method.visibility } : {}),
					...flag("static", method.static),
					...flag("abstract", method.abstract),
				};
			}),
		})),
		relationships: spec.relationships.map((relationship, index) => ({
			id: cleanOptional(relationship.id) ?? relationshipId(index),
			kind: relationship.kind,
			from: cleanToolString(relationship.from),
			to: cleanToolString(relationship.to),
			...optional("fromMultiplicity", relationship.fromMultiplicity),
			...optional("toMultiplicity", relationship.toMultiplicity),
			...optional("fromRole", relationship.fromRole),
			...optional("toRole", relationship.toRole),
			...(relationship.navigable === undefined ? {} : { navigable: relationship.navigable }),
			...optional("label", relationship.label),
		})),
		style: { ...SKETCHI_DIAGRAM_STYLE },
	};
}

function toClassDiagram(spec: NormalizedClassSpec): ClassDiagram {
	return { ...spec, type: "class" };
}

/** Code Mode's published issue codes for diagram-core's class diagram invariants. */
const CLASS_ISSUE_CODES = {
	class_too_large: "class_too_large",
	invalid_class_id: "invalid_class",
	duplicate_class_id: "duplicate_node_id",
	duplicate_class_name: "invalid_class",
	duplicate_member: "invalid_member",
	class_text_too_long: "label_too_long",
	duplicate_relationship_id: "duplicate_edge_id",
	missing_relationship_class: "missing_edge_target",
	inheritance_cycle: "invalid_generalization",
	invalid_inheritance: "invalid_generalization",
	invalid_realization: "invalid_generalization",
	invalid_multiplicity: "invalid_relationship",
	misplaced_end_label: "invalid_relationship",
} as const satisfies Record<ClassValidationIssueCode, CodeModeIssueCode>;

function validateNormalizedClass(spec: NormalizedClassSpec): CodeModeIssue[] {
	return getClassValidationIssues(toClassDiagram(spec)).map((entry) =>
		issue({
			code:
				entry.code === "missing_relationship_class" && entry.path.endsWith(".from")
					? "missing_edge_source"
					: CLASS_ISSUE_CODES[entry.code],
			stage: "input",
			ref: { kind: "request", path: `spec.${entry.path}` },
			message: entry.message,
			hint: entry.hint,
		}),
	);
}

function classQuality(spec: NormalizedClassSpec, threshold: number): QualityReport {
	const score = 10;
	return {
		accepted: score >= threshold,
		score,
		threshold,
		summary: { nodeCount: spec.classes.length, edgeCount: spec.relationships.length },
		checks: [],
	};
}

/** Read one-line members, kind and multiplicity aliases and from/to aliases before the request is decoded. */
function resolveClassRequest(input: unknown): unknown {
	if (typeof input !== "object" || input === null || !("spec" in input)) return input;
	return { ...input, spec: resolveClassShorthand(input.spec) };
}

export class CodeModeArtifactRenderFailed extends Schema.TaggedError<CodeModeArtifactRenderFailed>()(
	"CodeModeArtifactRenderFailed",
	{ cause: Schema.Defect(), message: Schema.String },
) {}

/** Implementations may retain their own tagged renderer failures. */
type TaggedArtifactRenderFailure = Pick<CodeModeArtifactRenderFailed, "message"> & {
	readonly _tag: string;
};

export interface CodeModeArtifactRenderer<
	E extends TaggedArtifactRenderFailure = TaggedArtifactRenderFailure,
> {
	renderPng(input: {
		scene: RenderedDiagramScene;
		excalidraw: unknown;
	}): Effect.Effect<ArrayBuffer | Uint8Array, E>;
}

class CodeModeArtifactRendererNotConfigured extends Schema.TaggedError<CodeModeArtifactRendererNotConfigured>()(
	"CodeModeArtifactRendererNotConfigured",
	{ message: Schema.String },
) {}

type ArtifactExportError = CodeModeArtifactRendererNotConfigured | CodeModeArtifactRenderFailed;

interface SelectorTargets {
	arrows: PatchableArrow[];
	nodes: PatchableNode[];
	texts: PatchableText[];
}

const FailureContextSchema = Schema.Struct({
	issues: Schema.Array(Schema.toEncoded(CodeModeIssueSchema)).pipe(Schema.mutable),
});

class ArtifactExportFailure extends Schema.TaggedError<ArtifactExportFailure>()(
	"ArtifactExportFailure",
	{
		status: Schema.Literal("export_failed"),
		issues: FailureContextSchema.fields.issues,
	},
) {}

class ArtifactStorageFailure extends Schema.TaggedError<ArtifactStorageFailure>()(
	"ArtifactStorageFailure",
	{
		status: Schema.Literal("storage_failed"),
		cause: Schema.Defect(),
		issues: FailureContextSchema.fields.issues,
	},
) {}

function workflowFailure<
	const Tag extends string,
	const Statuses extends readonly string[],
	C extends { readonly issues: CodeModeIssue[] },
>(tag: Tag, status: Schema.Literals<Statuses>, context: Schema.Codec<C, unknown>) {
	class WorkflowFailure extends Schema.TaggedError<WorkflowFailure>()(tag, {
		message: Schema.String,
		status,
		context,
	}) {
		constructor(input: { readonly status: Statuses[number]; readonly context: C }) {
			// Failure context can contain the normalized input that failed validation.
			super(
				{
					...input,
					message: input.context.issues[0]?.message ?? input.status,
				},
				{ disableChecks: true },
			);
		}
	}
	return WorkflowFailure;
}

const BuildFlowchartFailure = workflowFailure(
	"BuildFlowchartFailure",
	BuildFlowchartRejected.fields.status,
	BuildFlowchartRejected.mapFields(({ ok, status, ...context }) => ({
		...context,
		...FailureContextSchema.fields,
	})),
);

const BuildMindmapFailure = workflowFailure(
	"BuildMindmapFailure",
	BuildMindmapRejected.fields.status,
	BuildMindmapRejected.mapFields(({ ok, status, ...context }) => ({
		...context,
		...FailureContextSchema.fields,
	})),
);

const BuildSequenceDiagramFailure = workflowFailure(
	"BuildSequenceDiagramFailure",
	BuildSequenceDiagramRejected.fields.status,
	BuildSequenceDiagramRejected.mapFields(({ ok, status, ...context }) => ({
		...context,
		...FailureContextSchema.fields,
	})),
);

const BuildStateMachineFailure = workflowFailure(
	"BuildStateMachineFailure",
	BuildStateMachineRejected.fields.status,
	BuildStateMachineRejected.mapFields(({ ok, status, ...context }) => ({
		...context,
		...FailureContextSchema.fields,
	})),
);

const BuildErDiagramFailure = workflowFailure(
	"BuildErDiagramFailure",
	BuildErDiagramRejected.fields.status,
	BuildErDiagramRejected.mapFields(({ ok, status, ...context }) => ({
		...context,
		...FailureContextSchema.fields,
	})),
);

const BuildClassDiagramFailure = workflowFailure(
	"BuildClassDiagramFailure",
	BuildClassDiagramRejected.fields.status,
	BuildClassDiagramRejected.mapFields(({ ok, status, ...context }) => ({
		...context,
		...FailureContextSchema.fields,
	})),
);

const BuildTimelineFailure = workflowFailure(
	"BuildTimelineFailure",
	BuildTimelineRejected.fields.status,
	BuildTimelineRejected.mapFields(({ ok, status, ...context }) => ({
		...context,
		...FailureContextSchema.fields,
	})),
);

const BuildChartFailure = workflowFailure(
	"BuildChartFailure",
	BuildChartRejected.fields.status,
	BuildChartRejected.mapFields(({ ok, status, ...context }) => ({
		...context,
		...FailureContextSchema.fields,
	})),
);

const BuildGanttFailure = workflowFailure(
	"BuildGanttFailure",
	BuildGanttRejected.fields.status,
	BuildGanttRejected.mapFields(({ ok, status, ...context }) => ({
		...context,
		...FailureContextSchema.fields,
	})),
);

const CreateCanvasFailure = workflowFailure(
	"CreateCanvasFailure",
	CreateCanvasRejected.fields.status,
	CreateCanvasRejected.mapFields(({ ok, status, ...context }) => ({
		...context,
		...FailureContextSchema.fields,
	})),
);

const GetArtifactFailure = workflowFailure(
	"GetArtifactFailure",
	GetArtifactRejected.fields.status,
	GetArtifactRejected.mapFields(({ ok, status, ...context }) => ({
		...context,
		...FailureContextSchema.fields,
	})),
);

const SearchIconsFailure = workflowFailure(
	"SearchIconsFailure",
	SearchIconsRejected.fields.status,
	SearchIconsRejected.mapFields(({ ok, status, ...context }) => ({
		...context,
		...FailureContextSchema.fields,
	})),
);

const ApplyDiagramPatchFailure = workflowFailure(
	"ApplyDiagramPatchFailure",
	ApplyDiagramPatchRejected.fields.status,
	ApplyDiagramPatchRejected.mapFields(({ ok, status, ...context }) => ({
		...context,
		...FailureContextSchema.fields,
	})),
);

type PatchableElement = PatchableScene["elements"][number];
type PatchableNode = Extract<PatchableElement, { type: "node" }>;
type PatchableText = Extract<PatchableElement, { type: "text" }>;
type PatchableArrow = Extract<PatchableElement, { type: "arrow" }>;
type PatchablePoint = PatchableArrow["points"][number];

function defaultCreateId(prefix: string): string {
	return `${prefix}_${globalThis.crypto.randomUUID()}`;
}

function issue(input: {
	code: CodeModeIssueCode;
	severity?: "error" | "warning";
	stage: CodeModeIssue["stage"];
	ref?: CodeModeIssueRef;
	message: string;
	hint: string;
}): CodeModeIssue {
	return {
		code: input.code,
		severity: input.severity ?? "error",
		stage: input.stage,
		...(input.ref ? { ref: input.ref } : {}),
		message: input.message,
		hint: input.hint,
	};
}

function pathForContractIssue(path: readonly PropertyKey[]): string {
	if (path.length === 0) {
		return "input";
	}
	return path.map((part) => (typeof part === "number" ? `[${part}]` : String(part))).join(".");
}

type ContractIssueLike = typeof ContractSchemaIssue.Encoded;
type ContractErrorLike = ContractSchemaError;

function codeForContractIssue(contractIssue: ContractIssueLike): CodeModeIssueCode {
	const path = pathForContractIssue(contractIssue.path);
	if (isPatchOperationNamePath(path)) return "unsupported_patch_operation";
	if (
		contractIssue.issueTag === "InvalidType" ||
		(contractIssue.issueTag === "MissingKey" && contractIssue.missingKeyCode === "invalid_type")
	)
		return "invalid_type";
	if (contractIssue.astKind === "LiteralUnion" && contractIssue.issueTag === "AnyOf")
		return "invalid_enum";
	if (path.toLowerCase().includes("color")) return "invalid_color";
	return path === "input" ? "invalid_type" : "missing_field";
}

function isPatchOperationNamePath(path: string): boolean {
	return /^operations\.\[\d+\]\.op$/.test(path);
}

function hintForContractIssue(path: string): string {
	if (isPatchOperationNamePath(path)) {
		return [
			`Use one of: ${DIAGRAM_PATCH_OPERATION_NAMES.join(", ")}.`,
			"For label edits, use replaceText with selector plus text.",
		].join(" ");
	}

	if (path === "source") {
		return "Pass source: { artifactId } from an accepted build or patch, or source: { scene } for inline Sketchi scene patching.";
	}

	return `Fix ${path} so it matches the Code Mode API contract.`;
}

const FLOWCHART_NODE_KIND_PATH = /^spec\.nodes\.\[\d+\]\.kind$/;

function flowchartHintForContractIssue(path: string): string {
	return FLOWCHART_NODE_KIND_PATH.test(path)
		? FLOWCHART_NODE_KIND_HINT
		: hintForContractIssue(path);
}

function inputIssues(
	error: ContractSchemaError,
	hintFor: (path: string) => string = hintForContractIssue,
): CodeModeIssue[] {
	const issues = error.issues.slice(0, MAX_INPUT_ISSUES).map((contractIssue) => {
		const path = pathForContractIssue(contractIssue.path);
		return issue({
			code: codeForContractIssue(contractIssue),
			stage: "input",
			ref: { kind: "request", path },
			message: contractIssue.message,
			hint: hintFor(path),
		});
	});
	if (error.issues.length > MAX_INPUT_ISSUES) {
		issues.push(
			issue({
				code: "invalid_type",
				stage: "input",
				ref: { kind: "request", path: "input" },
				message: `${error.issues.length - MAX_INPUT_ISSUES} additional input issues were omitted.`,
				hint: "Fix the summarized request shape before retrying.",
			}),
		);
	}
	return issues;
}

function slugify(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48);
}

function cleanOptional(value: string | undefined): string | undefined {
	if (value === undefined) {
		return undefined;
	}
	const cleaned = cleanToolString(value);
	return cleaned.length > 0 ? cleaned : undefined;
}

function codeModeRefForFlowchart(
	ref: FlowchartValidationIssueRef | undefined,
): CodeModeIssueRef | undefined {
	if (!ref) {
		return undefined;
	}
	return {
		kind: ref.kind,
		...(ref.id ? { id: ref.id } : {}),
		...(ref.path ? { path: `spec.${ref.path}` } : {}),
	};
}

function canonicalFlowchartIssues(diagram: FlowchartDiagram): CodeModeIssue[] {
	return getFlowchartValidationIssues(diagram).map((validationIssue) => {
		const ref = codeModeRefForFlowchart(validationIssue.ref);
		return issue({
			code: validationIssue.code,
			stage: "flowchart",
			...(ref ? { ref } : {}),
			message: validationIssue.message,
			hint: validationIssue.hint,
		});
	});
}

function flowchartSchemaRef(
	contractIssue: ContractIssueLike,
	spec: NormalizedFlowchartSpec,
): CodeModeIssueRef {
	const path = pathForContractIssue(contractIssue.path);
	const specPath = path === "input" ? "spec" : `spec.${path}`;
	const [collection, index] = contractIssue.path;
	if (collection === "nodes" && typeof index === "number") {
		const nodeId = spec.nodes[index]?.id;
		return {
			kind: "node",
			...(nodeId ? { id: nodeId } : {}),
			path: specPath,
		};
	}
	if (collection === "edges" && typeof index === "number") {
		const edgeId = spec.edges[index]?.id;
		return {
			kind: "edge",
			...(edgeId ? { id: edgeId } : {}),
			path: specPath,
		};
	}
	if (collection === "groups" && typeof index === "number") {
		const groupId = spec.groups?.[index]?.id;
		return {
			kind: "group",
			...(groupId ? { id: groupId } : {}),
			path: specPath,
		};
	}
	if (collection === "lanes" && typeof index === "number") {
		const laneId = spec.lanes?.[index]?.id;
		return {
			kind: "lane",
			...(laneId ? { id: laneId } : {}),
			path: specPath,
		};
	}
	return { kind: "diagram", id: spec.id, path: specPath };
}

function flowchartSchemaIssues(
	error: ContractErrorLike,
	spec: NormalizedFlowchartSpec,
): CodeModeIssue[] {
	return error.issues.slice(0, FLOWCHART_MAX_ISSUES).map((contractIssue) => {
		const ref = flowchartSchemaRef(contractIssue, spec);
		return issue({
			code: codeForContractIssue(contractIssue),
			stage: "flowchart",
			ref,
			message: contractIssue.message,
			hint: `Fix ${ref.path ?? "spec"} so normalization produces a valid canonical flowchart value.`,
		});
	});
}

function qualityIssues(quality: QualityReport): CodeModeIssue[] {
	return quality.checks.map((check) =>
		issue({
			code: CodeModeIssueCodeFromString(check.code),
			severity: check.severity,
			stage: "quality",
			message: check.message,
			hint:
				check.severity === "error"
					? "Repair the structural issue and call buildFlowchart again."
					: "Improve the labels or scope before styling the artifact.",
		}),
	);
}

function CodeModeIssueCodeFromString(value: string): CodeModeIssueCode {
	if (value === "generic_label" || value === "label_too_long" || value === "disconnected_graph") {
		return value;
	}
	return "quality_below_threshold";
}

function requestedFormats(
	input: BuildFlowchartRequest["options"] | ApplyDiagramPatchRequest["options"],
): ArtifactFormat[] {
	return input?.artifactFormats ?? DEFAULT_BUILD_FORMATS;
}

function requestedInlineFormats(
	input: BuildFlowchartRequest["options"] | ApplyDiagramPatchRequest["options"],
): InlineArtifactFormat[] {
	return input?.inlineArtifacts ?? DEFAULT_INLINE_FORMATS;
}

const storedArtifactsForFormats = Effect.fn("codeMode.artifacts.exportFormats")(function* (input: {
	formats: readonly ArtifactFormat[];
	scene: RenderedDiagramScene;
	excalidraw: ExcalidrawScene;
	renderer?: CodeModeArtifactRenderer | undefined;
}) {
	const artifacts: StoredArtifactFormat[] = [];

	for (const format of input.formats) {
		const data = yield* dataForArtifactFormat(input, format);
		artifacts.push({
			format,
			mimeType: ARTIFACT_MIME_TYPES[format],
			data,
			sizeBytes: sizeBytesForArtifactData(data),
		});
	}

	return artifacts;
});

function dataForArtifactFormat(
	input: {
		scene: RenderedDiagramScene;
		excalidraw: ExcalidrawScene;
		renderer?: CodeModeArtifactRenderer | undefined;
	},
	format: ArtifactFormat,
): Effect.Effect<unknown, ArtifactExportError> {
	if (format === "scene") {
		return Effect.succeed(input.scene);
	}

	if (format === "excalidraw") {
		return Effect.succeed(createExcalidrawFile(input.excalidraw));
	}

	if (!input.renderer) {
		return Effect.fail(
			CodeModeArtifactRendererNotConfigured.make({
				message: "PNG artifact rendering is not configured for this runtime.",
			}),
		);
	}

	return input.renderer
		.renderPng({
			scene: input.scene,
			excalidraw: input.excalidraw,
		})
		.pipe(
			Effect.mapError((cause) =>
				CodeModeArtifactRenderFailed.make({ cause, message: cause.message }),
			),
		);
}

function sizeBytesForArtifactData(data: unknown): number {
	if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
		return data.byteLength;
	}

	return jsonSizeBytes(data);
}

function artifactExportIssues(error: ArtifactExportError): CodeModeIssue[] {
	return [
		issue({
			code: "render_failed",
			stage: "export",
			...(error._tag === "CodeModeArtifactRendererNotConfigured"
				? { ref: { kind: "artifact", path: "options.artifactFormats" } }
				: {}),
			message: error.message,
			hint:
				error._tag === "CodeModeArtifactRendererNotConfigured"
					? "Use the hosted Studio Code Mode runtime with its Cloudflare Browser Run binding, or omit png from artifactFormats."
					: "Retry the request; if it keeps failing, inspect the configured renderer.",
		}),
	];
}

function exportIssues(
	validationIssues: ReturnType<typeof validateExcalidrawScene>["issues"],
): CodeModeIssue[] {
	return validationIssues.map((validationIssue) => {
		const code =
			validationIssue.code === "overlapping-arrow-segment"
				? "arrow_overlap"
				: validationIssue.code === "text-overflow"
					? "text_overflow"
					: validationIssue.code.includes("binding") ||
						  validationIssue.code.includes("bound") ||
						  validationIssue.code.includes("endpoint")
						? "arrow_binding_invalid"
						: "export_invalid_scene";

		return issue({
			code,
			stage: "export",
			ref: validationIssue.elementId
				? { kind: "artifact", id: validationIssue.elementId }
				: { kind: "artifact" },
			message: validationIssue.message,
			hint: "Inspect the rendered scene and retry with a simpler layout or patch.",
		});
	});
}

function canvasIssueCode(validationIssue: CanvasValidationIssue): CodeModeIssueCode {
	switch (validationIssue.code) {
		case "duplicate_element_id":
			return "duplicate_element_id";
		case "duplicate_layer_id":
			return "duplicate_layer_id";
		case "empty_canvas":
			return "invalid_canvas_geometry";
		case "invalid_binding":
			return "invalid_canvas_binding";
		case "invalid_composition":
			return "invalid_canvas_composition";
		case "invalid_geometry":
			return "invalid_canvas_geometry";
		case "invalid_icon":
			return "invalid_canvas_icon";
		case "invalid_polygon":
			return "invalid_polygon";
		case "label_overflow":
			return "invalid_canvas_geometry";
		case "limit_exceeded":
			return "canvas_limit_exceeded";
		case "missing_z_order_element":
		case "duplicate_z_order_element":
		case "unknown_z_order_element":
			return "invalid_z_order";
		case "unknown_layout_target":
			return "unknown_layout_target";
	}
}

function canvasValidationIssues(
	validationIssues: readonly CanvasValidationIssue[],
): CodeModeIssue[] {
	return validationIssues.slice(0, MAX_INPUT_ISSUES).map((validationIssue) =>
		issue({
			code: canvasIssueCode(validationIssue),
			stage: "canvas",
			ref: validationIssue.elementId
				? {
						kind: "element",
						id: validationIssue.elementId,
						path: validationIssue.path,
					}
				: { kind: "diagram", path: validationIssue.path },
			message: validationIssue.message,
			hint: "Repair the referenced CanvasSpec field and call createCanvas again.",
		}),
	);
}

function canvasExportIssues(
	validationIssues: ReturnType<typeof validateExcalidrawScene>["issues"],
): CodeModeIssue[] {
	return exportIssues(
		// Canvas authoring permits intentional overlaps and connector crossings;
		// these quality diagnostics are not hard structural export failures.
		validationIssues.filter(
			(validationIssue) =>
				validationIssue.code !== "overlapping-arrow-segment" &&
				validationIssue.code !== "arrow-segment-through-node",
		),
	);
}

function normalizePatchableScene(scene: PatchableScene): RenderedDiagramScene | null {
	const elements: Array<RenderedDiagramScene["elements"][number]> = [];

	for (const element of scene.elements) {
		if (element.type === "arrow") {
			const first = element.points[0];
			const second = element.points[1];
			const rest = element.points.slice(2);
			if (!first || !second) {
				return null;
			}
			const points: [ScenePoint, ScenePoint, ...ScenePoint[]] = [first, second, ...rest];
			elements.push({
				...element,
				type: "arrow",
				id: element.id,
				edgeId: element.edgeId,
				sourceNodeId: element.sourceNodeId,
				targetNodeId: element.targetNodeId,
				...(element.strokeColor ? { strokeColor: element.strokeColor } : {}),
				...(element.strokeStyle ? { strokeStyle: element.strokeStyle } : {}),
				...(element.textColor ? { textColor: element.textColor } : {}),
				points,
				...(element.label ? { label: element.label } : {}),
			});
			continue;
		}

		if (element.type === "node") {
			const polygonPoints = element.points;
			if (
				element.shape === "polygon" &&
				(!polygonPoints || !polygonPoints[0] || !polygonPoints[1] || !polygonPoints[2])
			) {
				return null;
			}
			elements.push({
				type: "node",
				id: element.id,
				nodeId: element.nodeId,
				...(element.kind ? { kind: element.kind } : {}),
				...(element.icon ? { icon: { slug: element.icon.slug, size: element.icon.size } } : {}),
				shape: element.shape,
				...(element.fillColor ? { fillColor: element.fillColor } : {}),
				...(element.strokeColor ? { strokeColor: element.strokeColor } : {}),
				x: element.x,
				y: element.y,
				width: element.width,
				height: element.height,
				label: element.label,
				...(element.frameId ? { frameId: element.frameId } : {}),
				...(element.groupIds ? { groupIds: [...element.groupIds] } : {}),
				...(element.layerId ? { layerId: element.layerId } : {}),
				...(element.locked !== undefined ? { locked: element.locked } : {}),
				...(element.opacity !== undefined ? { opacity: element.opacity } : {}),
				...(element.zIndex !== undefined ? { zIndex: element.zIndex } : {}),
				...(element.fillStyle ? { fillStyle: element.fillStyle } : {}),
				...(element.roughness !== undefined ? { roughness: element.roughness } : {}),
				...(element.strokeStyle ? { strokeStyle: element.strokeStyle } : {}),
				...(element.strokeWidth !== undefined ? { strokeWidth: element.strokeWidth } : {}),
				...((element.rendererRole === "sequence-lifeline" &&
					isStructurallyValidSequenceLifeline(scene, element)) ||
				(element.rendererRole === "sequence-activation" &&
					isStructurallyValidSequenceActivation(scene, element)) ||
				(element.rendererRole === "timeline-marker" &&
					isStructurallyValidTimelineMarker(element)) ||
				(element.rendererRole === "chart-mark" && isStructurallyValidChartMark(element)) ||
				(element.rendererRole === "gantt-mark" && isStructurallyValidGanttMark(element)) ||
				(element.rendererRole === "state-marker" && isStructurallyValidStateMarker(element)) ||
				(element.rendererRole === "er-table" && isStructurallyValidErTable(element)) ||
				(element.rendererRole === "er-optional" && isStructurallyValidErOptional(element)) ||
				(element.rendererRole === "class-box" && isStructurallyValidClassBox(element)) ||
				((element.rendererRole === "swimlane" || element.rendererRole === "swimlane-header") &&
					element.shape === "rectangle" &&
					!element.icon)
					? { rendererRole: element.rendererRole }
					: {}),
				...(element.textColor ? { textColor: element.textColor } : {}),
				...(element.shape === "polygon" &&
				polygonPoints?.[0] &&
				polygonPoints[1] &&
				polygonPoints[2]
					? {
							points: [
								polygonPoints[0],
								polygonPoints[1],
								polygonPoints[2],
								...polygonPoints.slice(3),
							],
						}
					: {}),
			});
			continue;
		}

		if (element.type === "line") {
			const first = element.points[0];
			const second = element.points[1];
			if (!first || !second) return null;
			elements.push({
				...element,
				points: [first, second, ...element.points.slice(2)],
			});
			continue;
		}

		elements.push(structuredClone(element));
	}

	return {
		kind: scene.kind,
		version: scene.version,
		diagramId: scene.diagramId,
		title: scene.title,
		width: scene.width,
		height: scene.height,
		accentColor: scene.accentColor,
		backgroundColor: scene.backgroundColor,
		elements,
		layers: structuredClone(scene.layers),
		layouts: structuredClone(scene.layouts),
		zOrder: [...scene.zOrder],
	};
}

/** The authored view of a scene: node icon references without derived SVG bytes. */
function withoutIconAssets(scene: RenderedDiagramScene): RenderedDiagramScene {
	const { icons: _icons, ...rest } = scene;
	return rest;
}

function cloneScene(scene: PatchableScene): PatchableScene {
	return structuredClone(scene);
}

function sourceConnectivity(scene: PatchableScene): string[] {
	return scene.elements
		.flatMap((element) => {
			if (element.type === "arrow") {
				return [`arrow:${element.id}:${element.sourceNodeId}->${element.targetNodeId}`];
			}
			if (element.type === "line") {
				return [
					`line:${element.id}:${element.startBinding?.elementId ?? ""}->${element.endBinding?.elementId ?? ""}`,
				];
			}
			return [];
		})
		.sort();
}

function sameConnectivity(left: readonly string[], right: readonly string[]) {
	return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function nodeElements(scene: PatchableScene): PatchableNode[] {
	return scene.elements.filter((element): element is PatchableNode => element.type === "node");
}

function textElements(scene: PatchableScene): PatchableText[] {
	return scene.elements.filter((element): element is PatchableText => element.type === "text");
}

function arrowElements(scene: PatchableScene): PatchableArrow[] {
	return scene.elements.filter((element): element is PatchableArrow => element.type === "arrow");
}

function labelsMatch(labels: readonly string[] | undefined, value: string | undefined): boolean {
	if (!labels || labels.length === 0 || !value) {
		return false;
	}
	const normalized = value.trim().toLowerCase();
	return labels.some((label) => label.trim().toLowerCase() === normalized);
}

function selectorHasFilters(selector: DiagramSelector | undefined): boolean {
	return Boolean(
		selector &&
		((selector.ids?.length ?? 0) > 0 ||
			(selector.nodeIds?.length ?? 0) > 0 ||
			(selector.edgeIds?.length ?? 0) > 0 ||
			(selector.kinds?.length ?? 0) > 0 ||
			(selector.labels?.length ?? 0) > 0),
	);
}

function resolveTargets(
	scene: PatchableScene,
	selector: DiagramSelector | undefined,
): SelectorTargets {
	const scope = selector?.scope ?? "all";
	const hasFilters = selectorHasFilters(selector);
	const ids = new Set(selector?.ids ?? []);
	const nodeIds = new Set(selector?.nodeIds ?? []);
	const edgeIds = new Set(selector?.edgeIds ?? []);
	const kinds = new Set(selector?.kinds ?? []);
	const nodes = nodeElements(scene).filter((node) => {
		if (scope === "edges") {
			return false;
		}
		if (!selector || !hasFilters) {
			return true;
		}
		return (
			ids.has(node.id) ||
			nodeIds.has(node.nodeId) ||
			(node.kind ? [...kinds].some((kind) => kind === node.kind) : false) ||
			labelsMatch(selector.labels, node.label)
		);
	});
	const arrows = arrowElements(scene).filter((arrow) => {
		if (scope === "nodes") {
			return false;
		}
		if (!selector || !hasFilters) {
			return true;
		}
		return (
			ids.has(arrow.id) || edgeIds.has(arrow.edgeId) || labelsMatch(selector.labels, arrow.label)
		);
	});
	const nodeElementIds = new Set(nodes.map((node) => node.id));
	const arrowElementIds = new Set(arrows.map((arrow) => arrow.id));
	const texts = textElements(scene).filter((text) => {
		if (!selector || !hasFilters) {
			if (scope === "nodes") {
				return text.containerId ? nodeElementIds.has(text.containerId) : false;
			}
			if (scope === "edges") {
				return text.containerId ? arrowElementIds.has(text.containerId) : false;
			}
			return true;
		}
		return (
			ids.has(text.id) ||
			(text.containerId ? nodeElementIds.has(text.containerId) : false) ||
			(text.containerId ? arrowElementIds.has(text.containerId) : false) ||
			labelsMatch(selector.labels, text.text)
		);
	});

	return { arrows, nodes, texts };
}

function targetIssue(operation: DiagramPatchOperation): CodeModeIssue {
	return issue({
		code: "unknown_patch_target",
		stage: "flowchart",
		ref: { kind: "request", path: "operations.selector" },
		message: `Patch operation "${operation.op}" did not match any scene element.`,
		hint: "Use nodeIds, edgeIds, ids, kinds, labels, or scope values that exist in the accepted artifact.",
	});
}

function textForContainer(scene: PatchableScene, containerId: string): PatchableText | undefined {
	return textElements(scene).find(
		(text) => text.containerId === containerId || text.id === `${containerId}:label`,
	);
}

function centerTextOnNode(scene: PatchableScene, node: PatchableNode): void {
	const text = textForContainer(scene, node.id);
	if (!text) {
		return;
	}
	text.x = node.x + node.width / 2;
	text.y = node.y + node.height / 2;
}

function midpoint(points: readonly PatchablePoint[]): PatchablePoint | undefined {
	const first = points[0];
	const last = points[points.length - 1];
	if (!first || !last) {
		return undefined;
	}
	return {
		x: (first.x + last.x) / 2,
		y: (first.y + last.y) / 2 - 10,
	};
}

function syncArrowLabel(scene: PatchableScene, arrow: PatchableArrow): void {
	const label = textForContainer(scene, arrow.id);
	const point = midpoint(arrow.points);
	if (label && !label.containerId) {
		const start = arrow.points[0];
		if (!start) return;
		const next = arrow.points.find((point) => point.x !== start.x || point.y !== start.y);
		if (!next) return;
		const text = wrapTextToWidth(label.text, label.maxWidth ?? 160, label.fontSize);
		const width = wrappedLabelWidth(text, label.fontSize, label.maxWidth ?? 160);
		const height = Math.ceil(text.split("\n").length * label.fontSize * 1.35);
		label.x = (start.x + next.x) / 2 + (start.x === next.x ? width / 2 + 8 : 0);
		label.y = (start.y + next.y) / 2 - (start.y === next.y ? height / 2 + 5 : 0);
		return;
	}
	if (!label || !point) {
		return;
	}
	label.x = point.x;
	label.y = point.y;
}

function translatePoint(point: PatchablePoint, dx: number, dy: number): PatchablePoint {
	return { x: point.x + dx, y: point.y + dy };
}

function applyStyle(
	scene: PatchableScene,
	operation: Extract<DiagramPatchOperation, { op: "setDefaultStyle" | "setStyle" }>,
): CodeModeIssue[] {
	if (operation.style.backgroundColor) {
		scene.backgroundColor = operation.style.backgroundColor;
	}

	if (operation.op === "setDefaultStyle") {
		if (operation.style.strokeColor) {
			scene.accentColor = operation.style.strokeColor;
		}
		for (const node of nodeElements(scene)) {
			if (operation.style.fillColor) {
				node.fillColor = operation.style.fillColor;
			}
			if (operation.style.strokeColor) {
				node.strokeColor = operation.style.strokeColor;
			}
			if (operation.style.textColor) {
				node.textColor = operation.style.textColor;
			}
		}
		for (const arrow of arrowElements(scene)) {
			if (operation.style.strokeColor) {
				arrow.strokeColor = operation.style.strokeColor;
			}
			if (operation.style.textColor) {
				arrow.textColor = operation.style.textColor;
			}
		}
		for (const text of textElements(scene)) {
			if (operation.style.textColor) {
				text.textColor = operation.style.textColor;
			}
		}
		return [];
	}

	const targets = resolveTargets(scene, operation.selector);
	if (targets.nodes.length === 0 && targets.arrows.length === 0 && targets.texts.length === 0) {
		return [targetIssue(operation)];
	}

	for (const node of targets.nodes) {
		if (operation.style.fillColor) {
			node.fillColor = operation.style.fillColor;
		}
		if (operation.style.strokeColor) {
			node.strokeColor = operation.style.strokeColor;
		}
		if (operation.style.textColor) {
			node.textColor = operation.style.textColor;
			const text = textForContainer(scene, node.id);
			if (text) {
				text.textColor = operation.style.textColor;
			}
		}
	}
	for (const arrow of targets.arrows) {
		if (operation.style.strokeColor) {
			arrow.strokeColor = operation.style.strokeColor;
		}
		if (operation.style.textColor) {
			arrow.textColor = operation.style.textColor;
			const text = textForContainer(scene, arrow.id);
			if (text) {
				text.textColor = operation.style.textColor;
			}
		}
	}
	for (const text of targets.texts) {
		if (operation.style.textColor) {
			text.textColor = operation.style.textColor;
		}
	}

	return [];
}

function rerouteConnectedArrows(scene: PatchableScene, nodeIds: readonly string[]): void {
	const movedNodeIds = new Set(nodeIds);
	for (const arrow of arrowElements(scene)) {
		if (movedNodeIds.has(arrow.sourceNodeId) || movedNodeIds.has(arrow.targetNodeId)) {
			rerouteArrow(scene, arrow);
		}
	}
}

function applyShape(
	scene: PatchableScene,
	operation: Extract<DiagramPatchOperation, { op: "setShape" }>,
): CodeModeIssue[] {
	const targets = resolveTargets(scene, operation.selector);
	if (targets.nodes.length === 0) {
		return [targetIssue(operation)];
	}

	const resizedNodeIds: string[] = [];
	for (const node of targets.nodes) {
		node.shape = operation.shape;
		if (operation.shape === "polygon") {
			node.points = [
				{ x: node.width / 2, y: 0 },
				{ x: node.width, y: node.height / 2 },
				{ x: node.width / 2, y: node.height },
				{ x: 0, y: node.height / 2 },
			];
		} else {
			delete node.points;
		}
		if (operation.shape === "circle") {
			const size = Math.max(node.width, node.height);
			node.x -= (size - node.width) / 2;
			node.y -= (size - node.height) / 2;
			node.width = size;
			node.height = size;
			resizedNodeIds.push(node.nodeId);
		}
		centerTextOnNode(scene, node);
	}
	rerouteConnectedArrows(scene, resizedNodeIds);
	return [];
}

function applyTranslate(
	scene: PatchableScene,
	operation: Extract<DiagramPatchOperation, { op: "translate" }>,
): CodeModeIssue[] {
	const targets = resolveTargets(scene, operation.selector);
	if (targets.nodes.length === 0 && targets.arrows.length === 0 && targets.texts.length === 0) {
		return [targetIssue(operation)];
	}

	const movedNodeIds = new Set<string>();
	const movedTextIds = new Set<string>();

	for (const node of targets.nodes) {
		node.x += operation.dx;
		node.y += operation.dy;
		movedNodeIds.add(node.nodeId);
		const text = textForContainer(scene, node.id);
		if (text) {
			text.x += operation.dx;
			text.y += operation.dy;
			movedTextIds.add(text.id);
		}
	}

	for (const arrow of targets.arrows) {
		arrow.points = arrow.points.map((point) => translatePoint(point, operation.dx, operation.dy));
		const label = textForContainer(scene, arrow.id);
		if (label) {
			label.x += operation.dx;
			label.y += operation.dy;
			movedTextIds.add(label.id);
		}
	}

	for (const text of targets.texts) {
		if (!movedTextIds.has(text.id)) {
			text.x += operation.dx;
			text.y += operation.dy;
		}
	}

	rerouteConnectedArrows(scene, [...movedNodeIds]);
	recomputeSceneBounds(scene);
	return [];
}

function applyReplaceText(
	scene: PatchableScene,
	operation: Extract<DiagramPatchOperation, { op: "replaceText" }>,
): CodeModeIssue[] {
	const targets = resolveTargets(scene, operation.selector);
	if (targets.nodes.length === 0 && targets.arrows.length === 0 && targets.texts.length === 0) {
		return [targetIssue(operation)];
	}

	for (const node of targets.nodes) {
		node.label = operation.text;
		const text = textForContainer(scene, node.id);
		if (text) {
			text.text = operation.text;
		}
	}
	for (const arrow of targets.arrows) {
		arrow.label = operation.text;
		const text = textForContainer(scene, arrow.id);
		if (text) {
			text.text = operation.text;
		}
	}
	for (const text of targets.texts) {
		text.text = operation.text;
	}

	return [];
}

function nodeCenter(node: PatchableNode): PatchablePoint {
	return {
		x: node.x + node.width / 2,
		y: node.y + node.height / 2,
	};
}

function edgePoint(
	source: PatchableNode,
	target: PatchableNode,
	coincidentRole: "source" | "target",
): PatchablePoint {
	const sourceCenter = nodeCenter(source);
	const targetCenter = nodeCenter(target);
	const dx = targetCenter.x - sourceCenter.x;
	const dy = targetCenter.y - sourceCenter.y;

	// Opposite faces prevent a route between coincident centers from collapsing.
	if (dx === 0 && dy === 0) {
		return {
			x: sourceCenter.x,
			y: coincidentRole === "source" ? source.y + source.height : source.y,
		};
	}

	if (Math.abs(dx) > Math.abs(dy)) {
		if (dx >= 0) {
			return { x: source.x + source.width, y: sourceCenter.y };
		}
		return { x: source.x, y: sourceCenter.y };
	}

	if (dy >= 0) {
		return { x: sourceCenter.x, y: source.y + source.height };
	}
	return { x: sourceCenter.x, y: source.y };
}

function rerouteArrow(scene: PatchableScene, arrow: PatchableArrow): CodeModeIssue[] {
	const nodesById = new Map(nodeElements(scene).map((node) => [node.nodeId, node]));
	const source = nodesById.get(arrow.sourceNodeId);
	const target = nodesById.get(arrow.targetNodeId);
	if (!source || !target) {
		return [
			issue({
				code: "patch_output_invalid",
				stage: "render",
				ref: { kind: "edge", id: arrow.edgeId },
				message: `Arrow "${arrow.id}" references a node that is not in the scene.`,
				hint: "Rebuild the diagram with buildFlowchart or buildMindmap before applying visual patches.",
			}),
		];
	}

	// A curved connector, a mindmap branch, is redrawn as a curve, not an elbow.
	if (arrow.curved) {
		arrow.points = curvedConnectorBetween(source, target).map((point) => ({ ...point }));
		syncArrowLabel(scene, arrow);
		return [];
	}
	const start = edgePoint(source, target, "source");
	const end = edgePoint(target, source, "target");
	const vertical = Math.abs(end.y - start.y) >= Math.abs(end.x - start.x);
	if (vertical) {
		const midY = (start.y + end.y) / 2;
		arrow.points = [start, { x: start.x, y: midY }, { x: end.x, y: midY }, end];
	} else {
		const midX = (start.x + end.x) / 2;
		arrow.points = [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end];
	}
	syncArrowLabel(scene, arrow);
	return [];
}

function applyRerouteEdges(
	scene: PatchableScene,
	operation: Extract<DiagramPatchOperation, { op: "rerouteEdges" }>,
): CodeModeIssue[] {
	const targets = resolveTargets(scene, operation.selector);
	if (targets.arrows.length === 0) {
		return [targetIssue(operation)];
	}
	return targets.arrows.flatMap((arrow) => rerouteArrow(scene, arrow));
}

function recomputeSceneBounds(scene: PatchableScene): void {
	let maxX = scene.width;
	let maxY = scene.height;
	for (const element of scene.elements) {
		if (element.type === "arrow" || element.type === "line") {
			for (const point of element.points) {
				maxX = Math.max(maxX, point.x);
				maxY = Math.max(maxY, point.y);
			}
		} else if (element.type === "text") {
			maxX = Math.max(maxX, element.x + (element.maxWidth ?? 0));
			maxY = Math.max(maxY, element.y + element.fontSize);
		} else {
			maxX = Math.max(maxX, element.x + element.width);
			maxY = Math.max(maxY, element.y + element.height);
		}
	}
	scene.width = maxX + SCENE_PADDING;
	scene.height = maxY + SCENE_PADDING;
}

function patchTargetIds(scene: PatchableScene, selector: DiagramSelector): Set<string> {
	const targets = resolveTargets(scene, selector);
	const ids = new Set([
		...targets.nodes.map((element) => element.id),
		...targets.arrows.map((element) => element.id),
		...targets.texts.map((element) => element.id),
	]);
	const explicitIds = new Set(selector.ids ?? []);
	for (const element of scene.elements) {
		if (explicitIds.has(element.id)) ids.add(element.id);
	}
	return ids;
}

function anchoredIndex(
	order: readonly string[],
	beforeId: string | undefined,
	afterId: string | undefined,
): number | undefined {
	if (beforeId && afterId) return undefined;
	if (beforeId) {
		const index = order.indexOf(beforeId);
		return index >= 0 ? index : undefined;
	}
	if (afterId) {
		const index = order.indexOf(afterId);
		return index >= 0 ? index + 1 : undefined;
	}
	return order.length;
}

function structuralOperationIssue(
	operation: DiagramPatchOperation,
	message: string,
): CodeModeIssue[] {
	return [
		issue({
			code: "patch_output_invalid",
			stage: "canvas",
			ref: { kind: "request", path: "operations" },
			message,
			hint: `Repair the ${operation.op} operation and preserve unique, stable element ids.`,
		}),
	];
}

function applyInsert(
	scene: PatchableScene,
	operation: Extract<DiagramPatchOperation, { op: "insert" }>,
): CodeModeIssue[] {
	const existingIds = new Set(scene.elements.map((element) => element.id));
	const insertedIds = operation.elements.map((element) => element.id);
	if (
		new Set(insertedIds).size !== insertedIds.length ||
		insertedIds.some((id) => existingIds.has(id))
	) {
		return structuralOperationIssue(
			operation,
			"Inserted elements must use ids that are unique within the canvas.",
		);
	}
	const index = anchoredIndex(scene.zOrder, operation.beforeId, operation.afterId);
	if (index === undefined) {
		return structuralOperationIssue(
			operation,
			"Insert specifies an unknown anchor or both beforeId and afterId.",
		);
	}
	scene.elements.push(...operation.elements.map((element) => structuredClone(element)));
	scene.zOrder.splice(index, 0, ...insertedIds);
	return [];
}

function applyRemove(
	scene: PatchableScene,
	operation: Extract<DiagramPatchOperation, { op: "remove" }>,
): CodeModeIssue[] {
	const removedIds = patchTargetIds(scene, operation.selector);
	if (removedIds.size === 0) return [targetIssue(operation)];
	const removedNodeIds = new Set(
		scene.elements.flatMap((element) =>
			element.type === "node" && removedIds.has(element.id) ? [element.nodeId] : [],
		),
	);
	let previousSize: number;
	do {
		previousSize = removedIds.size;
		for (const element of scene.elements) {
			if (
				(element.type === "text" &&
					((element.containerId && removedIds.has(element.containerId)) ||
						arrowElements(scene).some(
							(arrow) =>
								removedIds.has(arrow.id) && textForContainer(scene, arrow.id)?.id === element.id,
						))) ||
				(element.type === "arrow" &&
					(removedNodeIds.has(element.sourceNodeId) || removedNodeIds.has(element.targetNodeId))) ||
				(element.type === "line" &&
					((element.startBinding && removedIds.has(element.startBinding.elementId)) ||
						(element.endBinding && removedIds.has(element.endBinding.elementId))))
			) {
				removedIds.add(element.id);
			}
		}
	} while (removedIds.size !== previousSize);
	const retained = scene.elements
		.filter((element) => !removedIds.has(element.id))
		.map((element) => {
			if (element.frameId && removedIds.has(element.frameId)) {
				const { frameId: _removedFrameId, ...retainedElement } = element;
				return retainedElement;
			}
			return element;
		});
	scene.elements.splice(0, scene.elements.length, ...retained);
	const retainedOrder = scene.zOrder.filter((id) => !removedIds.has(id));
	scene.zOrder.splice(0, scene.zOrder.length, ...retainedOrder);
	const layouts = scene.layouts
		.map((layout) => ({
			...layout,
			ids: layout.ids.filter((id) => !removedIds.has(id)),
		}))
		.filter((layout) => layout.ids.length > 0);
	scene.layouts.splice(0, scene.layouts.length, ...layouts);
	recomputeSceneBounds(scene);
	return [];
}

function applyReplace(
	scene: PatchableScene,
	operation: Extract<DiagramPatchOperation, { op: "replace" }>,
): CodeModeIssue[] {
	const index = scene.elements.findIndex((element) => element.id === operation.id);
	if (index < 0) return [targetIssue(operation)];
	if (operation.element.id !== operation.id) {
		return structuralOperationIssue(
			operation,
			"Replacement element id must match the stable id being replaced.",
		);
	}
	scene.elements.splice(index, 1, structuredClone(operation.element));
	recomputeSceneBounds(scene);
	return [];
}

function applyReorder(
	scene: PatchableScene,
	operation: Extract<DiagramPatchOperation, { op: "reorder" }>,
): CodeModeIssue[] {
	const selected = new Set(operation.ids);
	if (
		selected.size !== operation.ids.length ||
		operation.ids.some((id) => !scene.zOrder.includes(id))
	) {
		return structuralOperationIssue(
			operation,
			"Reorder ids must be unique ids already present in zOrder.",
		);
	}
	const remaining = scene.zOrder.filter((id) => !selected.has(id));
	const index = anchoredIndex(remaining, operation.beforeId, operation.afterId);
	if (index === undefined) {
		return structuralOperationIssue(
			operation,
			"Reorder specifies an unknown anchor or both beforeId and afterId.",
		);
	}
	remaining.splice(index, 0, ...operation.ids);
	scene.zOrder.splice(0, scene.zOrder.length, ...remaining);
	return [];
}

function applyGroup(
	scene: PatchableScene,
	operation: Extract<DiagramPatchOperation, { op: "group" | "ungroup" }>,
): CodeModeIssue[] {
	const ids = new Set(operation.ids);
	if (operation.ids.some((id) => !scene.elements.some((element) => element.id === id))) {
		return [targetIssue(operation)];
	}
	const grouped = scene.elements.map((element) => {
		if (!ids.has(element.id)) return element;
		if (operation.op === "group") {
			return {
				...element,
				groupIds: [...new Set([...(element.groupIds ?? []), operation.groupId])],
			};
		}
		return {
			...element,
			groupIds: operation.groupId
				? (element.groupIds ?? []).filter((id) => id !== operation.groupId)
				: [],
		};
	});
	scene.elements.splice(0, scene.elements.length, ...grouped);
	return [];
}

function applyPatchOperation(
	scene: PatchableScene,
	operation: DiagramPatchOperation,
): CodeModeIssue[] {
	switch (operation.op) {
		case "setDefaultStyle":
		case "setStyle":
			return applyStyle(scene, operation);
		case "setShape":
			return applyShape(scene, operation);
		case "translate":
			return applyTranslate(scene, operation);
		case "replaceText":
			return applyReplaceText(scene, operation);
		case "rerouteEdges":
			return applyRerouteEdges(scene, operation);
		case "insert":
			return applyInsert(scene, operation);
		case "remove":
			return applyRemove(scene, operation);
		case "replace":
			return applyReplace(scene, operation);
		case "reorder":
			return applyReorder(scene, operation);
		case "group":
		case "ungroup":
			return applyGroup(scene, operation);
	}
}

const resolvePatchSource = Effect.fn("codeMode.patch.resolveSource")(function* (
	input: ApplyDiagramPatchRequest,
) {
	if ("scene" in input.source) {
		return { scene: cloneScene(input.source.scene) };
	}

	const store = yield* CodeModeArtifactStorage;
	const manifest = yield* store.readManifest(input.source.artifactId).pipe(
		Effect.mapError(
			(error) =>
				new ApplyDiagramPatchFailure({
					status: "storage_failed",
					context: {
						issues: [storageIssue(error.message, "storage_read_failed")],
					},
				}),
		),
	);
	if (
		!manifest ||
		manifest.artifactId !== input.source.artifactId ||
		!manifest.formats.some((format) => format.format === "scene")
	) {
		return yield* new ApplyDiagramPatchFailure({
			status: "source_unavailable",
			context: {
				issues: [
					issue({
						code: "patch_source_unavailable",
						stage: "storage",
						ref: { kind: "artifact", id: input.source.artifactId },
						message: `Artifact "${input.source.artifactId}" does not have a valid source manifest.`,
						hint: "Rebuild with the appropriate build operation and patch the accepted artifact id.",
					}),
				],
			},
		});
	}

	const artifact = yield* store.read(input.source.artifactId, "scene").pipe(
		Effect.mapError(
			(error) =>
				new ApplyDiagramPatchFailure({
					status: "storage_failed",
					context: {
						issues: [storageIssue(error.message, "storage_read_failed")],
					},
				}),
		),
	);
	if (!artifact) {
		return yield* new ApplyDiagramPatchFailure({
			status: "source_unavailable",
			context: {
				issues: [
					issue({
						code: "patch_source_unavailable",
						stage: "storage",
						ref: { kind: "artifact", id: input.source.artifactId },
						message: `Scene artifact "${input.source.artifactId}" is not available.`,
						hint: "Call buildFlowchart or buildMindmap first, then patch the accepted artifact id.",
					}),
				],
			},
		});
	}

	const parsed = Schema.decodeUnknownResult(RenderedDiagramSceneSchema, {
		errors: "all",
		reportInput: true,
	})(artifact.data);
	if (!Result.isSuccess(parsed)) {
		return yield* new ApplyDiagramPatchFailure({
			status: "source_unavailable",
			context: {
				issues: [
					issue({
						code: "patch_source_unavailable",
						stage: "storage",
						ref: { kind: "artifact", id: input.source.artifactId },
						message: `Scene artifact "${input.source.artifactId}" could not be decoded.`,
						hint: "Rebuild with the appropriate build operation and patch the new artifact.",
					}),
				],
			},
		});
	}

	return {
		scene: cloneScene(parsed.success),
		sourceArtifactId: input.source.artifactId,
	};
});

function responseRequestId(requestId: string | undefined) {
	return requestId ? { requestId } : {};
}

function withArtifactUrls(
	artifact: ArtifactBundle,
	artifactUrl: CodeModeRuntimeOptions["artifactUrl"],
) {
	if (!artifactUrl) {
		return artifact;
	}

	const formats = artifact.formats.map((formatRef) => ({
		...formatRef,
		url: artifactUrl({
			artifactId: artifact.artifactId,
			format: formatRef.format,
		}),
	}));
	const preview = artifact.preview
		? formats.find((formatRef) => formatRef.format === artifact.preview?.format)
		: undefined;

	return {
		...artifact,
		formats,
		...(preview ? { preview } : {}),
	};
}

function scenePartial(scene: RenderedDiagramScene): PartialArtifactBundle {
	return {
		diagramId: scene.diagramId,
		formats: [
			{
				format: "scene",
				mimeType: ARTIFACT_MIME_TYPES.scene,
				inline: scene,
				sizeBytes: jsonSizeBytes(scene),
			},
		],
	};
}

function failureResult<Status extends string, Context>(error: {
	readonly status: Status;
	readonly context: Context;
}) {
	return { ok: false as const, status: error.status, ...error.context };
}

function storageFailureIssue(
	error: CodeModeArtifactStorageError,
	code: "storage_read_failed" | "storage_write_failed",
) {
	return storageIssue(error.message, code);
}

const exportAndStoreScene = Effect.fn("codeMode.artifacts.exportAndStore")(function* (input: {
	scene: RenderedDiagramScene;
	formats: readonly ArtifactFormat[];
	inlineFormats: InlineArtifactFormat[];
	requestId?: string;
	provenance?: ArtifactBundle["provenance"];
	validationIssues: typeof exportIssues;
}) {
	const environment = yield* CodeModeRuntimeEnvironment;
	const store = yield* CodeModeArtifactStorage;
	const { excalidraw, validation } = yield* Effect.sync(() => {
		const excalidraw = convertSceneToExcalidraw(input.scene);
		return { excalidraw, validation: validateExcalidrawScene(excalidraw) };
	}).pipe(Effect.withSpan("codeMode.artifacts.exportValidate"));
	const issues = input.validationIssues(validation.issues);
	if (issues.length > 0) {
		return yield* new ArtifactExportFailure({
			status: "export_failed",
			issues,
		});
	}
	const formats = yield* storedArtifactsForFormats({
		formats: input.formats,
		scene: input.scene,
		excalidraw,
		renderer: environment.renderer,
	}).pipe(
		Effect.mapError(
			(error) =>
				new ArtifactExportFailure({
					status: "export_failed",
					issues: artifactExportIssues(error),
				}),
		),
	);
	const artifactId = yield* Effect.sync(() => environment.createId("artifact"));
	const artifact = yield* withTelemetryCorrelation(
		store
			.write({
				artifactId,
				diagramId: input.scene.diagramId,
				formats,
				inlineFormats: input.inlineFormats,
				...(input.provenance ? { provenance: input.provenance } : {}),
			})
			.pipe(Effect.withSpan("codeMode.artifacts.store")),
		{
			artifactId,
			...(input.requestId ? { requestId: input.requestId } : {}),
		},
	).pipe(
		Effect.mapError(
			(cause) =>
				new ArtifactStorageFailure({
					status: "storage_failed",
					cause,
					issues: [storageFailureIssue(cause, "storage_write_failed")],
				}),
		),
	);
	return withArtifactUrls(artifact, environment.artifactUrl);
});

const buildMindmapWorkflow = Effect.fn("codeMode.buildMindmap.workflow")(function* (
	input: unknown,
) {
	const preflightIssues = preflightMindmapInput(input);
	if (preflightIssues.length > 0) {
		return yield* new BuildMindmapFailure({
			status: "invalid_mindmap",
			context: { issues: preflightIssues },
		});
	}

	const parsed = Schema.decodeUnknownResult(BuildMindmapRequestSchema, {
		errors: "all",
		reportInput: true,
	})(input);
	if (!Result.isSuccess(parsed)) {
		return yield* new BuildMindmapFailure({
			status: "invalid_input",
			context: {
				issues: inputIssues(formatContractSchemaError(parsed.failure)),
			},
		});
	}

	const environment = yield* CodeModeRuntimeEnvironment;

	const request = parsed.success;
	const buildId = yield* Effect.sync(() => environment.createId("build"));
	const normalizedSpec = normalizeMindmapSpec(request.spec);
	const baseContext = {
		buildId,
		...responseRequestId(request.requestId),
		normalizedSpec,
	};
	const validationIssues = validateNormalizedMindmap(normalizedSpec);
	if (validationIssues.length > 0) {
		return yield* new BuildMindmapFailure({
			status: "invalid_mindmap",
			context: { ...baseContext, issues: validationIssues },
		});
	}

	const diagram = yield* Effect.try({
		try: () => toMindmapDiagram(normalizedSpec),
		catch: (cause) =>
			new BuildMindmapFailure({
				status: "invalid_mindmap",
				context: {
					...baseContext,
					issues: [
						issue({
							code: "disconnected_graph",
							stage: "mindmap",
							ref: { kind: "diagram", id: normalizedSpec.id },
							message: cause instanceof Error ? cause.message : "Mindmap failed core validation.",
							hint: "Repair the nested topic hierarchy and call buildMindmap again.",
						}),
					],
				},
			}),
	});
	const quality = mindmapQuality(
		diagram,
		request.options?.minQualityScore ?? DEFAULT_MIN_QUALITY_SCORE,
	);
	const qualityContext = { ...baseContext, quality };
	if (!quality.accepted) {
		return yield* new BuildMindmapFailure({
			status: "quality_failed",
			context: { ...qualityContext, issues: qualityIssues(quality) },
		});
	}

	const scene = yield* Effect.try({
		try: () => renderMindmapDiagram(diagram),
		catch: (cause) =>
			new BuildMindmapFailure({
				status: "render_failed",
				context: {
					...qualityContext,
					issues: [
						issue({
							code: "render_failed",
							stage: "render",
							ref: { kind: "diagram", id: normalizedSpec.id },
							message: cause instanceof Error ? cause.message : "Unable to render mindmap scene.",
							hint: "Simplify the hierarchy or retry with a smaller mindmap.",
						}),
					],
				},
			}),
	}).pipe(Effect.withSpan("codeMode.buildMindmap.render"));
	const exportContext = { ...qualityContext, partial: scenePartial(scene) };
	const artifact = yield* exportAndStoreScene({
		scene,
		formats: requestedFormats(request.options),
		inlineFormats: requestedInlineFormats(request.options),
		...(request.requestId ? { requestId: request.requestId } : {}),
		validationIssues: exportIssues,
	}).pipe(
		Effect.mapError(
			(error) =>
				new BuildMindmapFailure({
					status: error.status,
					context: {
						...(error.status === "export_failed"
							? exportContext
							: {
									...qualityContext,
									partial: { diagramId: scene.diagramId },
								}),
						issues: error.issues,
					},
				}),
		),
	);

	return {
		ok: true,
		status: "accepted",
		buildId,
		...responseRequestId(request.requestId),
		normalizedSpec,
		quality,
		artifact,
		issues: [],
	} satisfies Extract<BuildMindmapResult, { ok: true }>;
});

const buildSequenceDiagramWorkflow = Effect.fn("codeMode.buildSequenceDiagram.workflow")(function* (
	input: unknown,
) {
	const parsed = Schema.decodeUnknownResult(BuildSequenceDiagramRequestSchema, {
		errors: "all",
		reportInput: true,
	})(input);
	if (!Result.isSuccess(parsed)) {
		return yield* new BuildSequenceDiagramFailure({
			status: "invalid_input",
			context: {
				issues: inputIssues(formatContractSchemaError(parsed.failure)),
			},
		});
	}

	const environment = yield* CodeModeRuntimeEnvironment;

	const request = parsed.success;
	const buildId = yield* Effect.sync(() => environment.createId("build"));
	const authoredSpec = normalizeSequenceDiagramSpec(request.spec);
	const resolvedIcons = resolveNodeIcons(authoredSpec.participants, environment.icons, {
		noun: "participant",
		path: "participants",
	});
	const normalizedSpec = { ...authoredSpec, participants: resolvedIcons.nodes };
	const baseContext = {
		buildId,
		...responseRequestId(request.requestId),
		normalizedSpec,
	};
	const validationIssues = validateNormalizedSequenceDiagram(normalizedSpec);
	if (validationIssues.length > 0) {
		return yield* new BuildSequenceDiagramFailure({
			status: "invalid_sequence",
			context: { ...baseContext, issues: validationIssues },
		});
	}

	const quality = sequenceQuality(
		normalizedSpec,
		request.options?.minQualityScore ?? DEFAULT_MIN_QUALITY_SCORE,
	);
	const qualityContext = { ...baseContext, quality };
	if (!quality.accepted) {
		return yield* new BuildSequenceDiagramFailure({
			status: "quality_failed",
			context: { ...qualityContext, issues: qualityIssues(quality) },
		});
	}

	const renderedScene = yield* Effect.try({
		try: () => renderSequenceDiagram(toSequenceDiagram(normalizedSpec)),
		catch: (cause) =>
			new BuildSequenceDiagramFailure({
				status: "render_failed",
				context: {
					...qualityContext,
					issues: [
						issue({
							code: "render_failed",
							stage: "render",
							ref: { kind: "diagram", id: normalizedSpec.id },
							message:
								cause instanceof Error ? cause.message : "Unable to render sequence diagram scene.",
							hint: "Repair the participant/message structure and retry.",
						}),
					],
				},
			}),
	}).pipe(Effect.withSpan("codeMode.buildSequenceDiagram.render"));
	const embedded = yield* embedSceneIcons(renderedScene, environment.icons);
	const scene = embedded.scene;
	const canvasIssues = getCanvasValidationIssues(scene);
	if (canvasIssues.length > 0) {
		return yield* new BuildSequenceDiagramFailure({
			status: "render_failed",
			context: {
				...qualityContext,
				issues: canvasValidationIssues(canvasIssues).map((entry) => ({
					...entry,
					hint: "Reduce participant label lines, participants, or messages and retry buildSequenceDiagram.",
				})),
			},
		});
	}
	const exportContext = { ...qualityContext, partial: scenePartial(scene) };
	const artifact = yield* exportAndStoreScene({
		scene,
		formats: requestedFormats(request.options),
		inlineFormats: requestedInlineFormats(request.options),
		...(request.requestId ? { requestId: request.requestId } : {}),
		validationIssues: exportIssues,
	}).pipe(
		Effect.mapError(
			(error) =>
				new BuildSequenceDiagramFailure({
					status: error.status,
					context: {
						...(error.status === "export_failed" ? exportContext : qualityContext),
						issues: error.issues,
					},
				}),
		),
	);

	return {
		ok: true,
		status: "accepted",
		buildId,
		...responseRequestId(request.requestId),
		normalizedSpec,
		quality,
		artifact,
		issues: [...resolvedIcons.issues, ...embedded.issues],
	} satisfies Extract<BuildSequenceDiagramResult, { ok: true }>;
});

const buildStateMachineWorkflow = Effect.fn("codeMode.buildStateMachine.workflow")(function* (
	input: unknown,
) {
	const parsed = Schema.decodeUnknownResult(BuildStateMachineRequestSchema, {
		errors: "all",
		reportInput: true,
	})(input);
	if (!Result.isSuccess(parsed)) {
		return yield* new BuildStateMachineFailure({
			status: "invalid_input",
			context: {
				issues: inputIssues(formatContractSchemaError(parsed.failure)),
			},
		});
	}

	const environment = yield* CodeModeRuntimeEnvironment;
	const request = parsed.success;
	const buildId = yield* Effect.sync(() => environment.createId("build"));
	const normalizedSpec = normalizeStateMachineSpec(request.spec);
	const baseContext = {
		buildId,
		...responseRequestId(request.requestId),
		normalizedSpec,
	};
	const validationIssues = validateNormalizedStateMachine(normalizedSpec);
	if (validationIssues.length > 0) {
		return yield* new BuildStateMachineFailure({
			status: "invalid_state_machine",
			context: { ...baseContext, issues: validationIssues },
		});
	}

	const quality = stateMachineQuality(
		normalizedSpec,
		request.options?.minQualityScore ?? DEFAULT_MIN_QUALITY_SCORE,
	);
	const qualityContext = { ...baseContext, quality };
	if (!quality.accepted) {
		return yield* new BuildStateMachineFailure({
			status: "quality_failed",
			context: { ...qualityContext, issues: qualityIssues(quality) },
		});
	}

	const scene = yield* Effect.try({
		try: () => renderStateMachineDiagram(toStateMachineDiagram(normalizedSpec)),
		catch: (cause) =>
			new BuildStateMachineFailure({
				status: "render_failed",
				context: {
					...qualityContext,
					issues: [
						issue({
							code: "render_failed",
							stage: "render",
							ref: { kind: "diagram", id: normalizedSpec.id },
							message:
								cause instanceof Error ? cause.message : "Unable to render state machine scene.",
							hint: "Repair the state and transition structure and retry.",
						}),
					],
				},
			}),
	}).pipe(Effect.withSpan("codeMode.buildStateMachine.render"));
	const canvasIssues = getCanvasValidationIssues(scene);
	if (canvasIssues.length > 0) {
		return yield* new BuildStateMachineFailure({
			status: "render_failed",
			context: {
				...qualityContext,
				issues: canvasValidationIssues(canvasIssues).map((entry) => ({
					...entry,
					hint: "Shorten state labels or split the machine and retry buildStateMachine.",
				})),
			},
		});
	}
	const exportContext = { ...qualityContext, partial: scenePartial(scene) };
	const artifact = yield* exportAndStoreScene({
		scene,
		formats: requestedFormats(request.options),
		inlineFormats: requestedInlineFormats(request.options),
		...(request.requestId ? { requestId: request.requestId } : {}),
		validationIssues: exportIssues,
	}).pipe(
		Effect.mapError(
			(error) =>
				new BuildStateMachineFailure({
					status: error.status,
					context: {
						...(error.status === "export_failed" ? exportContext : qualityContext),
						issues: error.issues,
					},
				}),
		),
	);

	return {
		ok: true,
		status: "accepted",
		buildId,
		...responseRequestId(request.requestId),
		normalizedSpec,
		quality,
		artifact,
		issues: [],
	} satisfies Extract<BuildStateMachineResult, { ok: true }>;
});

const buildErDiagramWorkflow = Effect.fn("codeMode.buildErDiagram.workflow")(function* (
	input: unknown,
) {
	const parsed = Schema.decodeUnknownResult(BuildErDiagramRequestSchema, {
		errors: "all",
		reportInput: true,
	})(resolveErRequest(input));
	if (!Result.isSuccess(parsed)) {
		return yield* new BuildErDiagramFailure({
			status: "invalid_input",
			context: {
				issues: inputIssues(formatContractSchemaError(parsed.failure)),
			},
		});
	}

	const environment = yield* CodeModeRuntimeEnvironment;
	const request = parsed.success;
	const buildId = yield* Effect.sync(() => environment.createId("build"));
	const normalizedSpec = normalizeErSpec(request.spec);
	const baseContext = {
		buildId,
		...responseRequestId(request.requestId),
		normalizedSpec,
	};
	const validationIssues = validateNormalizedEr(normalizedSpec);
	if (validationIssues.length > 0) {
		return yield* new BuildErDiagramFailure({
			status: "invalid_er_diagram",
			context: { ...baseContext, issues: validationIssues },
		});
	}

	const quality = erQuality(
		normalizedSpec,
		request.options?.minQualityScore ?? DEFAULT_MIN_QUALITY_SCORE,
	);
	const qualityContext = { ...baseContext, quality };
	if (!quality.accepted) {
		return yield* new BuildErDiagramFailure({
			status: "quality_failed",
			context: { ...qualityContext, issues: qualityIssues(quality) },
		});
	}

	const scene = yield* Effect.try({
		try: () => renderErDiagram(toErDiagram(normalizedSpec)),
		catch: (cause) =>
			new BuildErDiagramFailure({
				status: "render_failed",
				context: {
					...qualityContext,
					issues: [
						issue({
							code: "render_failed",
							stage: "render",
							ref: { kind: "diagram", id: normalizedSpec.id },
							message: cause instanceof Error ? cause.message : "Unable to render ER scene.",
							hint: "Repair the entities and relationships and retry.",
						}),
					],
				},
			}),
	}).pipe(Effect.withSpan("codeMode.buildErDiagram.render"));
	const canvasIssues = getCanvasValidationIssues(scene);
	if (canvasIssues.length > 0) {
		return yield* new BuildErDiagramFailure({
			status: "render_failed",
			context: {
				...qualityContext,
				issues: canvasValidationIssues(canvasIssues).map((entry) => ({
					...entry,
					hint: "Shorten entity or field names, or split the schema, and retry buildErDiagram.",
				})),
			},
		});
	}
	const exportContext = { ...qualityContext, partial: scenePartial(scene) };
	const artifact = yield* exportAndStoreScene({
		scene,
		formats: requestedFormats(request.options),
		inlineFormats: requestedInlineFormats(request.options),
		...(request.requestId ? { requestId: request.requestId } : {}),
		validationIssues: exportIssues,
	}).pipe(
		Effect.mapError(
			(error) =>
				new BuildErDiagramFailure({
					status: error.status,
					context: {
						...(error.status === "export_failed" ? exportContext : qualityContext),
						issues: error.issues,
					},
				}),
		),
	);

	return {
		ok: true,
		status: "accepted",
		buildId,
		...responseRequestId(request.requestId),
		normalizedSpec,
		quality,
		artifact,
		issues: [],
	} satisfies Extract<BuildErDiagramResult, { ok: true }>;
});

const buildClassDiagramWorkflow = Effect.fn("codeMode.buildClassDiagram.workflow")(function* (
	input: unknown,
) {
	const parsed = Schema.decodeUnknownResult(BuildClassDiagramRequestSchema, {
		errors: "all",
		reportInput: true,
	})(resolveClassRequest(input));
	if (!Result.isSuccess(parsed)) {
		return yield* new BuildClassDiagramFailure({
			status: "invalid_input",
			context: {
				issues: inputIssues(formatContractSchemaError(parsed.failure)),
			},
		});
	}

	const environment = yield* CodeModeRuntimeEnvironment;
	const request = parsed.success;
	const buildId = yield* Effect.sync(() => environment.createId("build"));
	const normalizedSpec = normalizeClassSpec(request.spec);
	const baseContext = {
		buildId,
		...responseRequestId(request.requestId),
		normalizedSpec,
	};
	const validationIssues = validateNormalizedClass(normalizedSpec);
	if (validationIssues.length > 0) {
		return yield* new BuildClassDiagramFailure({
			status: "invalid_class_diagram",
			context: { ...baseContext, issues: validationIssues },
		});
	}

	const quality = classQuality(
		normalizedSpec,
		request.options?.minQualityScore ?? DEFAULT_MIN_QUALITY_SCORE,
	);
	const qualityContext = { ...baseContext, quality };
	if (!quality.accepted) {
		return yield* new BuildClassDiagramFailure({
			status: "quality_failed",
			context: { ...qualityContext, issues: qualityIssues(quality) },
		});
	}

	const scene = yield* Effect.try({
		try: () => renderClassDiagram(toClassDiagram(normalizedSpec)),
		catch: (cause) =>
			new BuildClassDiagramFailure({
				status: "render_failed",
				context: {
					...qualityContext,
					issues: [
						issue({
							code: "render_failed",
							stage: "render",
							ref: { kind: "diagram", id: normalizedSpec.id },
							message:
								cause instanceof Error ? cause.message : "Unable to render class diagram scene.",
							hint: "Repair the classes and relationships and retry.",
						}),
					],
				},
			}),
	}).pipe(Effect.withSpan("codeMode.buildClassDiagram.render"));
	const canvasIssues = getCanvasValidationIssues(scene);
	if (canvasIssues.length > 0) {
		return yield* new BuildClassDiagramFailure({
			status: "render_failed",
			context: {
				...qualityContext,
				issues: canvasValidationIssues(canvasIssues).map((entry) => ({
					...entry,
					hint: "Shorten class or member names, or split the model, and retry buildClassDiagram.",
				})),
			},
		});
	}
	const exportContext = { ...qualityContext, partial: scenePartial(scene) };
	const artifact = yield* exportAndStoreScene({
		scene,
		formats: requestedFormats(request.options),
		inlineFormats: requestedInlineFormats(request.options),
		...(request.requestId ? { requestId: request.requestId } : {}),
		validationIssues: exportIssues,
	}).pipe(
		Effect.mapError(
			(error) =>
				new BuildClassDiagramFailure({
					status: error.status,
					context: {
						...(error.status === "export_failed" ? exportContext : qualityContext),
						issues: error.issues,
					},
				}),
		),
	);

	return {
		ok: true,
		status: "accepted",
		buildId,
		...responseRequestId(request.requestId),
		normalizedSpec,
		quality,
		artifact,
		issues: [],
	} satisfies Extract<BuildClassDiagramResult, { ok: true }>;
});

const buildTimelineWorkflow = Effect.fn("codeMode.buildTimeline.workflow")(function* (
	input: unknown,
) {
	const parsed = Schema.decodeUnknownResult(BuildTimelineRequestSchema, {
		errors: "all",
		reportInput: true,
	})(input);
	if (!Result.isSuccess(parsed)) {
		return yield* new BuildTimelineFailure({
			status: "invalid_input",
			context: {
				issues: inputIssues(formatContractSchemaError(parsed.failure)),
			},
		});
	}

	const environment = yield* CodeModeRuntimeEnvironment;

	const request = parsed.success;
	const buildId = yield* Effect.sync(() => environment.createId("build"));
	const normalizedSpec = normalizeTimelineSpec(request.spec);
	const baseContext = {
		buildId,
		...responseRequestId(request.requestId),
		normalizedSpec,
	};
	const validationIssues = validateNormalizedTimeline(normalizedSpec);
	if (validationIssues.length > 0) {
		return yield* new BuildTimelineFailure({
			status: "invalid_timeline",
			context: { ...baseContext, issues: validationIssues },
		});
	}

	const quality = timelineQuality(
		normalizedSpec,
		request.options?.minQualityScore ?? DEFAULT_MIN_QUALITY_SCORE,
	);
	const qualityContext = { ...baseContext, quality };
	if (!quality.accepted) {
		return yield* new BuildTimelineFailure({
			status: "quality_failed",
			context: { ...qualityContext, issues: qualityIssues(quality) },
		});
	}

	const renderedScene = yield* Effect.try({
		try: () => renderTimelineDiagram(toTimelineDiagram(normalizedSpec)),
		catch: (cause) =>
			new BuildTimelineFailure({
				status: "render_failed",
				context: {
					...qualityContext,
					issues: [
						issue({
							code: "render_failed",
							stage: "render",
							ref: { kind: "diagram", id: normalizedSpec.id },
							message: cause instanceof Error ? cause.message : "Unable to render timeline scene.",
							hint: "Repair the event dates and ordering and retry.",
						}),
					],
				},
			}),
	}).pipe(Effect.withSpan("codeMode.buildTimeline.render"));
	const scene = renderedScene;
	const canvasIssues = getCanvasValidationIssues(scene);
	if (canvasIssues.length > 0) {
		return yield* new BuildTimelineFailure({
			status: "render_failed",
			context: {
				...qualityContext,
				issues: canvasValidationIssues(canvasIssues).map((entry) => ({
					...entry,
					hint: "Split the chronology into smaller timelines and retry buildTimeline.",
				})),
			},
		});
	}
	const exportContext = { ...qualityContext, partial: scenePartial(scene) };
	const artifact = yield* exportAndStoreScene({
		scene,
		formats: requestedFormats(request.options),
		inlineFormats: requestedInlineFormats(request.options),
		...(request.requestId ? { requestId: request.requestId } : {}),
		validationIssues: exportIssues,
	}).pipe(
		Effect.mapError(
			(error) =>
				new BuildTimelineFailure({
					status: error.status,
					context: {
						...(error.status === "export_failed" ? exportContext : qualityContext),
						issues: error.issues,
					},
				}),
		),
	);

	return {
		ok: true,
		status: "accepted",
		buildId,
		...responseRequestId(request.requestId),
		normalizedSpec,
		quality,
		artifact,
		issues: [],
	} satisfies Extract<BuildTimelineResult, { ok: true }>;
});

const buildChartWorkflow = Effect.fn("codeMode.buildChart.workflow")(function* (input: unknown) {
	const parsed = Schema.decodeUnknownResult(BuildChartRequestSchema, {
		errors: "all",
		reportInput: true,
	})(input);
	if (!Result.isSuccess(parsed)) {
		return yield* new BuildChartFailure({
			status: "invalid_input",
			context: {
				issues: inputIssues(formatContractSchemaError(parsed.failure)),
			},
		});
	}

	const environment = yield* CodeModeRuntimeEnvironment;

	const request = parsed.success;
	const buildId = yield* Effect.sync(() => environment.createId("build"));
	const normalizedSpec = normalizeChartSpec(request.spec);
	const baseContext = {
		buildId,
		...responseRequestId(request.requestId),
		normalizedSpec,
	};
	const validationIssues = validateNormalizedChart(normalizedSpec);
	if (validationIssues.length > 0) {
		return yield* new BuildChartFailure({
			status: "invalid_chart",
			context: { ...baseContext, issues: validationIssues },
		});
	}

	const quality = chartQuality(
		normalizedSpec,
		request.options?.minQualityScore ?? DEFAULT_MIN_QUALITY_SCORE,
	);
	const qualityContext = { ...baseContext, quality };
	if (!quality.accepted) {
		return yield* new BuildChartFailure({
			status: "quality_failed",
			context: { ...qualityContext, issues: qualityIssues(quality) },
		});
	}

	const scene = yield* Effect.try({
		try: () => renderChartDiagram(toChartDiagram(normalizedSpec)),
		catch: (cause) =>
			new BuildChartFailure({
				status: "render_failed",
				context: {
					...qualityContext,
					issues: [
						issue({
							code: "render_failed",
							stage: "render",
							ref: { kind: "diagram", id: normalizedSpec.id },
							message: cause instanceof Error ? cause.message : "Unable to render chart scene.",
							hint: "Repair the categories and series values and retry.",
						}),
					],
				},
			}),
	}).pipe(Effect.withSpan("codeMode.buildChart.render"));
	const canvasIssues = getCanvasValidationIssues(scene);
	if (canvasIssues.length > 0) {
		return yield* new BuildChartFailure({
			status: "render_failed",
			context: {
				...qualityContext,
				issues: canvasValidationIssues(canvasIssues).map((entry) => ({
					...entry,
					hint: "Use fewer categories or series and retry buildChart.",
				})),
			},
		});
	}
	const exportContext = { ...qualityContext, partial: scenePartial(scene) };
	const artifact = yield* exportAndStoreScene({
		scene,
		formats: requestedFormats(request.options),
		inlineFormats: requestedInlineFormats(request.options),
		...(request.requestId ? { requestId: request.requestId } : {}),
		validationIssues: exportIssues,
	}).pipe(
		Effect.mapError(
			(error) =>
				new BuildChartFailure({
					status: error.status,
					context: {
						...(error.status === "export_failed" ? exportContext : qualityContext),
						issues: error.issues,
					},
				}),
		),
	);

	return {
		ok: true,
		status: "accepted",
		buildId,
		...responseRequestId(request.requestId),
		normalizedSpec,
		quality,
		artifact,
		issues: [],
	} satisfies Extract<BuildChartResult, { ok: true }>;
});

const buildGanttWorkflow = Effect.fn("codeMode.buildGantt.workflow")(function* (input: unknown) {
	const parsed = Schema.decodeUnknownResult(BuildGanttRequestSchema, {
		errors: "all",
		reportInput: true,
	})(input);
	if (!Result.isSuccess(parsed)) {
		return yield* new BuildGanttFailure({
			status: "invalid_input",
			context: {
				issues: inputIssues(formatContractSchemaError(parsed.failure)),
			},
		});
	}

	const environment = yield* CodeModeRuntimeEnvironment;

	const request = parsed.success;
	const buildId = yield* Effect.sync(() => environment.createId("build"));
	const normalizedSpec = normalizeGanttSpec(request.spec);
	const baseContext = {
		buildId,
		...responseRequestId(request.requestId),
		normalizedSpec,
	};
	const validationIssues = validateNormalizedGantt(normalizedSpec);
	if (validationIssues.length > 0) {
		return yield* new BuildGanttFailure({
			status: "invalid_gantt",
			context: { ...baseContext, issues: validationIssues },
		});
	}

	const quality = ganttQuality(
		normalizedSpec,
		request.options?.minQualityScore ?? DEFAULT_MIN_QUALITY_SCORE,
	);
	const qualityContext = { ...baseContext, quality };
	if (!quality.accepted) {
		return yield* new BuildGanttFailure({
			status: "quality_failed",
			context: { ...qualityContext, issues: qualityIssues(quality) },
		});
	}

	const scene = yield* Effect.try({
		try: () => renderGanttDiagram(toGanttDiagram(normalizedSpec)),
		catch: (cause) =>
			new BuildGanttFailure({
				status: "render_failed",
				context: {
					...qualityContext,
					issues: [
						issue({
							code: "render_failed",
							stage: "render",
							ref: { kind: "diagram", id: normalizedSpec.id },
							message: cause instanceof Error ? cause.message : "Unable to render Gantt scene.",
							hint: "Repair the tasks' dates and dependencies and retry.",
						}),
					],
				},
			}),
	}).pipe(Effect.withSpan("codeMode.buildGantt.render"));
	const canvasIssues = getCanvasValidationIssues(scene);
	if (canvasIssues.length > 0) {
		return yield* new BuildGanttFailure({
			status: "render_failed",
			context: {
				...qualityContext,
				issues: canvasValidationIssues(canvasIssues).map((entry) => ({
					...entry,
					hint: "Use fewer tasks or dependencies and retry buildGantt.",
				})),
			},
		});
	}
	const exportContext = { ...qualityContext, partial: scenePartial(scene) };
	const artifact = yield* exportAndStoreScene({
		scene,
		formats: requestedFormats(request.options),
		inlineFormats: requestedInlineFormats(request.options),
		...(request.requestId ? { requestId: request.requestId } : {}),
		validationIssues: exportIssues,
	}).pipe(
		Effect.mapError(
			(error) =>
				new BuildGanttFailure({
					status: error.status,
					context: {
						...(error.status === "export_failed" ? exportContext : qualityContext),
						issues: error.issues,
					},
				}),
		),
	);

	return {
		ok: true,
		status: "accepted",
		buildId,
		...responseRequestId(request.requestId),
		normalizedSpec,
		quality,
		artifact,
		issues: ganttScheduleWarnings(normalizedSpec),
	} satisfies Extract<BuildGanttResult, { ok: true }>;
});

const RawCreateCanvasInput = Schema.Struct({
	spec: Schema.Unknown,
	requestId: Schema.optionalKey(Schema.Unknown),
});
const RawInlinePatchInput = Schema.Struct({
	source: Schema.Struct({ scene: Schema.Unknown }),
});

const serializedCanvasLimitIssue = Effect.fn("codeMode.canvas.serializedLimit")(
	(canvas: unknown, path: "spec" | "source.scene") =>
		Effect.try(() => jsonSizeBytes(canvas)).pipe(
			Effect.match({
				onFailure: () =>
					issue({
						code: "invalid_type",
						stage: "input",
						ref: { kind: "request", path },
						message: "CanvasSpec could not be serialized as JSON.",
						hint: "Remove non-JSON values or reduce deeply nested fields and retry.",
					}),
				onSuccess: (sizeBytes) =>
					sizeBytes <= CANVAS_LIMITS.maxSerializedBytes
						? undefined
						: issue({
								code: "canvas_limit_exceeded",
								stage: "canvas",
								ref: { kind: "request", path },
								message: `CanvasSpec exceeds ${CANVAS_LIMITS.maxSerializedBytes} serialized bytes.`,
								hint: "Split the visualization into a smaller canvas or reduce repeated text and points.",
							}),
			}),
		),
);

const createCanvasWorkflow = Effect.fn("codeMode.createCanvas.workflow")(function* (
	input: unknown,
) {
	const environment = yield* CodeModeRuntimeEnvironment;
	const buildId = yield* Effect.sync(() => environment.createId("build"));
	const raw = Schema.decodeUnknownResult(RawCreateCanvasInput)(input);
	const rawInput = Result.isSuccess(raw)
		? {
				spec: raw.success.spec,
				requestId: Schema.is(Schema.String)(raw.success.requestId)
					? raw.success.requestId
					: undefined,
			}
		: undefined;
	if (rawInput) {
		const rawIssue = yield* serializedCanvasLimitIssue(rawInput.spec, "spec");
		if (rawIssue) {
			return yield* new CreateCanvasFailure({
				status: rawIssue.code === "canvas_limit_exceeded" ? "limit_exceeded" : "invalid_input",
				context: {
					buildId,
					...responseRequestId(rawInput.requestId),
					issues: [rawIssue],
				},
			});
		}
	}
	const parsed = Schema.decodeUnknownResult(CreateCanvasRequestSchema, {
		errors: "all",
		reportInput: true,
	})(input);
	if (!Result.isSuccess(parsed)) {
		return yield* new CreateCanvasFailure({
			status: "invalid_input",
			context: {
				issues: inputIssues(formatContractSchemaError(parsed.failure)),
			},
		});
	}

	const request = parsed.success;
	const baseContext = {
		buildId,
		...responseRequestId(request.requestId),
	};
	const normalized = normalizePatchableScene(request.spec);
	if (!normalized) {
		return yield* new CreateCanvasFailure({
			status: "invalid_canvas",
			context: {
				...baseContext,
				issues: [
					issue({
						code: "invalid_canvas_geometry",
						stage: "canvas",
						ref: { kind: "request", path: "spec.elements" },
						message: "CanvasSpec contains an invalid point list.",
						hint: "Provide at least two points for lines/connectors and three points for polygons.",
					}),
				],
			},
		});
	}

	const inputLimits = getCanvasValidationIssues(normalized).filter(
		(entry) => entry.code === "limit_exceeded",
	);
	if (inputLimits.length > 0) {
		return yield* new CreateCanvasFailure({
			status: "limit_exceeded",
			context: {
				...baseContext,
				issues: canvasValidationIssues(inputLimits),
			},
		});
	}
	const embedded = yield* embedSceneIcons(compileCanvasSpec(normalized), environment.icons);
	const scene = embedded.scene;
	const normalizedSpec = withoutIconAssets(scene);
	const validationIssues = getCanvasValidationIssues(scene);
	if (validationIssues.length > 0) {
		const issues = canvasValidationIssues(validationIssues);
		return yield* new CreateCanvasFailure({
			status: issues.some((entry) => entry.code === "canvas_limit_exceeded")
				? "limit_exceeded"
				: "invalid_canvas",
			context: {
				...baseContext,
				normalizedSpec,
				issues: [...embedded.issues, ...issues],
			},
		});
	}

	const exportContext = {
		...baseContext,
		normalizedSpec,
		partial: scenePartial(scene),
	};
	const artifact = yield* exportAndStoreScene({
		scene,
		formats: requestedFormats(request.options),
		inlineFormats: requestedInlineFormats(request.options),
		...(request.requestId ? { requestId: request.requestId } : {}),
		validationIssues: canvasExportIssues,
	}).pipe(
		Effect.mapError(
			(error) =>
				new CreateCanvasFailure({
					status: error.status,
					context: {
						...exportContext,
						issues: error.issues,
					},
				}),
		),
	);

	return {
		ok: true,
		status: "accepted",
		buildId,
		...responseRequestId(request.requestId),
		normalizedSpec,
		artifact,
		issues: embedded.issues,
	} satisfies Extract<CreateCanvasResult, { ok: true }>;
});

const buildFlowchartWorkflow = Effect.fn("codeMode.buildFlowchart.workflow")(function* (
	input: unknown,
) {
	const parsed = Schema.decodeUnknownResult(BuildFlowchartRequestSchema, {
		errors: "all",
		reportInput: true,
	})(resolveFlowchartNodeKinds(input));
	if (!Result.isSuccess(parsed)) {
		return yield* new BuildFlowchartFailure({
			status: "invalid_input",
			context: {
				issues: inputIssues(
					formatContractSchemaError(parsed.failure),
					flowchartHintForContractIssue,
				),
			},
		});
	}

	const environment = yield* CodeModeRuntimeEnvironment;

	const request = parsed.success;

	const buildId = yield* Effect.sync(() => environment.createId("build"));
	const authoredSpec = normalizeFlowchartSpec(request.spec);
	const resolvedIcons = resolveNodeIcons(authoredSpec.nodes, environment.icons);
	const normalizedSpec = { ...authoredSpec, nodes: resolvedIcons.nodes };
	const baseContext = {
		buildId,
		...responseRequestId(request.requestId),
		normalizedSpec,
	};
	const parsedDiagram = Schema.decodeUnknownResult(FlowchartDiagramSchema, {
		errors: "all",
		reportInput: true,
	})(flowchartDiagramInput(normalizedSpec));
	if (!Result.isSuccess(parsedDiagram)) {
		return yield* new BuildFlowchartFailure({
			status: "invalid_flowchart",
			context: {
				...baseContext,
				issues: flowchartSchemaIssues(
					formatContractSchemaError(parsedDiagram.failure),
					normalizedSpec,
				),
			},
		});
	}
	const diagram = parsedDiagram.success;
	const validationIssues = canonicalFlowchartIssues(diagram);
	if (validationIssues.length > 0) {
		return yield* new BuildFlowchartFailure({
			status: "invalid_flowchart",
			context: { ...baseContext, issues: validationIssues },
		});
	}
	validateFlowchartDiagram(diagram);

	const quality = assessFlowchartQuality(
		diagram,
		request.options?.minQualityScore ?? DEFAULT_MIN_QUALITY_SCORE,
	);
	const qualityContext = { ...baseContext, quality };
	if (!quality.accepted) {
		return yield* new BuildFlowchartFailure({
			status: "quality_failed",
			context: { ...qualityContext, issues: qualityIssues(quality) },
		});
	}

	const renderedScene = yield* Effect.try({
		try: () => renderIntermediateDiagram(diagram),
		catch: (cause) =>
			new BuildFlowchartFailure({
				status: "render_failed",
				context: {
					...qualityContext,
					issues: [
						issue({
							code: "render_failed",
							stage: "render",
							ref: { kind: "diagram", id: normalizedSpec.id },
							message: cause instanceof Error ? cause.message : "Unable to render flowchart scene.",
							hint: "Simplify the graph or retry with a smaller flowchart.",
						}),
					],
				},
			}),
	}).pipe(Effect.withSpan("codeMode.buildFlowchart.render"));
	const embedded = yield* embedSceneIcons(renderedScene, environment.icons);
	const scene = embedded.scene;
	const exportContext = { ...qualityContext, partial: scenePartial(scene) };
	const artifact = yield* exportAndStoreScene({
		scene,
		formats: requestedFormats(request.options),
		inlineFormats: requestedInlineFormats(request.options),
		...(request.requestId ? { requestId: request.requestId } : {}),
		validationIssues: exportIssues,
	}).pipe(
		Effect.mapError(
			(error) =>
				new BuildFlowchartFailure({
					status: error.status,
					context: {
						...(error.status === "export_failed" ? exportContext : qualityContext),
						issues: error.issues,
					},
				}),
		),
	);

	return {
		ok: true,
		status: "accepted",
		buildId,
		...responseRequestId(request.requestId),
		normalizedSpec,
		quality,
		artifact,
		issues: [...resolvedIcons.issues, ...embedded.issues],
	} satisfies Extract<BuildFlowchartResult, { ok: true }>;
});

const getArtifactWorkflow = Effect.fn("codeMode.getArtifact.workflow")(function* (input: unknown) {
	const parsed = Schema.decodeUnknownResult(GetArtifactRequestSchema, {
		errors: "all",
		reportInput: true,
	})(input);
	if (!Result.isSuccess(parsed)) {
		return yield* new GetArtifactFailure({
			status: "invalid_input",
			context: {
				issues: inputIssues(formatContractSchemaError(parsed.failure)),
			},
		});
	}

	const environment = yield* CodeModeRuntimeEnvironment;
	const store = yield* CodeModeArtifactStorage;
	const request = parsed.success;
	const manifest = yield* store.readManifest(request.artifactId).pipe(
		Effect.mapError(
			(error) =>
				new GetArtifactFailure({
					status: "storage_failed",
					context: {
						issues: [storageFailureIssue(error, "storage_read_failed")],
					},
				}),
		),
	);
	if (!manifest) {
		return yield* new GetArtifactFailure({
			status: "not_found",
			context: {
				issues: [
					issue({
						code: "patch_source_unavailable",
						stage: "storage",
						ref: { kind: "artifact", id: request.artifactId },
						message: `Artifact "${request.artifactId}" was not found.`,
						hint: "Use the artifactId returned by buildFlowchart or applyDiagramPatch.",
					}),
				],
			},
		});
	}

	const format = request.format ?? "scene";
	if (!manifest.formats.some((entry) => entry.format === format)) {
		return yield* new GetArtifactFailure({
			status: "format_unavailable",
			context: {
				issues: [
					issue({
						code: "unsupported_artifact_format",
						stage: "storage",
						ref: { kind: "artifact", id: request.artifactId },
						message: `Artifact "${request.artifactId}" does not include format "${format}".`,
						hint: "Request a format listed in the artifact bundle.",
					}),
				],
			},
		});
	}

	const artifact = yield* store.read(request.artifactId, format).pipe(
		Effect.mapError(
			(error) =>
				new GetArtifactFailure({
					status: "storage_failed",
					context: {
						issues: [storageFailureIssue(error, "storage_read_failed")],
					},
				}),
		),
	);
	if (!artifact) {
		return yield* new GetArtifactFailure({
			status: "format_unavailable",
			context: {
				issues: [
					issue({
						code: "patch_source_unavailable",
						stage: "storage",
						ref: { kind: "artifact", id: request.artifactId },
						message: `Artifact "${request.artifactId}" format "${format}" could not be read.`,
						hint: "Retry retrieval or rebuild the artifact.",
					}),
				],
			},
		});
	}

	return {
		ok: true,
		artifactId: request.artifactId,
		diagramId: manifest.diagramId,
		format,
		mimeType: artifact.mimeType,
		...(environment.artifactUrl
			? {
					url: environment.artifactUrl({
						artifactId: request.artifactId,
						format,
					}),
				}
			: {}),
		...(request.inline !== true || !isInlineArtifactFormat(format)
			? {}
			: { inline: artifact.data }),
		sizeBytes: artifact.sizeBytes,
		...(manifest.provenance ? { provenance: manifest.provenance } : {}),
	} satisfies Extract<GetArtifactResult, { ok: true }>;
});

const applyDiagramPatchWorkflow = Effect.fn("codeMode.applyDiagramPatch.workflow")(function* (
	input: unknown,
) {
	const raw = Schema.decodeUnknownResult(RawInlinePatchInput)(input);
	const rawIssue = Result.isSuccess(raw)
		? yield* serializedCanvasLimitIssue(raw.success.source.scene, "source.scene")
		: undefined;
	if (rawIssue) {
		return yield* new ApplyDiagramPatchFailure({
			status: "invalid_input",
			context: { issues: [rawIssue] },
		});
	}
	const parsed = Schema.decodeUnknownResult(ApplyDiagramPatchRequestSchema, {
		errors: "all",
		reportInput: true,
	})(input);
	if (!Result.isSuccess(parsed)) {
		return yield* new ApplyDiagramPatchFailure({
			status: "invalid_input",
			context: {
				issues: inputIssues(formatContractSchemaError(parsed.failure)),
			},
		});
	}

	const environment = yield* CodeModeRuntimeEnvironment;

	const request = parsed.success;
	const patchId = yield* Effect.sync(() => environment.createId("patch"));
	const baseContext = {
		patchId,
		...responseRequestId(request.requestId),
	};

	const source = yield* resolvePatchSource(request).pipe(
		Effect.mapError(
			(error) =>
				new ApplyDiagramPatchFailure({
					status: error.status,
					context: { ...baseContext, ...error.context },
				}),
		),
	);
	const sourceContext = {
		...baseContext,
		...(source.sourceArtifactId ? { sourceArtifactId: source.sourceArtifactId } : {}),
	};
	const scene = source.scene;
	let sourceLimits: CanvasValidationIssue[];
	// Count limits must hold even when malformed geometry cannot normalize.
	if (scene.elements.length > CANVAS_LIMITS.maxElements) {
		sourceLimits = [
			{
				code: "limit_exceeded",
				message: `Canvas exceeds ${CANVAS_LIMITS.maxElements} elements.`,
				path: "elements",
			},
		];
	} else {
		const normalizedSource = normalizePatchableScene(scene);
		sourceLimits = normalizedSource
			? getCanvasValidationIssues(normalizedSource).filter(
					(entry) => entry.code === "limit_exceeded",
				)
			: [];
	}
	if (sourceLimits.length > 0) {
		return yield* new ApplyDiagramPatchFailure({
			status: "invalid_input",
			context: {
				...sourceContext,
				issues: canvasValidationIssues(sourceLimits),
			},
		});
	}
	const beforeConnectivity = sourceConnectivity(scene);
	let patchIssues: CodeModeIssue[] = [];
	for (const operation of request.operations) {
		patchIssues = applyPatchOperation(scene, operation);
		if (patchIssues.length > 0) break;
	}
	if (patchIssues.length > 0) {
		return yield* new ApplyDiagramPatchFailure({
			status:
				patchIssues[0]?.code === "unknown_patch_target"
					? "target_not_found"
					: "unsupported_operation",
			context: { ...sourceContext, issues: patchIssues },
		});
	}

	if (request.options?.preserveConnectivity !== false) {
		const afterConnectivity = sourceConnectivity(scene);
		if (!sameConnectivity(beforeConnectivity, afterConnectivity)) {
			return yield* new ApplyDiagramPatchFailure({
				status: "connectivity_changed",
				context: {
					...sourceContext,
					issues: [
						issue({
							code: "patch_preserve_connectivity_failed",
							stage: "flowchart",
							ref: { kind: "diagram", id: scene.diagramId },
							message: "Patch changed the diagram edge connectivity.",
							hint: "Use buildFlowchart for process-graph structure or buildMindmap for hierarchy structure.",
						}),
					],
				},
			});
		}
	}

	const renderedScene = normalizePatchableScene(scene);
	if (!renderedScene) {
		return yield* new ApplyDiagramPatchFailure({
			status: "render_failed",
			context: {
				...sourceContext,
				issues: [
					issue({
						code: "patch_output_invalid",
						stage: "render",
						ref: { kind: "diagram", id: scene.diagramId },
						message: "Patched scene has an invalid arrow point list.",
						hint: "Reroute edges or rebuild the flowchart artifact.",
					}),
				],
			},
		});
	}

	const embedded = yield* embedSceneIcons(renderedScene, environment.icons);
	const patchedScene = embedded.scene;
	const structuralIssues = getCanvasValidationIssues(patchedScene);
	if (structuralIssues.length > 0) {
		return yield* new ApplyDiagramPatchFailure({
			status: "render_failed",
			context: {
				...sourceContext,
				partial: scenePartial(patchedScene),
				issues: [...embedded.issues, ...canvasValidationIssues(structuralIssues)],
			},
		});
	}

	const exportContext = {
		...sourceContext,
		partial: scenePartial(patchedScene),
	};
	const artifact = yield* exportAndStoreScene({
		scene: patchedScene,
		formats: requestedFormats(request.options),
		inlineFormats: requestedInlineFormats(request.options),
		...(request.requestId ? { requestId: request.requestId } : {}),
		validationIssues: canvasExportIssues,
		...(source.sourceArtifactId
			? { provenance: { sourceArtifactId: source.sourceArtifactId } }
			: {}),
	}).pipe(
		Effect.mapError(
			(error) =>
				new ApplyDiagramPatchFailure({
					status: error.status,
					context: {
						...(error.status === "export_failed" ? exportContext : sourceContext),
						issues: error.issues,
					},
				}),
		),
	);

	return {
		ok: true,
		status: "accepted",
		patchId,
		...responseRequestId(request.requestId),
		...(source.sourceArtifactId ? { sourceArtifactId: source.sourceArtifactId } : {}),
		artifact,
		issues: embedded.issues,
	} satisfies Extract<ApplyDiagramPatchResult, { ok: true }>;
});

const searchIconsWorkflow = Effect.fn("codeMode.searchIcons.workflow")(function* (input: unknown) {
	const parsed = Schema.decodeUnknownResult(SearchIconsRequestSchema, {
		errors: "all",
		reportInput: true,
	})(input);
	if (!Result.isSuccess(parsed)) {
		return yield* new SearchIconsFailure({
			status: "invalid_input",
			context: {
				issues: inputIssues(formatContractSchemaError(parsed.failure)),
			},
		});
	}
	const environment = yield* CodeModeRuntimeEnvironment;
	const query = cleanToolString(parsed.success.q);
	const icons =
		environment.icons?.search(query, parsed.success.limit ?? DEFAULT_ICON_SEARCH_LIMIT) ?? [];
	return {
		ok: true,
		status: "accepted",
		query,
		icons: icons.map(({ collection, name, slug }) => ({
			collection,
			name,
			slug,
		})),
		issues: environment.icons
			? []
			: [
					issue({
						code: "unknown_icon",
						severity: "warning",
						stage: "input",
						ref: { kind: "request", path: "q" },
						message: "This Sketchi runtime has no icon catalog.",
						hint: "Omit node icons on this host.",
					}),
				],
	} satisfies Extract<SearchIconsResult, { ok: true }>;
});

type CodeModeWorkflowEffect<A> = Effect.Effect<
	A,
	never,
	CodeModeArtifactStorage | CodeModeRuntimeEnvironment
>;

function boundary<A extends ObservableCodeModeResult, E, B extends ObservableCodeModeResult>(
	operation: CodeModeBoundaryOperation,
	workflow: (
		input: unknown,
	) => Effect.Effect<A, E, CodeModeArtifactStorage | CodeModeRuntimeEnvironment>,
	onFailure: (error: E) => B,
): (input: unknown) => CodeModeWorkflowEffect<A | B> {
	return Effect.fn(`codeMode.${operation}`)((input: unknown) =>
		observeCodeModeBoundary(
			operation,
			input,
			workflow(input).pipe(Effect.match({ onFailure, onSuccess: (result) => result })),
		),
	);
}

export const buildFlowchart: (input: unknown) => CodeModeWorkflowEffect<BuildFlowchartResult> =
	boundary("buildFlowchart", buildFlowchartWorkflow, failureResult);

export const buildMindmap: (input: unknown) => CodeModeWorkflowEffect<BuildMindmapResult> =
	boundary("buildMindmap", buildMindmapWorkflow, failureResult);

export const buildSequenceDiagram: (
	input: unknown,
) => CodeModeWorkflowEffect<BuildSequenceDiagramResult> = boundary(
	"buildSequenceDiagram",
	buildSequenceDiagramWorkflow,
	failureResult,
);

export const buildStateMachine: (
	input: unknown,
) => CodeModeWorkflowEffect<BuildStateMachineResult> = boundary(
	"buildStateMachine",
	buildStateMachineWorkflow,
	failureResult,
);

export const buildErDiagram: (input: unknown) => CodeModeWorkflowEffect<BuildErDiagramResult> =
	boundary("buildErDiagram", buildErDiagramWorkflow, failureResult);

export const buildClassDiagram: (
	input: unknown,
) => CodeModeWorkflowEffect<BuildClassDiagramResult> = boundary(
	"buildClassDiagram",
	buildClassDiagramWorkflow,
	failureResult,
);

export const buildTimeline: (input: unknown) => CodeModeWorkflowEffect<BuildTimelineResult> =
	boundary("buildTimeline", buildTimelineWorkflow, failureResult);

/** A bar, line or pie chart from categories and named series of numbers. */
export const buildChart: (input: unknown) => CodeModeWorkflowEffect<BuildChartResult> = boundary(
	"buildChart",
	buildChartWorkflow,
	failureResult,
);

/** A Gantt chart from dated tasks, milestones, phases and finish-to-start dependencies. */
export const buildGantt: (input: unknown) => CodeModeWorkflowEffect<BuildGanttResult> = boundary(
	"buildGantt",
	buildGanttWorkflow,
	failureResult,
);

export const createCanvas: (input: unknown) => CodeModeWorkflowEffect<CreateCanvasResult> =
	boundary("createCanvas", createCanvasWorkflow, failureResult);

export const getArtifact: (input: unknown) => CodeModeWorkflowEffect<GetArtifactResult> = boundary(
	"getArtifact",
	getArtifactWorkflow,
	failureResult,
);

/** Ranked node-logo search; use a returned slug as a node `icon.slug`. */
export const searchIcons: (input: unknown) => CodeModeWorkflowEffect<SearchIconsResult> = boundary(
	"searchIcons",
	searchIconsWorkflow,
	failureResult,
);

export const applyDiagramPatch: (
	input: unknown,
) => CodeModeWorkflowEffect<ApplyDiagramPatchResult> = boundary(
	"applyDiagramPatch",
	applyDiagramPatchWorkflow,
	failureResult,
);
