import { type CodeModeIssue, type ArtifactBuildCapabilities, type BuildDelivery } from "./result";

import { CANVAS_LIMITS, type CanvasSpec } from "@sketchi/drawing";
import {
	type ArtifactBundle,
	type ArtifactFormat,
	type InlineArtifactFormat,
	type PartialArtifactBundle,
} from "@sketchi/drawing/artifacts";
import {
	convertSceneToExcalidraw,
	createExcalidrawFile,
	validateExcalidrawScene,
	type ExcalidrawScene,
} from "@sketchi/drawing/excalidraw";
import { withTelemetryCorrelation } from "@sketchi/observability";
import { Clock, Effect, Result, Schema } from "effect";

import {
	ARTIFACT_MIME_TYPES,
	ArtifactStorage,
	jsonSizeBytes,
	type StoredArtifactFormat,
} from "./artifacts";
import { FailureContextSchema, issue, storageFailureIssue } from "./issues";
import {
	ArtifactRenderFailed,
	BuildRuntimeEnvironment,
	type ArtifactRenderer,
	type BuildRuntimeOptions,
} from "./runtime";

const DEFAULT_BUILD_FORMATS: ArtifactFormat[] = ["excalidraw", "scene"];
const DEFAULT_INLINE_FORMATS: InlineArtifactFormat[] = ["scene"];

class ArtifactRendererNotConfigured extends Schema.TaggedError<
	ArtifactRendererNotConfigured,
	{ readonly brand: unique symbol }
>()("ArtifactRendererNotConfigured", { message: Schema.String }) {}

type ArtifactExportError = ArtifactRendererNotConfigured | ArtifactRenderFailed;

class ArtifactExportFailure extends Schema.TaggedError<
	ArtifactExportFailure,
	{ readonly brand: unique symbol }
>()("ArtifactExportFailure", {
	status: Schema.Literals(["export_failed", "limit_exceeded"]),
	issues: FailureContextSchema.fields.issues,
}) {}

class ArtifactStorageFailure extends Schema.TaggedError<
	ArtifactStorageFailure,
	{ readonly brand: unique symbol }
>()("ArtifactStorageFailure", {
	status: Schema.Literal("storage_failed"),
	cause: Schema.Defect(),
	issues: FailureContextSchema.fields.issues,
}) {}

/** The delivery options a build, canvas or patch request carries. */
type DeliveryOptions =
	| {
			readonly artifactFormats?: ArtifactFormat[];
			readonly inlineArtifacts?: InlineArtifactFormat[];
	  }
	| undefined;

export function requestedFormats(input: DeliveryOptions): ArtifactFormat[] {
	return input?.artifactFormats ?? DEFAULT_BUILD_FORMATS;
}

export function requestedInlineFormats(input: DeliveryOptions): InlineArtifactFormat[] {
	return input?.inlineArtifacts ?? DEFAULT_INLINE_FORMATS;
}

const storedArtifactsForFormats = Effect.fn("codeMode.artifacts.exportFormats")(function* (input: {
	formats: readonly ArtifactFormat[];
	scene: CanvasSpec;
	excalidraw: ExcalidrawScene;
	renderer?: ArtifactRenderer | undefined;
	defaultPng?: BuildRuntimeOptions["defaultPng"];
}) {
	const artifacts: StoredArtifactFormat[] = [];

	for (const format of input.formats) {
		let data: unknown;
		if (format === "png" && input.defaultPng) {
			// One deadline spans all optional exports in the execute script, including
			// renderer retries/queueing. Keep time for the remaining formats and storage.
			const remaining = input.defaultPng.deadlineMillis - (yield* Clock.currentTimeMillis);
			if (remaining <= 0) {
				input.defaultPng.onUnavailable("Default PNG delivery budget exhausted.");
				continue;
			}
			const rendered = yield* dataForArtifactFormat(input, format).pipe(
				Effect.timeout(remaining),
				Effect.result,
			);
			if (Result.isFailure(rendered)) {
				input.defaultPng.onUnavailable(
					rendered.failure._tag === "TimeoutError"
						? "Default PNG rendering exceeded its delivery budget."
						: rendered.failure.message,
				);
				continue;
			}
			data = rendered.success;
		} else {
			data = yield* dataForArtifactFormat(input, format);
		}
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
		scene: CanvasSpec;
		excalidraw: ExcalidrawScene;
		renderer?: ArtifactRenderer | undefined;
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
			ArtifactRendererNotConfigured.make({
				message: "PNG artifact rendering is not configured for this runtime.",
			}),
		);
	}

	return input.renderer
		.renderPng({
			scene: input.scene,
			excalidraw: input.excalidraw,
		})
		.pipe(Effect.mapError((cause) => ArtifactRenderFailed.make({ cause, message: cause.message })));
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
			...(error._tag === "ArtifactRendererNotConfigured"
				? { ref: { kind: "artifact", path: "options.artifactFormats" } }
				: {}),
			message: error.message,
			hint:
				error._tag === "ArtifactRendererNotConfigured"
					? "Use the hosted Studio Code Mode runtime with its Cloudflare Browser Run binding, or omit png from artifactFormats."
					: "Retry the request; if it keeps failing, inspect the configured renderer.",
		}),
	];
}

export function exportIssues(
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

/** The authored view of a scene: node icon references without derived SVG bytes. */
export function withoutIconAssets(scene: CanvasSpec): CanvasSpec {
	const { icons: _icons, ...rest } = scene;
	return rest;
}

function withArtifactUrls(
	artifact: ArtifactBundle,
	artifactUrl: BuildRuntimeOptions["artifactUrl"],
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
	return { ...artifact, formats };
}

/** The unstored scene of a failed export, with logo slugs but not their SVG bytes. */
export function scenePartial(scene: CanvasSpec): PartialArtifactBundle {
	const inline = withoutIconAssets(scene);
	return {
		diagramId: scene.diagramId,
		formats: [
			{
				format: "scene",
				mimeType: ARTIFACT_MIME_TYPES.scene,
				inline,
				sizeBytes: jsonSizeBytes(inline),
			},
		],
	};
}

export const exportAndStoreScene = Effect.fn("codeMode.artifacts.exportAndStore")(
	function* (input: {
		scene: CanvasSpec;
		formats: readonly ArtifactFormat[];
		inlineFormats: InlineArtifactFormat[];
		requestId?: string;
		provenance?: ArtifactBundle["provenance"];
		/** The document the scene was built from, stored beside it for later edits. */
		document?: unknown;
		validationIssues: typeof exportIssues;
	}) {
		const environment = yield* BuildRuntimeEnvironment;
		const store = yield* ArtifactStorage;
		const { excalidraw, validation } = yield* Effect.sync(() => {
			const excalidraw = convertSceneToExcalidraw(input.scene);
			return { excalidraw, validation: validateExcalidrawScene(excalidraw) };
		}).pipe(Effect.withSpan("codeMode.artifacts.exportValidate"));
		// A canvas of composed shapes exports several Excalidraw elements for each of its own.
		if (excalidraw.elements.length > CANVAS_LIMITS.maxExportedElements) {
			return yield* new ArtifactExportFailure({
				status: "limit_exceeded",
				issues: [
					issue({
						code: "canvas_limit_exceeded",
						stage: "export",
						ref: { kind: "diagram", id: input.scene.diagramId },
						message: `Canvas exports ${excalidraw.elements.length} Excalidraw elements, more than the ${CANVAS_LIMITS.maxExportedElements} a share link holds.`,
						hint: "Split the diagram into smaller canvases.",
					}),
				],
			});
		}
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
			defaultPng: environment.defaultPng,
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
		const stored =
			input.document === undefined
				? formats
				: [
						...formats,
						{
							format: "document" as const,
							mimeType: ARTIFACT_MIME_TYPES.document,
							data: input.document,
							sizeBytes: sizeBytesForArtifactData(input.document),
						},
					];
		const artifact = yield* withTelemetryCorrelation(
			store
				.write({
					artifactId,
					diagramId: input.scene.diagramId,
					formats: stored,
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
	},
);

export const artifactBuildCapabilities = Effect.gen(function* () {
	const environment = yield* BuildRuntimeEnvironment;
	return {
		createId: environment.createId,
		exportScene: (scene: CanvasSpec, request: BuildDelivery) =>
			exportAndStoreScene({
				scene,
				formats: requestedFormats(request.options),
				inlineFormats: requestedInlineFormats(request.options),
				...(request.requestId ? { requestId: request.requestId } : {}),
				...(request.provenance ? { provenance: request.provenance } : {}),
				...(request.document === undefined ? {} : { document: request.document }),
				validationIssues: exportIssues,
			}).pipe(
				Effect.mapError((error) => ({
					status: error.status,
					issues: error.issues,
					partial:
						error.status === "storage_failed"
							? { diagramId: scene.diagramId }
							: scenePartial(scene),
				})),
			),
	} satisfies ArtifactBuildCapabilities<BuildRuntimeEnvironment | ArtifactStorage>;
});
