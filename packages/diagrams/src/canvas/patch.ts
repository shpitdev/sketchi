import { type CodeModeIssue } from "../build/result.js";
import { canvasFailureStatus, canvasValidationIssues } from "../build/scene.js";

import {
	CANVAS_LIMITS,
	CanvasSpec,
	getCanvasValidationIssues,
	type CanvasValidationIssue,
} from "@sketchi/drawing";
import { Effect, Result, Schema } from "effect";

import { CodeModeArtifactStorage, storageIssue } from "../build/artifacts.js";
import { boundary, type CodeModeWorkflowEffect } from "../build/boundary.js";
import {
	exportAndStoreScene,
	requestedFormats,
	requestedInlineFormats,
	scenePartial,
} from "../build/export.js";
import { catalogForRequest, embedSceneIcons } from "../build/icons.js";
import {
	codeModeInputIssues,
	failureResult,
	FailureContextSchema,
	issue,
	responseRequestId,
	workflowFailure,
} from "../build/issues.js";
import { CodeModeRuntimeEnvironment } from "../build/runtime.js";
import { type CanvasInput } from "./input.js";
import {
	canvasExportIssues,
	normalizeCanvasInput,
	serializedCanvasLimitIssue,
} from "./normalize.js";
import {
	ApplyDiagramPatchRejected,
	ApplyDiagramPatchRequest,
	DIAGRAM_PATCH_OPERATION_NAMES,
	type ApplyDiagramPatchResult,
} from "./patch-contract.js";
import { applyPatchOperation, sameConnectivity, sourceConnectivity } from "./patch-operations.js";

const ApplyDiagramPatchFailure = workflowFailure(
	"ApplyDiagramPatchFailure",
	ApplyDiagramPatchRejected.fields.status,
	ApplyDiagramPatchRejected.mapFields(({ ok, status, ...context }) => ({
		...context,
		...FailureContextSchema.fields,
	})),
);

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

function patchInputIssues(error: Schema.SchemaError): CodeModeIssue[] {
	return codeModeInputIssues(error, hintForContractIssue, (path) =>
		isPatchOperationNamePath(path) ? "unsupported_patch_operation" : undefined,
	);
}

const RawInlinePatchInput = Schema.Struct({
	source: Schema.Struct({ scene: Schema.Unknown }),
});

function cloneScene(scene: CanvasInput): CanvasInput {
	return structuredClone(scene);
}

const resolvePatchSource = Effect.fn("codeMode.patch.resolveSource")(function* (
	input: ApplyDiagramPatchRequest,
) {
	if ("scene" in input.source) {
		return { scene: cloneScene(input.source.scene) };
	}

	const store = yield* CodeModeArtifactStorage;
	const manifest = yield* store.readManifest(input.source.artifactId).pipe(
		Effect.mapError((error) =>
			ApplyDiagramPatchFailure.new({
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
		return yield* ApplyDiagramPatchFailure.new({
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

	// A flowchart is changed through its document, so its drawing is never patched.
	if (manifest.formats.some((format) => format.format === "document")) {
		return yield* ApplyDiagramPatchFailure.new({
			status: "unsupported_operation",
			context: {
				issues: [
					issue({
						code: "unsupported_patch_operation",
						stage: "input",
						ref: { kind: "artifact", id: input.source.artifactId },
						message: `Artifact "${input.source.artifactId}" is a flowchart, which is not patched.`,
						hint: "Change it with sketchi.editFlowchart({ artifactId, edits }): colors, shapes, labels and steps are all edits.",
					}),
				],
			},
		});
	}

	const artifact = yield* store.read(input.source.artifactId, "scene").pipe(
		Effect.mapError((error) =>
			ApplyDiagramPatchFailure.new({
				status: "storage_failed",
				context: {
					issues: [storageIssue(error.message, "storage_read_failed")],
				},
			}),
		),
	);
	if (!artifact) {
		return yield* ApplyDiagramPatchFailure.new({
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

	const parsed = Schema.decodeUnknownResult(CanvasSpec, {
		errors: "all",
		reportInput: true,
	})(artifact.data);
	if (!Result.isSuccess(parsed)) {
		return yield* ApplyDiagramPatchFailure.new({
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

const applyDiagramPatchWorkflow = Effect.fn("codeMode.applyDiagramPatch.workflow")(function* (
	input: unknown,
) {
	const raw = Schema.decodeUnknownResult(RawInlinePatchInput)(input);
	const rawIssue = Result.isSuccess(raw)
		? yield* serializedCanvasLimitIssue(raw.success.source.scene, "source.scene")
		: undefined;
	if (rawIssue) {
		return yield* ApplyDiagramPatchFailure.new({
			status: "invalid_input",
			context: { issues: [rawIssue] },
		});
	}
	const parsed = Schema.decodeUnknownResult(ApplyDiagramPatchRequest, {
		errors: "all",
		reportInput: true,
	})(input);
	if (!Result.isSuccess(parsed)) {
		return yield* ApplyDiagramPatchFailure.new({
			status: "invalid_input",
			context: {
				issues: patchInputIssues(parsed.failure),
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
		Effect.mapError((error) =>
			ApplyDiagramPatchFailure.new({
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
				message: `Canvas has ${scene.elements.length} elements, more than the ${CANVAS_LIMITS.maxElements} it may hold.`,
				path: "elements",
			},
		];
	} else {
		const normalizedSource = normalizeCanvasInput(scene);
		sourceLimits = normalizedSource
			? getCanvasValidationIssues(normalizedSource).filter(
					(entry) => entry.code === "limit_exceeded",
				)
			: [];
	}
	if (sourceLimits.length > 0) {
		return yield* ApplyDiagramPatchFailure.new({
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
		return yield* ApplyDiagramPatchFailure.new({
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
			return yield* ApplyDiagramPatchFailure.new({
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

	const renderedScene = normalizeCanvasInput(scene);
	if (!renderedScene) {
		return yield* ApplyDiagramPatchFailure.new({
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

	const embedded = yield* embedSceneIcons(
		renderedScene,
		yield* catalogForRequest(environment.icons, environment.communityIcons, renderedScene.elements),
	);
	const patchedScene = embedded.scene;
	const structuralIssues = getCanvasValidationIssues(patchedScene);
	if (structuralIssues.length > 0) {
		return yield* ApplyDiagramPatchFailure.new({
			status: canvasFailureStatus(structuralIssues),
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
		Effect.mapError((error) =>
			ApplyDiagramPatchFailure.new({
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

export const applyDiagramPatch: (
	input: unknown,
) => CodeModeWorkflowEffect<ApplyDiagramPatchResult> = boundary(
	"applyDiagramPatch",
	applyDiagramPatchWorkflow,
	failureResult,
);
