import {
	formatContractSchemaError,
	CodeModeArtifactStorage,
	CodeModeRuntimeEnvironment,
	ExcalidrawFileSchema,
	RenderedDiagramSceneSchema,
	type CodeModeIssue,
} from "@sketchi/diagram-agent";
import { Effect, Schema, Result } from "effect";

import type { PatchedDiagramArtifacts } from "./contracts.js";
import { CliBuildError, CliStorageError, CliValidationError } from "./errors.js";

const INLINE_FORMATS: Array<"scene" | "excalidraw"> = ["scene", "excalidraw"];

/** Bind the offline artifact contract and the services captured by the layer. */
export const withCodeMode = Effect.fn("sketchi.cli.codeMode.with")(function* <A, E, R>(
	artifactStorage: typeof CodeModeArtifactStorage.Service,
	environment: typeof CodeModeRuntimeEnvironment.Service,
	operation: (options: {
		readonly artifactFormats: typeof INLINE_FORMATS;
		readonly inlineArtifacts: typeof INLINE_FORMATS;
	}) => Effect.Effect<A, E, R>,
) {
	return yield* operation({
		artifactFormats: [...INLINE_FORMATS],
		inlineArtifacts: [...INLINE_FORMATS],
	}).pipe(
		Effect.provideService(CodeModeArtifactStorage, artifactStorage),
		Effect.provideService(CodeModeRuntimeEnvironment, environment),
	);
});

export function codeModeFailure(
	result: {
		readonly status: string;
		readonly issues: ReadonlyArray<CodeModeIssue>;
	},
	operation: "build" | "patch",
): CliBuildError | CliStorageError | CliValidationError {
	const first = result.issues[0];
	const message =
		first?.message ??
		`Code Mode${operation === "patch" ? " patch" : ""} failed with ${result.status}.`;
	const hint =
		first?.hint ??
		(operation === "patch"
			? "Repair the patch request and retry."
			: "Repair the document and retry.");
	const details = result.issues.map(
		(issue) => `${issue.code}${issue.ref?.path ? ` (${issue.ref.path})` : ""}: ${issue.message}`,
	);
	const validationStatuses =
		operation === "patch"
			? ["invalid_input", "target_not_found", "unsupported_operation", "connectivity_changed"]
			: [
					"invalid_input",
					"invalid_flowchart",
					"invalid_mindmap",
					"invalid_sequence",
					"quality_failed",
				];
	if (validationStatuses.includes(result.status))
		return CliValidationError.make({ message, hint, details });
	if (result.status === "storage_failed")
		return CliStorageError.make({
			code: "storage_commit_failed",
			message,
			hint,
		});
	return CliBuildError.make({ status: result.status, message, hint, details });
}

/** Decode the same schemas for inline Code Mode output and stored render inputs. */
const decodeArtifacts = Effect.fn("sketchi.cli.codeMode.decodeArtifacts")(function* (
	artifact: {
		readonly formats: ReadonlyArray<{
			readonly format: string;
			readonly inline?: unknown;
		}>;
	},
	operation: "build" | "patch" | "export",
) {
	const patched = operation === "patch" ? "patched " : "";
	const hint =
		operation === "patch"
			? "Inspect the Code Mode patch/export boundary."
			: "Inspect the Code Mode build/export boundary.";
	const inline = (format: "scene" | "excalidraw") => {
		const ref = artifact.formats.find((candidate) => candidate.format === format);
		if (ref?.inline !== undefined) return Effect.succeed(ref.inline);
		return Effect.fail(
			CliBuildError.make({
				status: "missing_inline_artifact",
				message: `Code Mode did not return the ${patched}${format} artifact inline.`,
				hint:
					operation === "patch"
						? "Retry the offline patch with the required artifact formats."
						: "Rebuild the document with the required offline artifact formats.",
				details: [format],
			}),
		);
	};
	const sceneRef = artifact.formats.find((candidate) => candidate.format === "scene");
	const scene =
		operation === "export" && !sceneRef
			? undefined
			: Schema.decodeUnknownResult(RenderedDiagramSceneSchema, {
					errors: "all",
					reportInput: true,
				})(yield* inline("scene"));
	if (scene && !Result.isSuccess(scene))
		return yield* CliBuildError.make({
			status: "invalid_scene_artifact",
			message: `Code Mode returned an invalid ${patched}scene artifact.`,
			hint,
			details: formatContractSchemaError(scene.failure).issues.map((issue) => issue.message),
		});
	const excalidraw = Schema.decodeUnknownResult(ExcalidrawFileSchema, {
		errors: "all",
		reportInput: true,
	})(yield* inline("excalidraw"));
	if (!Result.isSuccess(excalidraw))
		return yield* CliBuildError.make({
			status: "invalid_excalidraw_artifact",
			message: `Code Mode returned an invalid ${patched}Excalidraw artifact.`,
			hint,
			details: formatContractSchemaError(excalidraw.failure).issues.map((issue) => issue.message),
		});
	return {
		...(scene && Result.isSuccess(scene) ? { scene: scene.success } : {}),
		excalidraw: excalidraw.success,
	};
});

interface InlineArtifacts {
	readonly formats: ReadonlyArray<{
		readonly format: string;
		readonly inline?: unknown;
	}>;
}

export function decodeInlineArtifacts(
	artifact: InlineArtifacts,
	operation: "build" | "patch",
): Effect.Effect<PatchedDiagramArtifacts, CliBuildError>;
export function decodeInlineArtifacts(
	artifact: InlineArtifacts,
	operation: "export",
): Effect.Effect<
	{
		readonly scene?: PatchedDiagramArtifacts["scene"];
		readonly excalidraw: PatchedDiagramArtifacts["excalidraw"];
	},
	CliBuildError
>;
export function decodeInlineArtifacts(
	artifact: InlineArtifacts,
	operation: "build" | "patch" | "export",
) {
	return decodeArtifacts(artifact, operation);
}
