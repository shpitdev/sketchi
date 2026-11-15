import {
	type ArtifactBuildCapabilities,
	BuildOptions,
	CodeModeIssue,
	QualityReportSchema,
	type QualityReport,
} from "../build.js";
import { Effect, Schema, SchemaIssue } from "effect";
import { SKETCHI_DIAGRAM_STYLE } from "@sketchi/drawing";
import { ArtifactBundleSchema, PartialArtifactBundleSchema } from "@sketchi/drawing/artifacts";

import {
	Mindmap,
	MindmapDocument,
	MindmapInputError,
	checkMindmapSize,
	checkMindmapRoot,
	normalizeMindmap,
	type MindmapTopic,
} from "./document.js";
import { renderMindmap } from "./layout.js";

export const BuildMindmapRequest = Schema.Struct({
	requestId: Schema.optionalKey(Schema.NonEmptyString),
	spec: MindmapDocument,
	options: Schema.optionalKey(BuildOptions),
});
export interface BuildMindmapRequest extends Schema.Schema.Type<typeof BuildMindmapRequest> {}
export const MindmapToolSpec = MindmapDocument.mapFields(({ style: _style, ...fields }) => fields);
export const BuildMindmapToolInputSchema = Schema.Struct({
	requestId: Schema.optionalKey(Schema.NonEmptyString),
	spec: MindmapToolSpec,
});
export type BuildMindmapToolInput = typeof BuildMindmapToolInputSchema.Type;
const Context = Schema.Struct({
	buildId: Schema.optionalKey(Schema.String),
	requestId: Schema.optionalKey(Schema.String),
	normalizedSpec: Schema.optionalKey(Mindmap),
	quality: Schema.optionalKey(QualityReportSchema),
	partial: Schema.optionalKey(PartialArtifactBundleSchema),
	issues: Schema.Array(CodeModeIssue).pipe(Schema.mutable),
});
const Status = Schema.Literals([
	"invalid_input",
	"invalid_mindmap",
	"quality_failed",
	"limit_exceeded",
	"render_failed",
	"export_failed",
	"storage_failed",
]);
export class MindmapBuildFailure extends Schema.TaggedError<
	MindmapBuildFailure,
	{ readonly brand: unique symbol }
>()("MindmapBuildFailure", { status: Status, context: Context }) {}
export const BuildMindmapAccepted = Schema.Struct({
	ok: Schema.Literal(true),
	status: Schema.Literal("accepted"),
	buildId: Schema.String,
	requestId: Schema.optionalKey(Schema.String),
	normalizedSpec: Mindmap,
	quality: QualityReportSchema,
	artifact: ArtifactBundleSchema,
	issues: Schema.Array(CodeModeIssue).pipe(Schema.mutable),
});
export const BuildMindmapRejected = Schema.Struct({
	ok: Schema.Literal(false),
	status: Status,
	...Context.fields,
});
export const BuildMindmapResultSchema = Schema.Union([BuildMindmapAccepted, BuildMindmapRejected]);
export type BuildMindmapResult = typeof BuildMindmapResultSchema.Type;

function policyIssue(error: MindmapInputError): CodeModeIssue {
	return {
		code: error.code,
		severity: "error",
		stage: "mindmap",
		message: error.message,
		hint: error.hint,
	};
}
function assess(document: Mindmap, threshold: number): QualityReport {
	const generic: { id: string; label: string }[] = [];
	let count = 0;
	const visit = (topic: MindmapTopic, path: readonly number[]) => {
		count++;
		if (/^(topic|branch|item|mindmap)$/i.test(topic.label.trim()))
			generic.push({ id: `topic-${path.join("-")}`, label: topic.label });
		topic.children?.forEach((child, index) => visit(child, [...path, index]));
	};
	visit(document.root, [0]);
	const score = Math.max(0, 10 - generic.length * 2);
	return {
		accepted: score >= threshold,
		score,
		threshold,
		summary: { nodeCount: count, edgeCount: count - 1 },
		checks: generic.map((node) => ({
			code: "generic_label",
			passed: false,
			severity: "warning",
			message: `Topic "${node.label}" is too generic.`,
			refs: [{ kind: "node", id: node.id }],
		})),
	};
}

export const decodeMindmapRequest = Effect.fn("Mindmap.decodeRequest")(function* (input: unknown) {
	const spec =
		typeof input === "object" && input !== null && "spec" in input ? input.spec : undefined;
	const root = typeof spec === "object" && spec !== null && "root" in spec ? spec.root : undefined;
	yield* Effect.fromResult(checkMindmapSize(root)).pipe(
		Effect.mapError(
			(error) =>
				new MindmapBuildFailure({
					status: "invalid_mindmap",
					context: { issues: [policyIssue(error)] },
				}),
		),
	);
	const request = yield* Schema.decodeUnknownEffect(BuildMindmapRequest, { errors: "all" })(
		input,
	).pipe(
		Effect.mapError(
			(error) =>
				new MindmapBuildFailure({
					status: "invalid_input",
					context: {
						issues: SchemaIssue.makeFormatterStandardSchemaV1()(error.issue)
							.issues.slice(0, 20)
							.map((entry) => ({
								code: "invalid_type" as const,
								severity: "error" as const,
								stage: "input" as const,
								ref: {
									kind: "request" as const,
									path: (entry.path ?? [])
										.map((part) => (typeof part === "object" ? String(part.key) : String(part)))
										.join("."),
								},
								message: entry.message,
								hint: "Repair the request using the mindmap document schema.",
							})),
					},
				}),
		),
	);
	return request;
});

export const buildMindmap = Effect.fn("Mindmap.build")(function* <R>(
	request: BuildMindmapRequest,
	capabilities: ArtifactBuildCapabilities<R>,
) {
	const document = normalizeMindmap({ ...request.spec, style: SKETCHI_DIAGRAM_STYLE });
	const buildId = yield* Effect.sync(() => capabilities.createId("build"));
	const context = {
		buildId,
		...(request.requestId ? { requestId: request.requestId } : {}),
		normalizedSpec: document,
	};

	yield* Effect.fromResult(checkMindmapRoot(document.root)).pipe(
		Effect.mapError(
			(error) =>
				new MindmapBuildFailure({
					status: "invalid_mindmap",
					context: { ...context, issues: [policyIssue(error)] },
				}),
		),
	);
	const quality = assess(document, request.options?.minQualityScore ?? 8);
	if (!quality.accepted)
		return yield* new MindmapBuildFailure({
			status: "quality_failed",
			context: {
				...context,
				quality,
				issues: quality.checks.map((check) => ({
					code: "generic_label",
					severity: check.severity,
					stage: "quality",
					message: check.message,
					hint: "Use specific topic labels from the request.",
					...(check.refs[0] ? { ref: check.refs[0] } : {}),
				})),
			},
		});
	const scene = yield* Effect.try({
		try: () => renderMindmap(document),
		catch: (cause) =>
			new MindmapBuildFailure({
				status: "render_failed",
				context: {
					...context,
					quality,
					issues: [
						{
							code: "render_failed",
							severity: "error",
							stage: "render",
							message: cause instanceof Error ? cause.message : "Unable to render mindmap scene.",
							hint: "Simplify the hierarchy or retry with a smaller mindmap.",
						},
					],
				},
			}),
	});
	const artifact = yield* capabilities.exportScene(scene, request).pipe(
		Effect.mapError(
			(error) =>
				new MindmapBuildFailure({
					status: error.status,
					context: {
						...context,
						quality,
						partial: error.partial ?? { diagramId: scene.diagramId },
						issues: error.issues,
					},
				}),
		),
	);
	return {
		ok: true as const,
		status: "accepted" as const,
		...context,
		quality,
		artifact,
		issues: [],
	} satisfies typeof BuildMindmapAccepted.Type;
});
