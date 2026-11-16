import { canvasValidationIssues } from "../build/scene.js";

import { compileCanvasSpec, getCanvasValidationIssues } from "@sketchi/drawing";
import { Effect, Result, Schema } from "effect";

import { boundary, type CodeModeWorkflowEffect } from "../build/code-mode/boundary.js";
import {
	exportAndStoreScene,
	requestedFormats,
	requestedInlineFormats,
	scenePartial,
	withoutIconAssets,
} from "../build/code-mode/export.js";
import { catalogForRequest, embedSceneIcons } from "../build/code-mode/icons.js";
import {
	codeModeInputIssues,
	failureResult,
	FailureContextSchema,
	issue,
	responseRequestId,
	workflowFailure,
} from "../build/code-mode/issues.js";
import { CodeModeRuntimeEnvironment } from "../build/code-mode/runtime.js";
import {
	CreateCanvasRejected,
	CreateCanvasRequest,
	type CreateCanvasResult,
} from "./create-contract.js";
import {
	canvasExportIssues,
	normalizeCanvasInput,
	serializedCanvasLimitIssue,
	undrawableCanvasIconIssues,
} from "./normalize.js";

const CreateCanvasFailure = workflowFailure(
	"CreateCanvasFailure",
	CreateCanvasRejected.fields.status,
	CreateCanvasRejected.mapFields(({ ok, status, ...context }) => ({
		...context,
		...FailureContextSchema.fields,
	})),
);

const RawCreateCanvasInput = Schema.Struct({
	spec: Schema.Unknown,
	requestId: Schema.optionalKey(Schema.Unknown),
});

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
			return yield* CreateCanvasFailure.new({
				status: rawIssue.code === "canvas_limit_exceeded" ? "limit_exceeded" : "invalid_input",
				context: {
					buildId,
					...responseRequestId(rawInput.requestId),
					issues: [rawIssue],
				},
			});
		}
	}
	const parsed = Schema.decodeUnknownResult(CreateCanvasRequest, {
		errors: "all",
		reportInput: true,
	})(input);
	if (!Result.isSuccess(parsed)) {
		return yield* CreateCanvasFailure.new({
			status: "invalid_input",
			context: {
				issues: codeModeInputIssues(parsed.failure),
			},
		});
	}

	const request = parsed.success;
	const baseContext = {
		buildId,
		...responseRequestId(request.requestId),
	};
	const normalized = normalizeCanvasInput(request.spec);
	if (!normalized) {
		return yield* CreateCanvasFailure.new({
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
		return yield* CreateCanvasFailure.new({
			status: "limit_exceeded",
			context: {
				...baseContext,
				issues: canvasValidationIssues(inputLimits),
			},
		});
	}
	const compiled = yield* embedSceneIcons(
		compileCanvasSpec(normalized),
		yield* catalogForRequest(environment.icons, environment.communityIcons, normalized),
	);
	const embedded = {
		...compiled,
		issues: [...undrawableCanvasIconIssues(request.spec), ...compiled.issues],
	};
	const scene = embedded.scene;
	const normalizedSpec = withoutIconAssets(scene);
	const validationIssues = getCanvasValidationIssues(scene);
	if (validationIssues.length > 0) {
		const issues = canvasValidationIssues(validationIssues);
		return yield* CreateCanvasFailure.new({
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
		Effect.mapError((error) =>
			CreateCanvasFailure.new({
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

export const createCanvas: (input: unknown) => CodeModeWorkflowEffect<CreateCanvasResult> =
	boundary("createCanvas", createCanvasWorkflow, failureResult);
