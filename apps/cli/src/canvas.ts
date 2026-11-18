import { formatContractSchemaError } from "@sketchi/diagrams/build/contract";
import { CreateCanvasRequest } from "@sketchi/diagrams/canvas/create-contract";
import { ExcalidrawFile } from "@sketchi/drawing/excalidraw";
import { Effect, Schema, SchemaIssue, Result } from "effect";
import { FetchHttpClient } from "effect/http";

import { type BuiltDiagram, type StoredDiagram } from "./contracts";
import { validateStorageId } from "./document";
import { CliCanvasError, CliInputError, CliValidationError } from "./errors";
import { type InputSource } from "./terminal/effect-cli";
import { InputReader } from "./terminal/input";
import { DiagramStore } from "./store/service";
import { decodeCreateCanvas, diagramsClient } from "./diagrams-client";
import { API_REQUEST_TIMEOUT, boundedResponse, MAX_API_RESPONSE_BYTES } from "./response-body";

export const DEFAULT_CANVAS_ENDPOINT = "https://playground.sketchi.app/api/v1/canvases/create";
export const SKETCHI_CANVAS_ENDPOINT_ENV = "SKETCHI_CANVAS_ENDPOINT";

export interface CreateCanvasInput {
	readonly endpoint: string;
	readonly spec: CreateCanvasRequest["spec"];
}

export interface CreateCanvasDiagramResult {
	readonly artifactId: string;
	readonly diagram: StoredDiagram;
}

export function resolveCanvasEndpoint(): string {
	return process.env[SKETCHI_CANVAS_ENDPOINT_ENV]?.trim() || DEFAULT_CANVAS_ENDPOINT;
}

const formatSchemaIssue = SchemaIssue.makeFormatterStandardSchemaV1();

function schemaDetails(error: Schema.SchemaError): ReadonlyArray<string> {
	return formatSchemaIssue(error.issue).issues.map((issue) => {
		const path = (issue.path ?? [])
			.map((segment) => {
				if (typeof segment === "object" && segment !== null && "key" in segment) {
					return String(segment.key);
				}
				return String(segment);
			})
			.join(".");
		return `${path || "spec"}: ${issue.message}`;
	});
}

const decodeCanvasSpec = Schema.decodeUnknownEffect(CreateCanvasRequest.fields.spec, {
	errors: "all",
});

export const parseCanvasSpec = Effect.fn("sketchi.cli.canvas.parseSpec")(function* (text: string) {
	const input: unknown = yield* Effect.try({
		try: () => JSON.parse(text),
		catch: () =>
			CliInputError.make({
				code: "invalid_json",
				message: "The CanvasSpec input is not valid JSON.",
				hint: "Pass one complete CanvasSpec JSON object.",
			}),
	});
	return yield* decodeCanvasSpec(input).pipe(
		Effect.mapError((error) =>
			CliValidationError.make({
				message: "The CanvasSpec document is invalid.",
				hint: "Use the version 1 CanvasSpec contract documented by sketchi docs.",
				details: schemaDetails(error),
			}),
		),
	);
});

export const readCanvasSpecInput = Effect.fn("sketchi.cli.canvas.readSpecInput")(function* (
	source: InputSource,
) {
	const reader = yield* InputReader;
	const text = yield* reader.read(source, { content: "CanvasSpec document" });
	return yield* parseCanvasSpec(text);
});

function networkFailure(): CliCanvasError {
	return CliCanvasError.make({
		code: "network_failure",
		message: "The Sketchi create-canvas API could not be reached.",
		hint: "Check the network connection and endpoint, then retry.",
		details: ["transport"],
	});
}

function malformedResponse(details: ReadonlyArray<string> = []): CliCanvasError {
	return CliCanvasError.make({
		code: "malformed_response",
		message: "The Sketchi create-canvas API returned an unreadable response.",
		hint: "Retry once; if the response remains invalid, report the endpoint.",
		details,
	});
}

function endpointFailure(status: number): CliCanvasError {
	return CliCanvasError.make({
		code: "endpoint_failure",
		message: `The Sketchi create-canvas API responded with HTTP ${String(status)}.`,
		hint: "Check the endpoint and retry.",
		details: [`http_status:${String(status)}`],
	});
}

function serverCanvasFailure(
	status: "export_failed" | "render_failed" | "storage_failed",
	httpStatus: number,
	issues: ReadonlyArray<{
		readonly code: string;
		readonly message: string;
	}>,
): CliCanvasError {
	return CliCanvasError.make({
		code: "endpoint_failure",
		message: `The Sketchi create-canvas API failed with status ${status}.`,
		hint: "Retry once; if the failure persists, report the endpoint and status.",
		details: [
			`status:${status}`,
			`http_status:${String(httpStatus)}`,
			...issues.map((issue) => `${issue.code}: ${issue.message}`),
		],
	});
}

function rejectedCanvas(
	status: string,
	httpStatus: number,
	issues: ReadonlyArray<{
		readonly code: string;
		readonly message: string;
	}>,
): CliCanvasError {
	const first = issues[0];
	return CliCanvasError.make({
		code: "canvas_rejected",
		message: first?.message ?? "The create-canvas API rejected the CanvasSpec.",
		hint: "Correct the reported CanvasSpec issue and retry.",
		details: [
			`status:${status}`,
			`http_status:${String(httpStatus)}`,
			...issues.map((issue) => `${issue.code}: ${issue.message}`),
		],
	});
}

const requestCanvas = Effect.fn("sketchi.cli.canvas.request")(
	function* (input: CreateCanvasInput) {
		const client = yield* diagramsClient(input.endpoint);
		const response = yield* client.canvas
			.createCanvas({
				payload: {
					spec: input.spec,
					options: {
						artifactFormats: ["scene", "excalidraw"],
						inlineArtifacts: ["excalidraw"],
					},
				},
				responseMode: "response-only",
			})
			.pipe(Effect.mapError(networkFailure));
		const bounded = yield* boundedResponse(
			response,
			MAX_API_RESPONSE_BYTES,
			malformedResponse,
			networkFailure,
		);
		return yield* decodeCreateCanvas(bounded).pipe(
			Effect.catch((error) => {
				if (!("httpStatus" in error)) {
					const ok = response.status >= 200 && response.status < 300;
					return Effect.fail(
						ok
							? malformedResponse(Schema.isSchemaError(error) ? schemaDetails(error) : [])
							: endpointFailure(response.status),
					);
				}
				const { body, httpStatus } = error;
				switch (body.status) {
					case "export_failed":
					case "render_failed":
					case "storage_failed":
						return Effect.fail(serverCanvasFailure(body.status, httpStatus, body.issues));
					case "invalid_canvas":
					case "invalid_input":
					case "limit_exceeded":
						return Effect.fail(rejectedCanvas(body.status, httpStatus, body.issues));
				}
			}),
		);
	},
	Effect.scoped,
	Effect.timeoutOrElse({
		duration: API_REQUEST_TIMEOUT,
		orElse: () =>
			Effect.fail(
				CliCanvasError.make({
					code: "canvas_timeout",
					message: "The Sketchi canvas API request timed out.",
					hint: "Retry once; if it persists, check the endpoint and try a smaller canvas.",
					details: [],
				}),
			),
	}),
	// @effect-diagnostics-next-line strictEffectProvide:off -- The canvas command is the outgoing network entry point and owns its Fetch transport.
	Effect.provide(FetchHttpClient.layer),
);

export const createCanvasDiagram = Effect.fn("sketchi.cli.canvas.create")(function* (
	input: CreateCanvasInput,
) {
	const store = yield* DiagramStore;
	yield* validateStorageId(input.spec.diagramId).pipe(
		Effect.mapError((error) =>
			CliValidationError.make({
				message: error.message,
				hint: error.hint,
				details: ["spec.diagramId"],
			}),
		),
	);
	const response = yield* requestCanvas(input);
	if (response.normalizedSpec.diagramId !== input.spec.diagramId) {
		return yield* malformedResponse([
			"normalizedSpec.diagramId does not match submitted spec.diagramId",
		]);
	}
	const excalidrawReference = response.artifact.formats.find(
		(artifact) => artifact.format === "excalidraw",
	);
	if (excalidrawReference?.inline === undefined) {
		return yield* malformedResponse(["artifact.formats.excalidraw.inline"]);
	}
	const decodedExcalidraw = Schema.decodeUnknownResult(ExcalidrawFile, {
		errors: "all",
		reportInput: true,
	})(excalidrawReference.inline);
	if (!Result.isSuccess(decodedExcalidraw)) {
		return yield* malformedResponse(
			formatContractSchemaError(decodedExcalidraw.failure).issues.map(
				(issue) => `${issue.path.join(".")}: ${issue.message}`,
			),
		);
	}
	const id = yield* validateStorageId(response.normalizedSpec.diagramId).pipe(
		Effect.mapError(() => malformedResponse(["normalizedSpec.diagramId is not storage-safe"])),
	);
	if (response.artifact.diagramId !== id) {
		return yield* malformedResponse(["artifact.diagramId does not match normalizedSpec.diagramId"]);
	}
	const built: BuiltDiagram = {
		id,
		type: "canvas",
		title: response.normalizedSpec.title,
		document: { type: "canvas", spec: response.normalizedSpec },
		scene: response.normalizedSpec,
		excalidraw: decodedExcalidraw.success,
	};
	const diagram = yield* store.create(built);
	return {
		artifactId: response.artifact.artifactId,
		diagram,
	} satisfies CreateCanvasDiagramResult;
});
