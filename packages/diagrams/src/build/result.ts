import { FLOWCHART_COVERAGE_CODES } from "../families/flowchart/coverage-codes.js";
import { MindmapInputError } from "../families/mindmap/document.js";
import { VennValidationIssueCodeSchema } from "../families/venn/document.js";
import { Schema, type Effect } from "effect";
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
	"duplicate_group_id",
	"unknown_node_group",
	"empty_group",
	"unknown_group_parent",
	"group_cycle",
	"shaped_decision",
	"duplicate_lane_id",
	"unknown_node_lane",
	"lanes_with_groups",
	"invalid_id",
	"duplicate_edge",
	"isolated_node",
	"unknown_member",
	"overlapping_containers",
	"node_without_lane",
	"flowchart_too_small",
	"unknown_edit_target",
	"invalid_edit",
	"sequence_too_large",
	"invalid_timeline_date",
	"duplicate_event_id",
	"invalid_timeline_order",
	"timeline_too_large",
	"invalid_timeline_span",
	"invalid_timeline_lane",
	"chart_too_large",
	"chart_series_mismatch",
	"duplicate_chart_category",
	"invalid_chart_series",
	"invalid_chart_value",
	"invalid_chart_option",
	"state_machine_too_large",
	"invalid_state",
	"unknown_initial_state",
	"invalid_composite",
	"composite_initial_defaulted",
	"final_has_outgoing",
	"underbranched_choice",
	"gantt_too_large",
	"invalid_gantt_date",
	"invalid_gantt_span",
	"invalid_gantt_phase",
	"invalid_gantt_progress",
	"gantt_dependency_cycle",
	"gantt_schedule_conflict",
	"er_too_large",
	"invalid_entity",
	"invalid_field",
	"unknown_relationship_field",
	"invalid_relationship",
	"class_too_large",
	"invalid_class",
	"invalid_member",
	"invalid_generalization",
	"org_chart_too_large",
	"invalid_person",
	"invalid_reporting_line",
	"journey_too_large",
	"invalid_journey_stage",
	"invalid_journey_step",
	"sankey_too_large",
	"invalid_sankey_node",
	"invalid_sankey_flow",
	"sankey_cycle",
	"wireframe_too_large",
	"invalid_screen",
	"invalid_component",
	"quadrant_too_large",
	"invalid_quadrant_point",
	"invalid_quadrant_text",
	"request_too_large",
	"generic_label",
	"label_too_long",
	"quality_below_threshold",
	"render_failed",
	"png_unavailable",
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
	"reference_resolved",
	"icon_dropped",
	"icon_filled",
	"icon_possible",
	...FLOWCHART_COVERAGE_CODES,
	...MindmapInputError.fields.code.literals,
	...VennValidationIssueCodeSchema.literals,
] as const;

export const CodeModeIssueCodeSchema = Schema.Literals(CODE_MODE_ISSUE_CODES);

export type CodeModeIssueCode = typeof CodeModeIssueCodeSchema.Type;

export const CodeModeIssueKindSchema = Schema.Literals([
	"request",
	"diagram",
	"node",
	"edge",
	"group",
	"lane",
	"element",
	"layer",
	"artifact",
]);

export const CodeModeIssueStageSchema = Schema.Literals([
	"input",
	"canvas",
	"flowchart",
	"mindmap",
	"quality",
	"render",
	"export",
	"storage",
	"coverage",
]);

export const CodeModeIssueRef = Schema.Struct({
	kind: CodeModeIssueKindSchema,
	id: Schema.optionalKey(Schema.NonEmptyString),
	path: Schema.optionalKey(Schema.NonEmptyString),
}).annotate({ identifier: undefined });

export interface CodeModeIssueRef extends Schema.Schema.Type<typeof CodeModeIssueRef> {}

export const CodeModeIssue = Schema.Struct({
	code: CodeModeIssueCodeSchema,
	/** info notes report what a build did for the caller; nothing to fix. */
	severity: Schema.Literals(["error", "warning", "info"]),
	stage: CodeModeIssueStageSchema,
	ref: Schema.optionalKey(CodeModeIssueRef),
	message: Schema.NonEmptyString,
	hint: Schema.NonEmptyString,
}).annotate({ identifier: undefined });

export interface CodeModeIssue extends Schema.Schema.Type<typeof CodeModeIssue> {}

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

export const QualityCheckSchema = Schema.Struct({
	code: Schema.String,
	passed: Schema.Boolean,
	severity: Schema.Literals(["error", "warning"]),
	message: Schema.String,
	refs: Schema.Array(CodeModeIssueRef).pipe(Schema.mutable),
});

export const QualityReportSchema = Schema.Struct({
	accepted: Schema.Boolean,
	score: Schema.Number,
	threshold: Schema.Number,
	summary: Schema.Struct({
		nodeCount: Schema.Number,
		edgeCount: Schema.Number,
	}),
	checks: Schema.Array(QualityCheckSchema).pipe(Schema.mutable),
});

import {
	BuildArtifactFormatSchema,
	InlineArtifactFormatSchema,
	type ArtifactBundle,
	type PartialArtifactBundle,
} from "@sketchi/drawing/artifacts";
/** The export choices the common artifact workflow actually needs. */
export const BuildOptions = Schema.Struct({
	artifactFormats: Schema.optionalKey(
		Schema.Array(BuildArtifactFormatSchema).pipe(Schema.mutable).check(Schema.isMinLength(1)),
	),
	inlineArtifacts: Schema.optionalKey(
		Schema.Array(InlineArtifactFormatSchema).pipe(Schema.mutable),
	),
	minQualityScore: Schema.optionalKey(
		Schema.Number.check(Schema.isFinite(), Schema.isBetween({ minimum: 0, maximum: 10 })),
	),
});
export interface BuildOptions extends Schema.Schema.Type<typeof BuildOptions> {}

import { type CanvasSpec } from "@sketchi/drawing";

export interface BuildDelivery {
	readonly requestId?: string;
	readonly options?: BuildOptions;
}
/** The existing export/store workflow and ID source, supplied by the real host. */
export interface ArtifactBuildCapabilities<R> {
	readonly createId: (kind: "build") => string;
	readonly exportScene: (
		scene: CanvasSpec,
		delivery: BuildDelivery,
	) => Effect.Effect<
		ArtifactBundle,
		{
			readonly status: "limit_exceeded" | "export_failed" | "storage_failed";
			readonly partial?: PartialArtifactBundle;
			readonly issues: CodeModeIssue[];
		},
		R
	>;
}
