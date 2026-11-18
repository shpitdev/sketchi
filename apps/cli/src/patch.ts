import { type CanvasSpec } from "@sketchi/drawing";
import { formatContractSchemaError } from "@sketchi/diagrams/build/contract";
import { ArtifactStorage, BuildRuntimeEnvironment } from "@sketchi/diagrams/build";
import { applyDiagramPatch } from "@sketchi/diagrams/canvas/patch";
import { ApplyDiagramPatchRequest } from "@sketchi/diagrams/canvas/patch-contract";
import { Context, Effect, Layer, Schema, Result } from "effect";

import { codeModeFailure, decodeInlineArtifacts, withCodeMode } from "./code-mode-artifacts";
import type { PatchedDiagramArtifacts } from "./contracts";
import { CliBuildError, CliInputError, CliStorageError, CliValidationError } from "./errors";

export interface CliPatchInput {
	readonly operations: ApplyDiagramPatchRequest["operations"];
	readonly options?: ApplyDiagramPatchRequest["options"];
	readonly intent?: string;
}

const PatchInput = Schema.Struct({
	operations: ApplyDiagramPatchRequest.fields.operations,
	options: ApplyDiagramPatchRequest.fields.options,
	intent: ApplyDiagramPatchRequest.fields.intent,
});

function validationError(message: string, details: ReadonlyArray<string>): CliValidationError {
	return CliValidationError.make({
		message,
		hint: "Provide operations and optional options or intent only.",
		details,
	});
}

export const decodePatchInput = Effect.fn("sketchi.cli.patch.decodeInput")(function* (
	input: unknown,
) {
	if (typeof input !== "object" || input === null || Array.isArray(input)) {
		return yield* validationError("The diagram patch request is invalid.", [
			"patch: Expected an object.",
		]);
	}
	if ("source" in input) {
		return yield* validationError("The diagram patch request cannot supply source.", [
			"source: The CLI binds the stored scene.",
		]);
	}
	if ("requestId" in input) {
		return yield* validationError("The diagram patch request cannot supply requestId.", [
			"requestId: The CLI owns the patch request id.",
		]);
	}
	const parsed = Schema.decodeUnknownResult(PatchInput, {
		errors: "all",
		reportInput: true,
	})(input);
	if (!Result.isSuccess(parsed)) {
		return yield* validationError(
			"The diagram patch request is invalid.",
			formatContractSchemaError(parsed.failure).issues.map((issue) => issue.message),
		);
	}
	return {
		operations: parsed.success.operations,
		...(parsed.success.options ? { options: parsed.success.options } : {}),
		...(parsed.success.intent ? { intent: parsed.success.intent } : {}),
	} satisfies CliPatchInput;
});

export const parseJsonPatchInput = Effect.fn("sketchi.cli.patch.parseJson")(function* (
	text: string,
) {
	const input: unknown = yield* Effect.try({
		// @effect-diagnostics-next-line globalJsonInEffect:off -- The CLI input/storage codec maps native JSON parse failure to its existing typed error.
		try: () => JSON.parse(text),
		catch: () =>
			CliInputError.make({
				code: "invalid_json",
				message: "The patch input is not valid JSON.",
				hint: "Pass one complete diagram patch request object.",
			}),
	});
	return yield* decodePatchInput(input);
});

export class DiagramPatcher extends Context.Service<
	DiagramPatcher,
	{
		readonly patch: (
			scene: CanvasSpec,
			input: CliPatchInput,
			requestId: string,
		) => Effect.Effect<
			PatchedDiagramArtifacts,
			CliBuildError | CliStorageError | CliValidationError
		>;
	}
>()("@sketchi/cli/DiagramPatcher") {}

export const DiagramPatcherLive = Layer.effect(
	DiagramPatcher,
	Effect.gen(function* () {
		const artifactStorage = yield* ArtifactStorage;
		const environment = yield* BuildRuntimeEnvironment;

		const patch = Effect.fn("sketchi.cli.diagram.patch")(function* (
			scene: CanvasSpec,
			input: CliPatchInput,
			requestId: string,
		) {
			const result = yield* withCodeMode(artifactStorage, environment, (options) =>
				applyDiagramPatch({
					requestId,
					source: { scene },
					operations: input.operations,
					options: { ...input.options, ...options },
					...(input.intent ? { intent: input.intent } : {}),
				}),
			);
			if (!result.ok) return yield* codeModeFailure(result, "patch");
			const { scene: patchedScene, excalidraw } = yield* decodeInlineArtifacts(
				result.artifact,
				"patch",
			);
			return {
				scene: patchedScene,
				excalidraw,
			} satisfies PatchedDiagramArtifacts;
		});

		return { patch };
	}),
);
