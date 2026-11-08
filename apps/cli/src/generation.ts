import {
	ApplyDiagramPatchRequest,
	type CANONICAL_DOCUMENT_TYPES,
	type CanonicalDiagramDocument,
	ExcalidrawFileSchema,
	CodeModeIssueSchema,
	RenderedDiagramSceneSchema,
	type ExcalidrawFile,
	type PatchableScene,
} from "@sketchi/diagram-agent";
import { Effect, Schema, Result } from "effect";

import type { BuiltDiagram, StoredDiagram } from "./contracts.js";
import { decodeCanonicalDiagramDocument, documentId, validateStorageId } from "./document.js";
import { CliGenerationError, CliValidationError } from "./errors.js";
import { DiagramPatcher } from "./patch.js";
import { DiagramStore } from "./storage.js";
import {
	GENERATE_REQUEST_TIMEOUT,
	MAX_API_RESPONSE_BYTES,
	readBoundedText,
} from "./response-body.js";

export const DEFAULT_GENERATE_ENDPOINT = "https://playground.sketchi.app/api/v1/generate";
export const SKETCHI_GENERATE_ENDPOINT_ENV = "SKETCHI_GENERATE_ENDPOINT";

/** Generation requests any canonical diagram family, and only those. */
export type GenerationType = (typeof CANONICAL_DOCUMENT_TYPES)[number];

export interface GenerateDiagramInput {
	readonly endpoint: string;
	readonly prompt: string;
	readonly type?: GenerationType;
}

/** A request to change a stored diagram: the record, and what to change. */
export interface ReviseDiagramInput {
	readonly endpoint: string;
	readonly diagramId: string;
	readonly prompt: string;
	/** Another family to turn the diagram into; omit to keep its own. */
	readonly type?: GenerationType;
}

export interface GenerateDiagramResult {
	readonly diagram: StoredDiagram;
	readonly model: string;
	readonly provider: string;
	/** What the server reports the generation took, when it reports it. */
	readonly attempts?: number;
	readonly durationMs?: number;
	readonly outputTokens?: number;
	/** A flowchart revision's edits, as the hosted model wrote them. */
	readonly edits?: ReadonlyArray<unknown>;
}

/**
 * Resolve the default generate endpoint: the production Sketchi generate API,
 * overridable only for preview or local testing through the environment.
 */
export function resolveGenerateEndpoint(): string {
	return process.env[SKETCHI_GENERATE_ENDPOINT_ENV]?.trim() || DEFAULT_GENERATE_ENDPOINT;
}

function networkFailure(): CliGenerationError {
	return CliGenerationError.make({
		code: "provider_failure",
		message: "The Sketchi generate API could not be reached.",
		hint: "Check your network connection and retry. create/show/edit/list/export/restore remain offline; share and pull are separate explicit network commands.",
		details: ["transport"],
	});
}

function malformedResponse(): CliGenerationError {
	return CliGenerationError.make({
		code: "malformed_output",
		message: "The Sketchi generate API returned an unreadable response.",
		hint: "Retry once; if it persists, report the prompt without secrets.",
		details: [],
	});
}

function invalidGeneratedDocument(): CliGenerationError {
	return CliGenerationError.make({
		code: "invalid_generated_document",
		message: "The generated diagram failed Sketchi schema or semantic validation.",
		hint: "Refine the prompt with concrete diagram content, then retry.",
		details: [],
	});
}

const EndpointErrorBody = Schema.Struct({
	status: Schema.optionalKey(Schema.String),
	issues: Schema.optionalKey(
		Schema.Array(
			Schema.Struct({
				message: Schema.optionalKey(Schema.String),
				hint: Schema.optionalKey(Schema.String),
			}),
		),
	),
});

const decodeErrorBody = Schema.decodeUnknownEffect(Schema.fromJsonString(EndpointErrorBody));

function endpointIssueDetails(body: typeof EndpointErrorBody.Type): string[] {
	return (body.issues ?? []).flatMap((entry) => [
		...(entry.message ? [entry.message] : []),
		...(entry.hint ? [entry.hint] : []),
	]);
}

function endpointFailure(status: number, body: typeof EndpointErrorBody.Type): CliGenerationError {
	const firstIssue = body.issues?.[0];
	const details = [`http_status:${String(status)}`, ...endpointIssueDetails(body)];

	switch (body.status) {
		case "generation_timeout":
			return CliGenerationError.make({
				code: "generation_timeout",
				message: firstIssue?.message ?? "The generate API timed out.",
				hint: firstIssue?.hint ?? "Retry once; if it persists, try a shorter prompt.",
				details,
			});
		case "malformed_output":
			return CliGenerationError.make({
				code: "malformed_output",
				message: firstIssue?.message ?? "The generate API returned unreadable model output.",
				hint: firstIssue?.hint ?? "Retry once; if it persists, try another prompt.",
				details,
			});
		case "invalid_input":
		case "invalid_generated_document":
		case "limit_exceeded":
		case "quality_failed":
			return CliGenerationError.make({
				code: "invalid_generated_document",
				message: firstIssue?.message ?? "The generated diagram failed Sketchi validation.",
				hint: firstIssue?.hint ?? "Refine the prompt with concrete content, then retry.",
				details,
			});
		default:
			return CliGenerationError.make({
				code: "provider_failure",
				message:
					firstIssue?.message ?? `The Sketchi generate API responded with HTTP ${String(status)}.`,
				hint: firstIssue?.hint ?? "Retry once; if it persists, report the prompt without secrets.",
				details,
			});
	}
}

const PresentValue = Schema.Unknown.check(Schema.makeFilter((value) => value !== undefined));

const GenerateApiSuccess = Schema.Struct({
	ok: Schema.Literal(true),
	issues: Schema.optionalKey(Schema.Array(CodeModeIssueSchema)),
	diagram: Schema.Struct({
		document: PresentValue,
		scene: PresentValue,
		excalidraw: PresentValue,
		/** Colors and shapes the request asked for, applied to the stored scene as a patch. */
		patch: Schema.optionalKey(
			Schema.Struct({ operations: ApplyDiagramPatchRequest.fields.operations }),
		),
		/** A flowchart revision's edits, which the server applied to the document sent. */
		edits: Schema.optionalKey(Schema.Array(Schema.Unknown)),
	}),
	generation: Schema.Struct({
		attempts: Schema.optionalKey(Schema.Number),
		durationMs: Schema.optionalKey(Schema.Number),
		model: Schema.NonEmptyString,
		provider: Schema.NonEmptyString,
		usage: Schema.optionalKey(Schema.Struct({ outputTokens: Schema.optionalKey(Schema.Number) })),
	}),
});

const decodeSuccessBody = Schema.decodeUnknownEffect(Schema.fromJsonString(GenerateApiSuccess));

function timeoutFailure(): CliGenerationError {
	return CliGenerationError.make({
		code: "generation_timeout",
		message: "The Sketchi generate API request timed out.",
		hint: "Retry once; if it persists, try a shorter prompt.",
		details: [],
	});
}

function decodeScene(value: unknown): Effect.Effect<PatchableScene, CliGenerationError> {
	const decoded = Schema.decodeUnknownResult(RenderedDiagramSceneSchema, {
		errors: "all",
		reportInput: true,
	})(value);
	return Result.isSuccess(decoded)
		? Effect.succeed(decoded.success)
		: Effect.fail(malformedResponse());
}

function decodeExcalidraw(value: unknown): Effect.Effect<ExcalidrawFile, CliGenerationError> {
	const decoded = Schema.decodeUnknownResult(ExcalidrawFileSchema, {
		errors: "all",
		reportInput: true,
	})(value);
	return Result.isSuccess(decoded)
		? Effect.succeed(decoded.success)
		: Effect.fail(malformedResponse());
}

const requestGeneration = Effect.fn("sketchi.cli.generate.request")(
	function* (
		input: GenerateDiagramInput & {
			readonly base?: { readonly document: CanonicalDiagramDocument; readonly id: string };
		},
	) {
		const response = yield* Effect.tryPromise({
			try: (signal) =>
				globalThis.fetch(input.endpoint, {
					method: "POST",
					headers: {
						"content-type": "application/json",
						"x-sketchi-client": "sketchi-cli",
					},
					body: JSON.stringify({
						prompt: input.prompt,
						...(input.type ? { type: input.type } : {}),
						// The API keeps a revision on the base's explicit id, so the base always names
						// the stored record's id, even for a record made without one.
						...(input.base
							? {
									base: {
										type: input.base.document.type,
										spec: { ...input.base.document.spec, id: input.base.id },
									},
								}
							: {}),
					}),
					signal,
				}),
			catch: () => networkFailure(),
		});
		const text = yield* readBoundedText(
			response,
			MAX_API_RESPONSE_BYTES,
			malformedResponse,
			networkFailure,
		);
		if (!response.ok) {
			const body = yield* decodeErrorBody(text).pipe(Effect.mapError(malformedResponse));
			return yield* endpointFailure(response.status, body);
		}
		const success = yield* decodeSuccessBody(text).pipe(Effect.mapError(malformedResponse));
		const { usage, ...generation } = success.generation;
		return {
			...success.diagram,
			...generation,
			...(usage?.outputTokens === undefined ? {} : { outputTokens: usage.outputTokens }),
			issues: success.issues ?? [],
		};
	},
	Effect.timeoutOrElse({
		duration: GENERATE_REQUEST_TIMEOUT,
		orElse: () => Effect.fail(timeoutFailure()),
	}),
);

/**
 * Draw the colors and shapes a request asked for on a just-stored diagram, as the record's next
 * revision: the scene becomes authoritative, as after sketchi patch, and the unstyled revision
 * stays restorable.
 */
const applyRequestedStyles = Effect.fn("sketchi.cli.generate.styles")(function* (
	diagram: StoredDiagram,
	scene: PatchableScene,
	patch: { readonly operations: ApplyDiagramPatchRequest["operations"] } | undefined,
) {
	if (patch === undefined) return diagram;
	const patcher = yield* DiagramPatcher;
	const store = yield* DiagramStore;
	const id = diagram.manifest.id;
	const artifacts = yield* patcher.patch(
		scene,
		{ operations: patch.operations, intent: "Colors and shapes the request asks for" },
		`cli-styles-${id}-${String(diagram.manifest.revision + 1)}`,
	);
	const styled = yield* store.commitPatch(id, diagram.manifest.revision, artifacts);
	// Styling is part of the same invocation, so the generation's warnings stay on its result.
	const warnings = [...(diagram.warnings ?? []), ...(styled.warnings ?? [])];
	return warnings.length === 0 ? styled : { ...styled, warnings };
});

export const generateDiagram = Effect.fn("sketchi.cli.generate")(function* (
	input: GenerateDiagramInput,
) {
	const store = yield* DiagramStore;
	const response = yield* requestGeneration(input);

	const document = yield* decodeCanonicalDiagramDocument(response.document).pipe(
		Effect.mapError(() => invalidGeneratedDocument()),
	);
	const id = yield* validateStorageId(documentId(document)).pipe(
		Effect.mapError(() => invalidGeneratedDocument()),
	);
	const scene = yield* decodeScene(response.scene);
	const excalidraw = yield* decodeExcalidraw(response.excalidraw);

	const built: BuiltDiagram = {
		id,
		warnings: response.issues.filter((entry) => entry.severity === "warning"),
		type: document.type,
		title: document.spec.title,
		document,
		scene,
		excalidraw,
		prompt: input.prompt,
	};
	const created = yield* store.create(built);
	const diagram = yield* applyRequestedStyles(created, built.scene, response.patch);

	return {
		diagram,
		model: response.model,
		provider: response.provider,
		...(response.attempts === undefined ? {} : { attempts: response.attempts }),
		...(response.durationMs === undefined ? {} : { durationMs: response.durationMs }),
		...(response.outputTokens === undefined ? {} : { outputTokens: response.outputTokens }),
	} satisfies GenerateDiagramResult;
});

function notRevisable(diagramId: string): CliValidationError {
	return CliValidationError.make({
		message: `Diagram "${diagramId}" was patched or restored from a drawing, so it has no document to revise.`,
		hint: "Restore a canonical revision with sketchi restore, or change the drawing with sketchi patch.",
		details: ["authority"],
	});
}

/**
 * Send a stored diagram's document with a request to change it, and keep the result as the
 * record's next revision. The generate API returns the complete revised document with the same id.
 */
export const reviseDiagram = Effect.fn("sketchi.cli.revise")(function* (input: ReviseDiagramInput) {
	const store = yield* DiagramStore;
	const current = yield* store.show(input.diagramId);
	const id = current.manifest.id;
	if (current.authority !== "canonical") {
		return yield* notRevisable(input.diagramId);
	}
	const stored = current.document;
	if (stored.type === "canvas") {
		return yield* CliValidationError.make({
			message: `Diagram "${input.diagramId}" is a hand-placed canvas, which generate does not make.`,
			hint: "Change a canvas with sketchi edit or sketchi patch.",
			details: ["document.type"],
		});
	}
	const response = yield* requestGeneration({
		endpoint: input.endpoint,
		prompt: input.prompt,
		...(input.type ? { type: input.type } : {}),
		base: { document: stored, id },
	});
	const document = yield* decodeCanonicalDiagramDocument(response.document).pipe(
		Effect.mapError(() => invalidGeneratedDocument()),
	);
	if (documentId(document) !== id) {
		return yield* invalidGeneratedDocument();
	}
	const scene = yield* decodeScene(response.scene);
	const excalidraw = yield* decodeExcalidraw(response.excalidraw);
	// Commit only on top of the revision the request was based on, so a change made while the
	// model ran is never silently undone.
	const edited = yield* store.edit(
		id,
		{
			id,
			warnings: response.issues.filter((entry) => entry.severity === "warning"),
			type: document.type,
			title: document.spec.title,
			document,
			scene,
			excalidraw,
		},
		current.manifest.revision,
	);
	const diagram = yield* applyRequestedStyles(edited, scene, response.patch);
	return {
		diagram,
		model: response.model,
		provider: response.provider,
		...(response.attempts === undefined ? {} : { attempts: response.attempts }),
		...(response.durationMs === undefined ? {} : { durationMs: response.durationMs }),
		...(response.outputTokens === undefined ? {} : { outputTokens: response.outputTokens }),
		...(response.edits === undefined ? {} : { edits: response.edits }),
	} satisfies GenerateDiagramResult;
});
