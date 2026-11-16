import "@tanstack/react-start/server-only";

import { Array as Arr, Context, Effect, Layer, Predicate, Record as Rec } from "effect";
import { HttpRouter, HttpServer, type HttpServerRequest, HttpServerResponse } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";

import {
	CodeModeArtifactStorage,
	type StoredArtifactFormat,
	bindBuild,
	editFlowchart,
	type CodeModeRuntimeEnvironment,
	buildResponse,
} from "@sketchi/diagrams/build";
import { getArtifact } from "@sketchi/diagrams/canvas/artifact";
import { createCanvas } from "@sketchi/diagrams/canvas/create";
import { applyDiagramPatch } from "@sketchi/diagrams/canvas/patch";
import { type EditFlowchartResult } from "@sketchi/diagrams/build/contract";
import { type CreateCanvasResult } from "@sketchi/diagrams/canvas/create-contract";
import { type ApplyDiagramPatchResult } from "@sketchi/diagrams/canvas/patch-contract";
import {
	families,
	type DiagramFamily,
	type FamilyBuildResult,
	type FamilyOperation,
} from "@sketchi/diagrams/family";
import {
	MAX_GENERATE_REQUEST_BYTES,
	type GenerateResult,
} from "@sketchi/diagrams/generate/contract";
import {
	DiagramsHttpApi,
	FAILURE_HTTP_STATUS,
	httpFailure,
	MAX_BUILD_REQUEST_BYTES,
	MAX_CANVAS_REQUEST_BYTES,
	type FailureStatus,
} from "@sketchi/diagrams/http-api";
import { type ArtifactFormat } from "@sketchi/drawing/artifacts";
import { createExcalidrawFile, type ExcalidrawScene } from "@sketchi/drawing/excalidraw";
import { withTelemetryCorrelation } from "@sketchi/observability";

import {
	type PlaygroundBindings,
	PlaygroundClock,
	PlaygroundRequestMetadata,
} from "../../server/runtime/context.server";
import { generateDiagram } from "../../server/generation/api.server";
import { type PlaygroundGeneration } from "../../server/generation/service.server";
import { readJsonBody } from "./json-body.server";
import {
	codeModeUsageResponseHeaders,
	CurrentCodeModeUsage,
	PlaygroundCodeModeUsage,
	type CodeModeUsageOperation,
} from "./usage-events.server";

type BuildServices = CodeModeArtifactStorage | CodeModeRuntimeEnvironment;

/** A refusal the host makes before an operation runs: a body too large or not JSON. */
function requestRefusal(code: "request_too_large" | "invalid_type", message: string, hint: string) {
	return {
		ok: false as const,
		status: "invalid_input" as const,
		issues: [
			{
				code,
				severity: "error" as const,
				stage: "input" as const,
				ref: { kind: "request" as const, path: "input" },
				message,
				hint,
			},
		],
	};
}

const tooLarge = (label: string, limitBytes: number) =>
	requestRefusal(
		"request_too_large",
		`${label} request exceeds the ${limitBytes}-byte limit.`,
		"Send a smaller semantic diagram request.",
	);

const notJson = requestRefusal(
	"invalid_type",
	"The request body was not valid JSON.",
	"Send one JSON object.",
);

/**
 * Records the call as a usage event and answers with its result: an accepted result as the
 * success, a refusal as the failure HttpApi sends with its status.
 */
const answer = Effect.fn("playground.http.answer")(function* <
	A extends { readonly ok: true },
	B extends { readonly ok: false; readonly status: FailureStatus },
>(operation: CodeModeUsageOperation, requestBody: unknown, result: A | B, httpStatus?: number) {
	const clock = yield* PlaygroundClock;
	const usage = yield* PlaygroundCodeModeUsage;
	const current = yield* CurrentCodeModeUsage;
	const status = result.ok ? 200 : (httpStatus ?? FAILURE_HTTP_STATUS[result.status]);
	const finishedAt = yield* clock.nowMillis;
	yield* usage.capture({
		context: current,
		durationMs: finishedAt - current.startedAt,
		operation,
		requestBody,
		responseBody: result,
		statusCode: status,
		surface: "api",
	});
	if (result.ok) return result;
	return yield* Effect.fail(httpFailure(result, status));
});

type Accepted<T> = Extract<T, { readonly ok: true }>;
type Refused<T> = Extract<T, { readonly ok: false }>;
type RequestRefusal = ReturnType<typeof requestRefusal>;

/**
 * Reads a bounded body and runs one operation over it, refusing a body too large or not JSON.
 * Callers name the operation's accepted and refused results.
 */
const runOperation = Effect.fn("playground.http.operation")(function* <
	A extends { readonly ok: true },
	B extends { readonly ok: false; readonly status: FailureStatus },
	R,
>(
	request: HttpServerRequest.HttpServerRequest,
	options: {
		readonly operation: CodeModeUsageOperation;
		readonly label: string;
		readonly maxBytes: number;
		readonly input?: (body: unknown) => unknown;
		readonly run: (input: unknown) => Effect.Effect<A | B, never, R>;
	},
) {
	const body = yield* readJsonBody(request, options.maxBytes);
	if (body._tag === "TooLarge")
		return yield* answer<A, B | RequestRefusal>(
			options.operation,
			{ omitted: true, reason: "request_too_large" },
			tooLarge(options.label, options.maxBytes),
			413,
		);
	if (body._tag === "InvalidJson")
		return yield* answer<A, B | RequestRefusal>(options.operation, {}, notJson);
	const metadata = yield* PlaygroundRequestMetadata;
	const input = options.input ? options.input(body.body) : body.body;
	const result = yield* withTelemetryCorrelation(options.run(input), {
		attemptId: metadata.attemptId,
		runId: metadata.runId,
	});
	return yield* answer<A, B | RequestRefusal>(options.operation, input, result);
});

const familyGroup = (family: DiagramFamily) => {
	const operation: FamilyOperation<FamilyBuildResult> = family;
	return HttpApiBuilder.group(DiagramsHttpApi, family.type, (handlers) =>
		handlers.handleRaw("build", ({ request }) =>
			runOperation<Accepted<FamilyBuildResult>, Refused<FamilyBuildResult>, BuildServices>(
				request,
				{
					operation: family.operation,
					label: family.label,
					maxBytes: MAX_BUILD_REQUEST_BYTES,
					run: (input) => buildResponse(operation.build({ bindBuild })(input)),
				},
			),
		),
	);
};

const EditLive = HttpApiBuilder.group(DiagramsHttpApi, "edit", (handlers) =>
	handlers.handleRaw("flowchart", ({ request }) =>
		runOperation<Accepted<EditFlowchartResult>, Refused<EditFlowchartResult>, BuildServices>(
			request,
			{
				operation: "editFlowchart",
				label: "Flowchart",
				maxBytes: MAX_BUILD_REQUEST_BYTES,
				run: (input) => buildResponse(editFlowchart(input)),
			},
		),
	),
);

function isRecord(value: unknown): value is Record<string, unknown> {
	return Predicate.isObject(value) && !Arr.isArray(value);
}

function isExcalidrawSceneData(value: unknown): value is ExcalidrawScene {
	return (
		isRecord(value) &&
		isRecord(value.appState) &&
		Arr.isArray(value.elements) &&
		Arr.every(
			value.elements,
			(element) =>
				isRecord(element) && typeof element.id === "string" && typeof element.type === "string",
		)
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

function extensionForFormat(format: ArtifactFormat): "excalidraw" | "json" | "png" {
	if (format === "png") return "png";
	return format === "excalidraw" ? "excalidraw" : "json";
}

/** The stored file itself, as a download: the bytes stored, named for the artifact. */
function rawArtifactBody(artifact: StoredArtifactFormat): BodyInit | undefined {
	if (artifact.format === "png") {
		if (artifact.data instanceof ArrayBuffer) return artifact.data;
		if (artifact.data instanceof Uint8Array) return new Uint8Array(artifact.data).buffer;
		return undefined;
	}
	const data =
		artifact.format === "excalidraw" &&
		!isExcalidrawFileData(artifact.data) &&
		isExcalidrawSceneData(artifact.data)
			? createExcalidrawFile(artifact.data)
			: artifact.data;
	// @effect-diagnostics-next-line globalJson:off -- Stored artifact data has already crossed the JSON storage codec; this synchronous body projection preserves its exact bytes.
	return JSON.stringify(data);
}

function storageReadFailed(message: string) {
	return {
		ok: false as const,
		status: "storage_failed" as const,
		issues: [
			{
				code: "storage_read_failed",
				severity: "error" as const,
				stage: "storage" as const,
				message,
				hint: "Retry retrieval or rebuild the artifact.",
			},
		],
	};
}

const CanvasLive = HttpApiBuilder.group(DiagramsHttpApi, "canvas", (handlers) =>
	handlers
		.handleRaw("createCanvas", ({ request }) =>
			runOperation<Accepted<CreateCanvasResult>, Refused<CreateCanvasResult>, BuildServices>(
				request,
				{
					operation: "createCanvas",
					label: "Canvas",
					maxBytes: MAX_CANVAS_REQUEST_BYTES,
					run: (input) => buildResponse(createCanvas(input)),
				},
			),
		)
		.handle("getArtifact", ({ params, query }) =>
			Effect.gen(function* () {
				const raw = query.raw === "true" || query.raw === "1";
				const inline = raw || query.inline === undefined ? undefined : query.inline !== "false";
				const result = yield* buildResponse(
					getArtifact({
						artifactId: params.artifactId,
						...(query.format === undefined ? {} : { format: query.format }),
						...(raw ? { inline: false } : inline === undefined ? {} : { inline }),
					}),
				);
				if (!result.ok) return yield* Effect.fail(httpFailure(result));
				if (!raw) return result;
				const read = yield* (yield* CodeModeArtifactStorage)
					.read(params.artifactId, result.format)
					.pipe(Effect.result);
				if (read._tag === "Failure")
					return yield* Effect.fail(httpFailure(storageReadFailed(read.failure.message)));
				const artifact = read.success;
				if (!artifact)
					return yield* Effect.fail(
						httpFailure({
							ok: false as const,
							status: "format_unavailable" as const,
							issues: [
								{
									code: "patch_source_unavailable",
									severity: "error" as const,
									stage: "storage" as const,
									ref: { kind: "artifact" as const, id: params.artifactId },
									message: `Artifact "${params.artifactId}" format "${result.format}" could not be read.`,
									hint: "Retry retrieval or rebuild the artifact.",
								},
							],
						}),
					);
				const body = rawArtifactBody(artifact);
				if (body === undefined)
					return yield* Effect.fail(
						httpFailure(storageReadFailed("PNG artifact data is not binary.")),
					);
				return HttpServerResponse.fromWeb(
					new Response(body, {
						status: 200,
						headers: {
							"Cache-Control": "no-store",
							"Content-Disposition": `inline; filename="${params.artifactId}.${extensionForFormat(artifact.format)}"`,
							"Content-Type": artifact.mimeType,
						},
					}),
				);
			}),
		)
		.handleRaw("patchArtifact", ({ params, request }) =>
			runOperation<
				Accepted<ApplyDiagramPatchResult>,
				Refused<ApplyDiagramPatchResult>,
				BuildServices
			>(request, {
				operation: "applyDiagramPatch",
				label: "Artifact patch",
				maxBytes: MAX_CANVAS_REQUEST_BYTES,
				// The route's artifact is the source when the body names none.
				input: (body) =>
					isRecord(body)
						? { ...body, source: body.source ?? { artifactId: params.artifactId } }
						: { source: { artifactId: params.artifactId }, operations: [] },
				run: (input) => buildResponse(applyDiagramPatch(input)),
			}),
		),
);

const GenerateLive = HttpApiBuilder.group(DiagramsHttpApi, "generate", (handlers) =>
	handlers.handleRaw("generate", ({ request }) =>
		Effect.gen(function* () {
			const body = yield* readJsonBody(request, MAX_GENERATE_REQUEST_BYTES);
			const outcome = yield* generateDiagram(body);
			return yield* answer<Accepted<GenerateResult>, Refused<GenerateResult>>(
				"generateDiagram",
				outcome.requestBody,
				outcome.result,
			);
		}),
	),
);

/**
 * Built once per isolate with no I/O or request state. Each request supplies its bindings,
 * metadata, build capabilities, usage event and telemetry span through the request context.
 */
const diagramsApp = HttpRouter.toWebHandler(
	HttpApiBuilder.layer(DiagramsHttpApi).pipe(
		Layer.provide(
			Layer.mergeAll(EditLive, CanvasLive, GenerateLive, ...Arr.map(families, familyGroup)),
		),
		Layer.provide(HttpServer.layerServices),
	),
	{ disableLogger: true, routerConfig: { maxParamLength: 2048 } },
);

/** Serves one diagrams API request in the request's own context. */
export const serveDiagramsApi = Effect.fn("playground.http.diagrams")(function* (request: Request) {
	const ids = yield* PlaygroundCodeModeUsage;
	const clock = yield* PlaygroundClock;
	const usage = { ...(yield* ids.createContext), startedAt: yield* clock.nowMillis };
	const context = yield* Effect.context<
		| PlaygroundBindings
		| PlaygroundClock
		| PlaygroundCodeModeUsage
		| PlaygroundGeneration
		| PlaygroundRequestMetadata
		| CodeModeArtifactStorage
		| CodeModeRuntimeEnvironment
	>();
	const response = yield* Effect.promise(() =>
		diagramsApp.handler(request, Context.add(context, CurrentCodeModeUsage, usage)),
	);
	response.headers.set("Cache-Control", "no-store");
	// Every write operation is a usage event; its ids let a caller find it.
	if (request.method !== "GET")
		for (const [name, value] of Rec.toEntries(codeModeUsageResponseHeaders(usage)))
			response.headers.set(name, value);
	return response;
});
