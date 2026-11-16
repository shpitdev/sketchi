import { flowchartBuild } from "../../families/flowchart/build.js";
import { decodeFlowchartDocument } from "../../families/flowchart/document.js";
import { applyFlowchartEdits } from "../../families/flowchart/edits.js";
import { type PublishedBuildIssue } from "../result.js";

import { Effect, Result, Schema } from "effect";

import { CodeModeArtifactStorage, type CodeModeArtifactStorageError } from "./artifacts.js";
import { boundary, unknownRecord, type CodeModeWorkflowEffect } from "./boundary.js";
import { runFamilyBuild } from "./builds.js";
import {
	EditFlowchartRejected,
	EditFlowchartRequest,
	type EditFlowchartResult,
} from "./edit-flowchart-contract.js";
import {
	codeModeInputIssues,
	failureResult,
	FailureContextSchema,
	issue,
	responseRequestId,
	storageFailureIssue,
	workflowFailure,
} from "./issues.js";

const EditFlowchartFailure = workflowFailure(
	"EditFlowchartFailure",
	EditFlowchartRejected.fields.status,
	EditFlowchartRejected.mapFields(({ ok, status, ...context }) => ({
		...context,
		...FailureContextSchema.fields,
	})),
);

/** The flowchart document an artifact was built from, or why there is none. */
const storedFlowchartDocument = Effect.fn("codeMode.editFlowchart.readDocument")(function* (
	artifactId: string,
) {
	const store = yield* CodeModeArtifactStorage;
	const readFailure = (error: CodeModeArtifactStorageError) =>
		EditFlowchartFailure.new({
			status: "storage_failed",
			context: { issues: [storageFailureIssue(error, "storage_read_failed")] },
		});
	const stored = yield* store.read(artifactId, "document").pipe(Effect.mapError(readFailure));
	const document = stored ? unknownRecord(stored.data) : undefined;
	const decoded =
		document?.["type"] === "flowchart" ? decodeFlowchartDocument(document["spec"]) : undefined;
	if (decoded && Result.isSuccess(decoded)) return decoded.success;
	const manifest = stored
		? undefined
		: yield* store.readManifest(artifactId).pipe(Effect.mapError(readFailure));
	return yield* EditFlowchartFailure.new({
		status: "not_found",
		context: {
			issues: [
				issue({
					code: "patch_source_unavailable",
					stage: "storage",
					ref: { kind: "artifact", id: artifactId },
					message:
						stored || manifest
							? `Artifact "${artifactId}" holds no flowchart document to edit.`
							: `Artifact "${artifactId}" was not found.`,
					hint: "Edit the artifactId a buildFlowchart or editFlowchart result returned, or build the flowchart again.",
				}),
			],
		},
	});
});

/**
 * Apply edits to the document a flowchart artifact was built from and build the result as a
 * new artifact. Edits that name what the document lacks change nothing and come back as issues.
 */
const editFlowchartWorkflow = Effect.fn("codeMode.editFlowchart.workflow")(function* (
	input: unknown,
) {
	const parsed = Schema.decodeUnknownResult(EditFlowchartRequest, {
		errors: "all",
		reportInput: true,
	})(input);
	if (!Result.isSuccess(parsed)) {
		return yield* EditFlowchartFailure.new({
			status: "invalid_input",
			context: { issues: codeModeInputIssues(parsed.failure) },
		});
	}
	const request = parsed.success;
	const document = yield* storedFlowchartDocument(request.artifactId);
	const edited = applyFlowchartEdits(document, request.edits);
	if (!edited.ok) {
		return yield* EditFlowchartFailure.new({
			status: "invalid_edit",
			context: {
				...responseRequestId(request.requestId),
				issues: edited.issues.map((entry) =>
					issue({
						code: entry.code,
						stage: "input",
						ref: { kind: "diagram", path: entry.path },
						message: entry.message,
						hint: entry.hint,
					}),
				),
			},
		});
	}
	const built = yield* runFamilyBuild(
		flowchartBuild,
		{
			spec: edited.document,
			...(request.request ? { request: request.request } : {}),
			...(request.options ? { options: request.options } : {}),
			...(request.requestId ? { requestId: request.requestId } : {}),
		},
		{ provenance: { sourceArtifactId: request.artifactId } },
	);
	return {
		...built,
		edits: request.edits,
		issues: [
			...edited.notes.map((message): typeof PublishedBuildIssue.Type => ({
				code: "reference_resolved",
				hint: "Use the resolved id in later edits.",
				severity: "info",
				stage: "input",
				message,
			})),
			...built.issues,
		],
	} satisfies Extract<EditFlowchartResult, { ok: true }>;
});

export const editFlowchart: (input: unknown) => CodeModeWorkflowEffect<EditFlowchartResult> =
	boundary("editFlowchart", editFlowchartWorkflow, (error) =>
		"toResult" in error ? error.toResult() : failureResult(error),
	);
