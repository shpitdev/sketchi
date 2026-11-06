import "@tanstack/react-start/server-only";

import {
	type BuildFlowchartOptions,
	CANONICAL_DOCUMENT_SPECS,
	type CanonicalBuildResult,
	type CodeModeIssue,
	type CanonicalDiagramDocument,
	canonicalDocumentFromDiagram,
} from "@sketchi/diagram-agent";
import {
	extractJsonObject,
	type DiagramGenerationCandidate,
	type DiagramGenerationError,
	type DiagramGenerationType,
	isSupportedGenerationModel,
	WRONG_DIAGRAM_TYPE_ERROR,
} from "@sketchi/diagram-generation";
import { withTelemetryCorrelation } from "@sketchi/observability";
import { Effect, Result, Schema } from "effect";

import { resultHttpStatus } from "../runtime/http-status.server";
import { readBoundedJson } from "../runtime/request-body.server";
import {
	PlaygroundCodeMode,
	type PlaygroundCodeModeShape,
	PlaygroundNamedLogoFill,
} from "../codemode/service.server";
import {
	codeModeUsageResponseHeaders,
	PlaygroundCodeModeUsage,
} from "../codemode/usage-events.server";
import { PlaygroundBindings, PlaygroundClock } from "../runtime/context.server";
import { decodeGenerateRequest, GENERATE_REQUEST_COPY, type GenerateBaseSchema } from "./request";
import { PlaygroundGeneration } from "./service.server";

// Room for a pasted roster, DDL schema or task list of the largest diagrams the
// family limits allow: 25 tables of DDL with their usual columns run past 8,000.
export const MAX_GENERATE_REQUEST_BYTES = 64 * 1024;
export const MAX_GENERATE_PROMPT_LENGTH = 20_000;

type BuildResult = CanonicalBuildResult;
type BuiltArtifact = Extract<BuildResult, { readonly ok: true }>["artifact"];

type GenerateFailureStatus =
	| "invalid_input"
	| "provider_failed"
	| "generation_timeout"
	| "limit_exceeded"
	| "unsupported_model"
	| "malformed_output"
	| "invalid_generated_document"
	| "quality_failed"
	| "render_failed"
	| "export_failed"
	| "storage_failed";

interface GenerateIssue {
	readonly code: string;
	readonly severity: "error";
	readonly stage: "input" | "generation" | "build";
	readonly message: string;
	readonly hint: string;
}

interface GenerateFailure {
	readonly ok: false;
	readonly status: GenerateFailureStatus;
	readonly issues: ReadonlyArray<GenerateIssue>;
}

interface GenerateSuccess {
	readonly issues: ReadonlyArray<CodeModeIssue>;
	readonly ok: true;
	readonly status: "generated";
	readonly diagram: {
		readonly document: {
			readonly type: DiagramGenerationType;
			readonly spec: unknown;
		};
		readonly scene: unknown;
		readonly excalidraw: unknown;
	};
	readonly generation: {
		readonly attempts?: number;
		readonly durationMs?: number;
		readonly model: string;
		readonly provider: string;
		readonly usage?: { readonly inputTokens?: number; readonly outputTokens?: number };
	};
}

type GenerateResult = GenerateSuccess | GenerateFailure;

function issue(
	code: string,
	stage: GenerateIssue["stage"],
	message: string,
	hint: string,
): GenerateIssue {
	return { code, severity: "error", stage, message, hint };
}

function failure(
	status: GenerateFailureStatus,
	issues: ReadonlyArray<GenerateIssue>,
): GenerateFailure {
	return { ok: false, status, issues };
}

function jsonResponse(body: unknown, status: number, extraHeaders: HeadersInit = {}): Response {
	const headers = new Headers(extraHeaders);
	headers.set("Cache-Control", "no-store");
	return Response.json(body, { status, headers });
}

function generationErrorFailure(error: DiagramGenerationError): GenerateFailure {
	switch (error._tag) {
		case "DiagramGenerationConfigurationError":
		case "DiagramGenerationHttpError":
		case "DiagramGenerationTransportError":
			return failure("provider_failed", [
				issue(
					"provider_failed",
					"generation",
					"The generation provider could not complete the request.",
					"Retry once; if it persists, try a shorter or clearer prompt.",
				),
			]);
		case "DiagramGenerationTimeoutError":
			return failure("generation_timeout", [
				issue(
					"generation_timeout",
					"generation",
					error.message,
					"Retry once; if it persists, try a shorter prompt.",
				),
			]);
		case "DiagramGenerationLimitError":
			return failure("limit_exceeded", [
				issue(
					error.limit === "output_tokens" ? "output_limit_exceeded" : "diagram_too_large",
					"generation",
					error.message,
					"Split the request into smaller diagrams.",
				),
			]);
		case "DiagramGenerationResponseError":
			return failure("malformed_output", [
				issue(
					"malformed_output",
					"generation",
					"The generation provider returned an unreadable response.",
					"Retry once; if it persists, try another prompt.",
				),
			]);
		case "DiagramGenerationInputError":
			return failure("invalid_input", [
				issue(
					"invalid_input",
					"input",
					"The generation request could not be prepared.",
					"Send a concrete prompt describing one diagram.",
				),
			]);
	}
}

function malformedCandidateFailure(
	candidate: DiagramGenerationCandidate,
): GenerateFailure | undefined {
	if (candidate.diagram) {
		return undefined;
	}
	const canParse = (() => {
		try {
			extractJsonObject(candidate.text);
			return true;
		} catch {
			return false;
		}
	})();
	const diagnostics = candidate.diagnostics.slice(0, 8);
	return failure(
		"malformed_output",
		diagnostics.length > 0
			? diagnostics.map((diagnostic) =>
					issue(
						"malformed_output",
						"generation",
						diagnostic,
						"Return one complete diagram JSON object that resolves this diagnostic.",
					),
				)
			: [
					issue(
						"malformed_output",
						"generation",
						canParse
							? "The generation provider output did not describe a valid diagram."
							: "The generation provider output did not contain one JSON object.",
						"Retry once; if it persists, try another prompt.",
					),
				],
	);
}

function wrongTypeFailure(candidate: DiagramGenerationCandidate): GenerateFailure | undefined {
	if (candidate.error !== WRONG_DIAGRAM_TYPE_ERROR) return undefined;
	return failure("quality_failed", [
		issue(
			"explicit_type_not_met",
			"generation",
			candidate.diagnostics.find((entry) => entry.startsWith("explicit_type_not_met")) ??
				candidate.error,
			"Retry, or omit the type to let the prompt decide.",
		),
	]);
}

function buildFailure(result: Extract<BuildResult, { ok: false }>): GenerateFailure {
	const issues = result.issues.map((entry) =>
		issue(entry.code, "build", entry.message, entry.hint ?? "Refine the prompt and retry."),
	);
	// A family's size limit, such as a mindmap's topic count, is a limit and not a defect.
	if (result.issues.some((entry) => entry.code.endsWith("_too_large"))) {
		return failure("limit_exceeded", issues);
	}
	switch (result.status) {
		case "invalid_input":
		case "invalid_flowchart":
		case "invalid_mindmap":
		case "invalid_sequence":
		case "invalid_timeline":
		case "invalid_chart":
		case "invalid_state_machine":
		case "invalid_gantt":
		case "invalid_er_diagram":
		case "invalid_class_diagram":
		case "invalid_org_chart":
		case "invalid_venn_diagram":
		case "invalid_journey":
		case "invalid_sankey":
		case "invalid_wireframe":
		case "invalid_quadrant_chart":
			return failure("invalid_generated_document", issues);
		case "quality_failed":
			return failure("quality_failed", issues);
		case "render_failed":
			return failure("render_failed", issues);
		case "export_failed":
			return failure("export_failed", issues);
		case "storage_failed":
			return failure("storage_failed", issues);
	}
}

function inlineArtifact(artifact: BuiltArtifact, format: "scene" | "excalidraw"): unknown {
	const ref = artifact.formats.find((candidate) => candidate.format === format);
	return ref?.inline;
}

/**
 * The stored document a revision starts from, as the canonical diagram JSON the model reads, or
 * undefined when its spec is not a valid document of its type.
 */
function baseDiagram(
	base: typeof GenerateBaseSchema.Type,
): { readonly diagram: Readonly<Record<string, unknown>>; readonly id?: string } | undefined {
	const decoded = Schema.decodeUnknownResult(CANONICAL_DOCUMENT_SPECS[base.type])(base.spec);
	if (Result.isFailure(decoded) || typeof base.spec !== "object" || base.spec === null) {
		return undefined;
	}
	const spec = base.spec as Readonly<Record<string, unknown>>;
	return {
		diagram: { type: base.type, ...spec },
		...(typeof spec["id"] === "string" ? { id: spec["id"] } : {}),
	};
}

/** Build a generated document with its family's Code Mode operation. */
function buildWithCodeMode(
	codeMode: PlaygroundCodeModeShape,
	document: CanonicalDiagramDocument,
	options: NonNullable<BuildFlowchartOptions>,
) {
	const request = { spec: document.spec, options };
	switch (document.type) {
		case "flowchart":
			return codeMode.buildFlowchart(request);
		case "mindmap":
			return codeMode.buildMindmap(request);
		case "timeline":
			return codeMode.buildTimeline(request);
		case "chart":
			return codeMode.buildChart(request);
		case "sequence":
			return codeMode.buildSequenceDiagram(request);
		case "state-machine":
			return codeMode.buildStateMachine(request);
		case "gantt":
			return codeMode.buildGantt(request);
		case "er":
			return codeMode.buildErDiagram(request);
		case "class":
			return codeMode.buildClassDiagram(request);
		case "org-chart":
			return codeMode.buildOrgChart(request);
		case "venn":
			return codeMode.buildVennDiagram(request);
		case "journey":
			return codeMode.buildJourneyMap(request);
		case "sankey":
			return codeMode.buildSankey(request);
		case "wireframe":
			return codeMode.buildWireframe(request);
		case "quadrant":
			return codeMode.buildQuadrantChart(request);
	}
}

export const handleGenerateDiagramRequest = Effect.fn("playground.http.generate")(function* (
	request: Request,
) {
	const clock = yield* PlaygroundClock;
	const codeMode = yield* PlaygroundCodeMode;
	const generation = yield* PlaygroundGeneration;
	const usage = yield* PlaygroundCodeModeUsage;
	const env = yield* PlaygroundBindings;
	const usageContext = yield* usage.createContext;
	const startedAt = yield* clock.nowMillis;

	const finish = (requestBody: unknown, result: GenerateResult) =>
		Effect.gen(function* () {
			const status = resultHttpStatus(result);
			const finishedAt = yield* clock.nowMillis;
			yield* usage.capture({
				context: usageContext,
				durationMs: finishedAt - startedAt,
				operation: "generateDiagram",
				requestBody,
				responseBody: result,
				statusCode: status,
				surface: "api",
			});
			return jsonResponse(result, status, codeModeUsageResponseHeaders(usageContext));
		});

	const bounded = yield* readBoundedJson(request, MAX_GENERATE_REQUEST_BYTES);
	if (bounded._tag === "TooLarge") {
		return yield* finish(
			{ omitted: true },
			failure("invalid_input", [
				issue(
					"request_too_large",
					"input",
					`The generate request exceeds the ${MAX_GENERATE_REQUEST_BYTES}-byte limit.`,
					"Send a shorter prompt.",
				),
			]),
		);
	}
	if (bounded._tag === "InvalidJson") {
		return yield* finish(
			{},
			failure("invalid_input", [
				issue(
					"invalid_json",
					"input",
					"The generate request body was not valid JSON.",
					"Send a JSON object with a prompt field.",
				),
			]),
		);
	}

	const rawBody = bounded.body;
	const decoded = decodeGenerateRequest(rawBody);
	if (Result.isFailure(decoded)) {
		return yield* finish(
			rawBody,
			failure("invalid_input", [
				issue(
					"invalid_input",
					"input",
					GENERATE_REQUEST_COPY.invalidInput,
					'Send { "prompt": "...", "type": "sequence" }.',
				),
			]),
		);
	}
	const input = decoded.success;
	const prompt = input.prompt.trim();
	if (!prompt || prompt.length > MAX_GENERATE_PROMPT_LENGTH) {
		return yield* finish(
			rawBody,
			failure("invalid_input", [
				issue(
					"invalid_input",
					"input",
					prompt
						? `The prompt exceeds the ${MAX_GENERATE_PROMPT_LENGTH}-character limit.`
						: "The prompt must not be empty.",
					"Send a concrete prompt describing one diagram.",
				),
			]),
		);
	}
	const model = input.model;
	if (model !== undefined && !isSupportedGenerationModel(model)) {
		return yield* finish(
			rawBody,
			failure("unsupported_model", [
				issue(
					"unsupported_model",
					"input",
					GENERATE_REQUEST_COPY.unsupportedModel,
					GENERATE_REQUEST_COPY.requestSupportedModel,
				),
			]),
		);
	}
	const base = input.base === undefined ? undefined : baseDiagram(input.base);
	if (input.base !== undefined && base === undefined) {
		return yield* finish(
			rawBody,
			failure("invalid_input", [
				issue(
					"invalid_base",
					"input",
					GENERATE_REQUEST_COPY.invalidBase,
					GENERATE_REQUEST_COPY.requestValidBase,
				),
			]),
		);
	}
	// A revision keeps its family unless the caller names another.
	const requestedType = input.type ?? input.base?.type;
	const generationInput = {
		...(input.cacheMode ? { cacheMode: input.cacheMode } : {}),
		prompt,
		...(requestedType ? { type: requestedType } : {}),
		...(model ? { model } : {}),
		...(base ? { base: base.diagram } : {}),
	};

	const candidateResult = yield* withTelemetryCorrelation(generation.generate(generationInput), {
		attemptId: usageContext.attemptId,
		runId: usageContext.runId,
	}).pipe(
		Effect.match({
			onFailure: (error) => ({ ok: false as const, error }),
			onSuccess: (candidate) => ({ ok: true as const, candidate }),
		}),
	);
	if (!candidateResult.ok) {
		return yield* finish(generationInput, generationErrorFailure(candidateResult.error));
	}
	const candidate = candidateResult.candidate;
	const wrongType = wrongTypeFailure(candidate);
	if (wrongType) {
		return yield* finish(generationInput, wrongType);
	}
	const malformed = malformedCandidateFailure(candidate);
	if (malformed || !candidate.diagram) {
		return yield* finish(
			generationInput,
			malformed ??
				failure("malformed_output", [
					issue(
						"malformed_output",
						"generation",
						"The generation provider output did not describe a valid diagram.",
						"Retry once; if it persists, try another prompt.",
					),
				]),
		);
	}
	if (requestedType && candidate.diagram.type !== requestedType) {
		return yield* finish(
			generationInput,
			failure("invalid_generated_document", [
				issue(
					"invalid_generated_document",
					"generation",
					`The generation provider returned a ${candidate.diagram.type} for a ${requestedType} request.`,
					"Retry once; if it persists, rephrase the prompt.",
				),
			]),
		);
	}
	const type: DiagramGenerationType = candidate.diagram.type;

	// A revised diagram keeps the id of the record it replaces.
	const document = canonicalDocumentFromDiagram(
		base?.id === undefined ? candidate.diagram : { ...candidate.diagram, id: base.id },
	);
	const spec = document.spec;
	const buildResult: BuildResult = yield* Effect.gen(function* () {
		return yield* buildWithCodeMode(codeMode, document, {
			artifactFormats: ["scene", "excalidraw"],
			inlineArtifacts: ["scene", "excalidraw"],
		});
	}).pipe(Effect.provideService(PlaygroundNamedLogoFill, true));
	if (!buildResult.ok) {
		return yield* finish({ prompt, type, spec }, buildFailure(buildResult));
	}

	const scene = inlineArtifact(buildResult.artifact, "scene");
	const excalidraw = inlineArtifact(buildResult.artifact, "excalidraw");
	if (scene === undefined || excalidraw === undefined) {
		return yield* finish(
			{ prompt, type, spec },
			failure("export_failed", [
				issue(
					"missing_inline_artifact",
					"build",
					"The generated diagram was built without the inline scene or Excalidraw artifact.",
					"Retry once; if it persists, report the prompt.",
				),
			]),
		);
	}

	const success: GenerateSuccess = {
		ok: true,
		status: "generated",
		issues: [
			...(candidate.warnings ?? []).map((warning): CodeModeIssue => ({
				code: warning.code,
				severity: warning.severity,
				stage: "input",
				ref: { kind: "request", path: `spec.${warning.path}` },
				message: warning.message,
				hint: warning.hint,
			})),
			...buildResult.issues.filter((entry) => entry.severity === "warning"),
		],
		diagram: {
			document: { type, spec },
			scene,
			excalidraw,
		},
		generation: {
			...(candidate.attempts === undefined ? {} : { attempts: candidate.attempts }),
			...(candidate.durationMs === undefined ? {} : { durationMs: candidate.durationMs }),
			model: candidate.model || generation.defaultModel(env),
			provider: candidate.provider,
			...(candidate.usage?.outputTokens === undefined
				? {}
				: {
						usage: {
							...(candidate.usage.inputTokens === undefined
								? {}
								: { inputTokens: candidate.usage.inputTokens }),
							outputTokens: candidate.usage.outputTokens,
						},
					}),
		},
	};
	return yield* finish({ prompt, type, spec }, success);
});
