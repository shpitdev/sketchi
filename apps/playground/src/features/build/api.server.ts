import { Array as Arr, Option as Opt, Effect, Schema } from "effect";
import {
	families,
	type FamilyBuildOperation,
	type FamilyBuildResult,
	type FamilyOperation,
} from "@sketchi/diagrams/family";
import "@tanstack/react-start/server-only";
import {
	CodeModeArtifactStorage,
	type StoredArtifactFormat,
} from "@sketchi/diagrams/build/code-mode/artifacts";
import { bindBuild } from "@sketchi/diagrams/build/code-mode/builds";
import { editFlowchart } from "@sketchi/diagrams/build/code-mode/edit-flowchart";
import { type EditFlowchartResult } from "@sketchi/diagrams/build/code-mode/edit-flowchart-contract";
import { type CodeModeRuntimeEnvironment } from "@sketchi/diagrams/build/code-mode/runtime";
import { getArtifact } from "@sketchi/diagrams/canvas/artifact";
import { createCanvas } from "@sketchi/diagrams/canvas/create";
import { type CreateCanvasResult } from "@sketchi/diagrams/canvas/create-contract";
import { applyDiagramPatch } from "@sketchi/diagrams/canvas/patch";
import { CANVAS_LIMITS } from "@sketchi/drawing";
import { type ArtifactFormat } from "@sketchi/drawing/artifacts";
import { createExcalidrawFile, type ExcalidrawScene } from "@sketchi/drawing/excalidraw";
import { withTelemetryCorrelation } from "@sketchi/observability";
import { PlaygroundClock } from "../../server/runtime/context.server";
import { resultHttpStatus } from "../../server/runtime/http-status.server";
import { readBoundedJson } from "../../server/runtime/request-body.server";
import { buildResponse } from "@sketchi/diagrams/build/operation";
import { codeModeUsageResponseHeaders, PlaygroundCodeModeUsage } from "./usage-events.server";
export const MAX_CODE_MODE_BUILD_REQUEST_BYTES = 256 * 1024;
/**
 * A canvas build or patch carries a CanvasSpec or scene of up to the canvas's serialized
 * limit, with room for the request around it.
 */
export const MAX_CANVAS_REQUEST_BYTES = CANVAS_LIMITS.maxSerializedBytes + 64 * 1024;
export class CodeModeHttpRequestError extends Schema.TaggedError<
	CodeModeHttpRequestError,
	{
		readonly brand: unique symbol;
	}
>()("CodeModeHttpRequestError", {
	cause: Schema.Defect(),
	message: Schema.String,
}) {}
function jsonResponse(body: unknown, status: number, extraHeaders: HeadersInit = {}): Response {
	const headers = new Headers(extraHeaders);
	headers.set("Cache-Control", "no-store");
	return Response.json(body, {
		status,
		headers,
	});
}
function requestTooLargeResult(diagramType: string, limitBytes: number) {
	return {
		ok: false as const,
		status: "invalid_input" as const,
		issues: [
			{
				code: "request_too_large" as const,
				severity: "error" as const,
				stage: "input" as const,
				ref: { kind: "request" as const, path: "input" },
				message: `${diagramType} request exceeds the ${limitBytes}-byte limit.`,
				hint: "Send a smaller semantic diagram request.",
			},
		],
	};
}
function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Arr.isArray(value);
}
function formatFromUrl(request: Request): string | undefined {
	return new URL(request.url).searchParams.get("format") ?? undefined;
}
function rawFromUrl(request: Request): boolean {
	const value = new URL(request.url).searchParams.get("raw");
	return value === "true" || value === "1";
}
function inlineFromUrl(request: Request): boolean | undefined {
	const value = new URL(request.url).searchParams.get("inline");
	if (value === null) {
		return undefined;
	}
	return value !== "false";
}
function extensionForFormat(format: ArtifactFormat): "excalidraw" | "json" | "png" {
	if (format === "png") {
		return "png";
	}
	return format === "excalidraw" ? "excalidraw" : "json";
}
function isExcalidrawElement(value: unknown): value is ExcalidrawScene["elements"][number] {
	return isRecord(value) && typeof value.id === "string" && typeof value.type === "string";
}
function isExcalidrawSceneData(value: unknown): value is ExcalidrawScene {
	return (
		isRecord(value) &&
		isRecord(value.appState) &&
		Arr.isArray(value.elements) &&
		Arr.every(value.elements, isExcalidrawElement)
	);
}
function isExcalidrawFileData(value: unknown): boolean {
	return (
		isRecord(value) &&
		value.type === "excalidraw" &&
		value.version === 2 &&
		typeof value.source === "string" &&
		isRecord(value.files)
	);
}
function dataForRawArtifact(artifact: StoredArtifactFormat): unknown {
	if (
		artifact.format === "excalidraw" &&
		!isExcalidrawFileData(artifact.data) &&
		isExcalidrawSceneData(artifact.data)
	) {
		return createExcalidrawFile(artifact.data);
	}
	return artifact.data;
}
function bodyForRawArtifact(artifact: StoredArtifactFormat): BodyInit {
	if (artifact.format === "png") {
		if (artifact.data instanceof ArrayBuffer) {
			return artifact.data;
		}
		if (artifact.data instanceof Uint8Array) {
			return toArrayBuffer(artifact.data);
		}
		throw new Error("PNG artifact data is not binary.");
	}
	// @effect-diagnostics-next-line globalJson:off -- Stored artifact data has already crossed the JSON storage codec; this synchronous HTTP body projection preserves its exact bytes.
	return JSON.stringify(dataForRawArtifact(artifact));
}
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	const buffer = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(buffer).set(bytes);
	return buffer;
}
function rawArtifactResponse(input: {
	artifact: StoredArtifactFormat;
	artifactId: string;
}): Response {
	const extension = extensionForFormat(input.artifact.format);
	return new Response(bodyForRawArtifact(input.artifact), {
		status: 200,
		headers: {
			"Cache-Control": "no-store",
			"Content-Disposition": `inline; filename="${input.artifactId}.${extension}"`,
			"Content-Type": input.artifact.mimeType,
		},
	});
}
type BuildResult = FamilyBuildResult | EditFlowchartResult | CreateCanvasResult;
type BuildOperation = FamilyBuildOperation | "editFlowchart" | "createCanvas";
function makeBuildHandler({
	operation,
	label,
	run,
	maxRequestBytes = MAX_CODE_MODE_BUILD_REQUEST_BYTES,
}: {
	readonly operation: BuildOperation;
	readonly maxRequestBytes?: number;
	readonly label: string;
	readonly run: (
		input: unknown,
	) => Effect.Effect<BuildResult, never, CodeModeArtifactStorage | CodeModeRuntimeEnvironment>;
}) {
	return Effect.fn(`playground.http.${operation}`)(function* (request: Request) {
		const clock = yield* PlaygroundClock;
		const usage = yield* PlaygroundCodeModeUsage;
		const usageContext = yield* usage.createContext;
		const startedAt = yield* clock.nowMillis;
		const bounded = yield* readBoundedJson(request, maxRequestBytes);
		if (bounded._tag === "InvalidJson") {
			return yield* CodeModeHttpRequestError.make({
				cause: undefined,
				message: "The request body was not valid JSON.",
			});
		}
		const tooLarge = bounded._tag === "TooLarge";
		const requestBody =
			bounded._tag === "Body" ? bounded.body : { omitted: true, reason: "request_too_large" };
		const result = tooLarge
			? requestTooLargeResult(label, maxRequestBytes)
			: yield* withTelemetryCorrelation(run(requestBody), {
					attemptId: usageContext.attemptId,
					runId: usageContext.runId,
				});
		const status = tooLarge ? 413 : resultHttpStatus(result);
		const finishedAt = yield* clock.nowMillis;
		yield* usage.capture({
			context: usageContext,
			durationMs: finishedAt - startedAt,
			operation,
			requestBody,
			responseBody: result,
			statusCode: status,
			surface: "api",
		});
		return jsonResponse(result, status, codeModeUsageResponseHeaders(usageContext));
	});
}
/** Existing family endpoints share bounded reads, request services and usage capture. */
export function handleFamilyBuildRequest(
	family: FamilyOperation<FamilyBuildResult> & { readonly label: string },
	request: Request,
) {
	const operation: FamilyOperation<FamilyBuildResult> = family;
	return makeBuildHandler({
		operation: family.operation,
		label: family.label,
		run: (input) => buildResponse(operation.build({ bindBuild })(input)),
	})(request);
}
export function familyForBuildPath(pathname: string) {
	return Opt.getOrUndefined(Arr.findFirst(families, (family) => family.path === pathname));
}
export const handleEditFlowchartRequest = makeBuildHandler({
	operation: "editFlowchart",
	label: "Flowchart",
	run: (input) => buildResponse(editFlowchart(input)),
});
export const handleCreateCanvasRequest = makeBuildHandler({
	operation: "createCanvas",
	label: "Canvas",
	run: (input) => buildResponse(createCanvas(input)),
	maxRequestBytes: MAX_CANVAS_REQUEST_BYTES,
});
export const handleGetArtifactRequest = Effect.fn("playground.http.getArtifact")(function* (
	request: Request,
	artifactId: string,
) {
	const format = formatFromUrl(request);
	const raw = rawFromUrl(request);
	const inline = raw ? false : inlineFromUrl(request);
	const input = {
		artifactId,
		...(format === undefined ? {} : { format }),
		...(inline === undefined ? {} : { inline }),
	};
	const result = yield* buildResponse(getArtifact(input));
	if (!result.ok || !raw) {
		return jsonResponse(result, resultHttpStatus(result));
	}
	const readResult = yield* (yield* CodeModeArtifactStorage).read(artifactId, result.format).pipe(
		Effect.match({
			onFailure: (error) => ({ error, ok: false as const }),
			onSuccess: (artifact) => ({ artifact, ok: true as const }),
		}),
	);
	if (!readResult.ok) {
		return jsonResponse(
			{
				ok: false,
				status: "storage_failed",
				issues: [
					{
						code: "storage_read_failed",
						severity: "error",
						stage: "storage",
						message: readResult.error.message,
						hint: "Retry retrieval or rebuild the artifact.",
					},
				],
			},
			500,
		);
	}
	if (!readResult.artifact) {
		return jsonResponse(
			{
				ok: false,
				status: "format_unavailable",
				issues: [
					{
						code: "patch_source_unavailable",
						severity: "error",
						stage: "storage",
						ref: { kind: "artifact", id: artifactId },
						message: `Artifact "${artifactId}" format "${result.format}" could not be read.`,
						hint: "Retry retrieval or rebuild the artifact.",
					},
				],
			},
			404,
		);
	}
	const artifact = readResult.artifact;
	return yield* Effect.sync(() => {
		try {
			return rawArtifactResponse({ artifact, artifactId });
		} catch (error) {
			return jsonResponse(
				{
					ok: false,
					status: "storage_failed",
					issues: [
						{
							code: "storage_read_failed",
							severity: "error",
							stage: "storage",
							message: error instanceof Error ? error.message : "Artifact read failed.",
							hint: "Retry retrieval or rebuild the artifact.",
						},
					],
				},
				500,
			);
		}
	});
});
export const handlePatchArtifactRequest = Effect.fn("playground.http.patchArtifact")(function* (
	request: Request,
	artifactId: string,
) {
	const clock = yield* PlaygroundClock;
	const usage = yield* PlaygroundCodeModeUsage;
	const usageContext = yield* usage.createContext;
	const startedAt = yield* clock.nowMillis;
	// A patch may carry its source scene inline, as large as a canvas.
	const bounded = yield* readBoundedJson(request, MAX_CANVAS_REQUEST_BYTES);
	if (bounded._tag === "InvalidJson") {
		return yield* CodeModeHttpRequestError.make({
			cause: undefined,
			message: "The request body was not valid JSON.",
		});
	}
	if (bounded._tag === "TooLarge") {
		const result = requestTooLargeResult("Artifact patch", MAX_CANVAS_REQUEST_BYTES);
		const finishedAt = yield* clock.nowMillis;
		yield* usage.capture({
			context: usageContext,
			durationMs: finishedAt - startedAt,
			operation: "applyDiagramPatch",
			requestBody: { omitted: true, reason: "request_too_large" },
			responseBody: result,
			statusCode: 413,
			surface: "api",
		});
		return jsonResponse(result, 413, codeModeUsageResponseHeaders(usageContext));
	}
	const body = bounded.body;
	const routeInput = isRecord(body)
		? {
				...body,
				source: body.source ?? { artifactId },
			}
		: {
				source: { artifactId },
				operations: [],
			};
	const result = yield* withTelemetryCorrelation(buildResponse(applyDiagramPatch(routeInput)), {
		artifactId,
		attemptId: usageContext.attemptId,
		runId: usageContext.runId,
	});
	const status = resultHttpStatus(result);
	const finishedAt = yield* clock.nowMillis;
	yield* usage.capture({
		context: usageContext,
		durationMs: finishedAt - startedAt,
		operation: "applyDiagramPatch",
		requestBody: routeInput,
		responseBody: result,
		statusCode: status,
		surface: "api",
	});
	return jsonResponse(result, status, codeModeUsageResponseHeaders(usageContext));
});
