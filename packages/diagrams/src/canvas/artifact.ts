import { Effect, Result, Schema } from "effect";

import { CodeModeArtifactStorage, isInlineArtifactFormat } from "../build/artifacts.js";
import { boundary, type CodeModeWorkflowEffect } from "../build/boundary.js";
import {
	codeModeInputIssues,
	failureResult,
	FailureContextSchema,
	issue,
	storageFailureIssue,
	workflowFailure,
} from "../build/issues.js";
import { CodeModeRuntimeEnvironment } from "../build/runtime.js";
import {
	GetArtifactRejected,
	GetArtifactRequest,
	type GetArtifactResult,
} from "./artifact-contract.js";

const GetArtifactFailure = workflowFailure(
	"GetArtifactFailure",
	GetArtifactRejected.fields.status,
	GetArtifactRejected.mapFields(({ ok, status, ...context }) => ({
		...context,
		...FailureContextSchema.fields,
	})),
);

const getArtifactWorkflow = Effect.fn("codeMode.getArtifact.workflow")(function* (input: unknown) {
	const parsed = Schema.decodeUnknownResult(GetArtifactRequest, {
		errors: "all",
		reportInput: true,
	})(input);
	if (!Result.isSuccess(parsed)) {
		return yield* GetArtifactFailure.new({
			status: "invalid_input",
			context: {
				issues: codeModeInputIssues(parsed.failure),
			},
		});
	}

	const environment = yield* CodeModeRuntimeEnvironment;
	const store = yield* CodeModeArtifactStorage;
	const request = parsed.success;
	const manifest = yield* store.readManifest(request.artifactId).pipe(
		Effect.mapError((error) =>
			GetArtifactFailure.new({
				status: "storage_failed",
				context: {
					issues: [storageFailureIssue(error, "storage_read_failed")],
				},
			}),
		),
	);
	if (!manifest) {
		return yield* GetArtifactFailure.new({
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
		return yield* GetArtifactFailure.new({
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
		Effect.mapError((error) =>
			GetArtifactFailure.new({
				status: "storage_failed",
				context: {
					issues: [storageFailureIssue(error, "storage_read_failed")],
				},
			}),
		),
	);
	if (!artifact) {
		return yield* GetArtifactFailure.new({
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
		// A flowchart's document is what a reader asks for, so it comes inline unless declined.
		...((request.inline ?? format === "document") && isInlineArtifactFormat(format)
			? { inline: artifact.data }
			: {}),
		sizeBytes: artifact.sizeBytes,
		...(manifest.provenance ? { provenance: manifest.provenance } : {}),
	} satisfies Extract<GetArtifactResult, { ok: true }>;
});

export const getArtifact: (input: unknown) => CodeModeWorkflowEffect<GetArtifactResult> = boundary(
	"getArtifact",
	getArtifactWorkflow,
	failureResult,
);
