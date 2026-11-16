import { Array as Arr, String as Str, Option as Opt, Effect, Result, Schema } from "effect";
import "@tanstack/react-start/server-only";
import {
	buildCanonicalDocument,
	canonicalDocumentFromDiagram,
	buildResponse,
	BuildRuntimeEnvironment,
} from "@sketchi/diagrams/build";
import {
	decodeFlowchartDocument,
	flowchartDiagramFromDocument,
} from "@sketchi/diagrams/families/flowchart/document";
import {
	DIAGRAM_TYPES,
	familyForType,
	type CanonicalDiagramDocument,
	type FamilyBuildResult,
} from "@sketchi/diagrams/family";
import {
	extractJsonObject,
	WRONG_DIAGRAM_TYPE_ERROR,
	type DiagramGenerationCandidate,
} from "@sketchi/diagrams/generate/candidates";
import { type DiagramGenerationError } from "@sketchi/diagrams/generate/errors";
import { type DiagramGenerationType } from "@sketchi/diagrams/generate/intent";
import { isSupportedGenerationModel } from "@sketchi/diagrams/generate/models";
import { type DiagramStyle } from "@sketchi/diagrams/generate/styling";
import {
	GenerateRequest,
	MAX_GENERATE_PROMPT_LENGTH,
	MAX_GENERATE_REQUEST_BYTES,
	type GenerateAccepted,
	type GenerateIssue,
	GenerateWarning,
	type GenerateRejected,
	type GenerateResult,
} from "@sketchi/diagrams/generate/contract";
import { listAlternatives } from "@sketchi/diagrams/generate/messages";
import { type DiagramPatchOperation } from "@sketchi/diagrams/canvas/patch-contract";
import { withTelemetryCorrelation } from "@sketchi/observability";
import { applyDiagramPatch } from "@sketchi/diagrams/canvas/patch";
import { type JsonBody } from "../build/json-body.server";
import { PlaygroundBindings, PlaygroundRequestMetadata } from "../../server/context.server";
import { PlaygroundGeneration } from "./service.server";

const decodeGenerateRequest = Schema.decodeUnknownResult(GenerateRequest, { errors: "all" });
const GENERATE_REQUEST_COPY = {
	invalidInput: `The generate request must include a string prompt and an optional type of ${listAlternatives(DIAGRAM_TYPES)}.`,
	invalidBase: "The base diagram is not a valid Sketchi document.",
	requestValidBase:
		"Send the stored document's type and spec unchanged, or omit base for a new diagram.",
	unsupportedModel: "The requested model is not supported.",
	requestSupportedModel: "Omit the model to use the default.",
} as const;
type BuildResult = FamilyBuildResult;
type BuiltArtifact = Extract<
	BuildResult,
	{
		readonly ok: true;
	}
>["artifact"];
type GenerateFailureStatus = GenerateRejected["status"];
type GenerateFailure = GenerateRejected;
const isGenerateWarning = Schema.is(GenerateWarning);
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
	if (candidate.mindmapError?.code === "mindmap_too_large") {
		return failure("limit_exceeded", [
			issue(
				candidate.mindmapError.code,
				"build",
				candidate.mindmapError.message,
				candidate.mindmapError.hint,
			),
		]);
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
			? Arr.map(diagnostics, (diagnostic) =>
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
			Opt.getOrUndefined(
				Arr.findFirst(candidate.diagnostics, (entry) =>
					Str.startsWith("explicit_type_not_met")(entry),
				),
			) ?? candidate.error,
			"Retry, or omit the type to let the prompt decide.",
		),
	]);
}
export function buildFailure(
	result: Extract<
		BuildResult,
		{
			ok: false;
		}
	>,
): GenerateFailure {
	const issues = Arr.map(result.issues, (entry) =>
		issue(entry.code, "build", entry.message, entry.hint ?? "Refine the prompt and retry."),
	);
	// A family's size limit, such as a mindmap's topic count, is a limit and not a defect.
	if (Arr.some(result.issues, (entry) => Str.endsWith("_too_large")(entry.code))) {
		return failure("limit_exceeded", issues);
	}
	switch (result.status) {
		// So is a drawing too large for one canvas. As with a family limit, repair could only
		// fit it by dropping what the request states, so the caller splits the request.
		case "limit_exceeded":
			return failure(
				"limit_exceeded",
				Arr.map(issues, (entry) =>
					entry.code === "canvas_limit_exceeded"
						? { ...entry, hint: "Split the request into smaller diagrams." }
						: entry,
				),
			);
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
	const ref = Opt.getOrUndefined(
		Arr.findFirst(artifact.formats, (candidate) => candidate.format === format),
	);
	return ref?.inline;
}
/**
 * The stored document a revision starts from, as the canonical diagram JSON the model reads, or
 * undefined when its spec is not a valid document of its type.
 */
function baseDiagram(base: NonNullable<GenerateRequest["base"]>):
	| {
			readonly diagram: Readonly<Record<string, unknown>>;
			readonly id?: string;
	  }
	| undefined {
	const decoded = Schema.decodeUnknownResult(familyForType(base.type).spec)(base.spec);
	if (Result.isFailure(decoded) || typeof base.spec !== "object" || base.spec === null) {
		return undefined;
	}
	const spec = base.spec as Readonly<Record<string, unknown>>;
	if (base.type === "flowchart") {
		// A flowchart revises its document, which must still draw.
		const document = decodeFlowchartDocument(base.spec);
		if (Result.isFailure(document)) return undefined;
		const built = flowchartDiagramFromDocument(document.success);
		if (!built.ok) return undefined;
		return { diagram: { type: "flowchart", ...document.success }, id: built.diagram.id };
	}
	return {
		diagram: { type: base.type, ...spec },
		...(typeof spec["id"] === "string" ? { id: spec["id"] } : {}),
	};
}
/** The patch operations that draw the styles a response asked for. */
function styleOperations(styles: ReadonlyArray<DiagramStyle>): DiagramPatchOperation[] {
	return Arr.flatMap(styles, (style): DiagramPatchOperation[] => {
		const targets = [...style.targets];
		const selector = { nodeIds: targets, edgeIds: targets, labels: targets };
		const colors = {
			...(style.fillColor ? { fillColor: style.fillColor } : {}),
			...(style.strokeColor ? { strokeColor: style.strokeColor } : {}),
			...(style.textColor ? { textColor: style.textColor } : {}),
		};
		return [
			...(style.fillColor || style.strokeColor || style.textColor
				? [{ op: "setStyle" as const, selector, style: colors }]
				: []),
			...(style.shape
				? [
						{
							op: "setShape" as const,
							selector: { nodeIds: targets, labels: targets },
							shape: style.shape,
						},
					]
				: []),
		];
	});
}
/** What one generate request answered, and the request as usage records it. */
export interface GenerateOutcome {
	readonly requestBody: unknown;
	readonly result: GenerateResult;
}

/**
 * Generates one diagram from a read request body. The HTTP host owns transport and usage capture;
 * this owns the request's validation, the model call and the build that draws its answer.
 */
export const generateDiagram = Effect.fn("playground.generate")(function* (bounded: JsonBody) {
	const generation = yield* PlaygroundGeneration;
	const env = yield* PlaygroundBindings;
	const metadata = yield* PlaygroundRequestMetadata;
	const finish = (requestBody: unknown, result: GenerateResult) =>
		Effect.succeed<GenerateOutcome>({ requestBody, result });
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
	const prompt = Str.trim(input.prompt);
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
		prompt,
		...(requestedType ? { type: requestedType } : {}),
		...(model ? { model } : {}),
		...(base ? { base: base.diagram } : {}),
	};
	const candidateResult = yield* withTelemetryCorrelation(generation.generate(generationInput), {
		attemptId: metadata.attemptId,
		runId: metadata.runId,
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
	const diagram = candidate.diagram;
	// A revised diagram keeps the id of the record it replaces. A flowchart builds from the
	// document the model wrote.
	const document: CanonicalDiagramDocument | undefined =
		diagram === undefined
			? undefined
			: diagram.type === "flowchart"
				? candidate.flowchart && {
						type: "flowchart",
						spec: { ...candidate.flowchart, ...(base?.id === undefined ? {} : { id: base.id }) },
					}
				: canonicalDocumentFromDiagram(
						base?.id === undefined ? diagram : { ...diagram, id: base.id },
					);
	if (malformed || !candidate.diagram || !document) {
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
	const spec = document.spec;
	const buildResult: BuildResult = yield* Effect.gen(function* () {
		return yield* buildResponse(
			buildCanonicalDocument(document, {
				artifactFormats: ["scene", "excalidraw"],
				inlineArtifacts: ["scene", "excalidraw"],
			}),
		);
	}).pipe(
		Effect.updateService(BuildRuntimeEnvironment, (capabilities) => ({
			...capabilities,
			fillNamedLogos: true,
		})),
	);
	if (!buildResult.ok) {
		return yield* finish({ prompt, type, spec }, buildFailure(buildResult));
	}
	const scene = inlineArtifact(buildResult.artifact, "scene");
	const excalidraw = inlineArtifact(buildResult.artifact, "excalidraw");
	// A flowchart's node colors and diamonds are in its document, and its drawing is never patched:
	// what styles are left (an edge color, a text color, another shape) is reported, not drawn.
	const unstyled: GenerateWarning[] =
		type === "flowchart" && candidate.styles?.length
			? [
					{
						code: "unsupported_patch_operation",
						severity: "warning",
						stage: "input",
						ref: { kind: "request", path: "styles" },
						message: `A flowchart draws node colors and diamonds only, so ${Arr.join(
							Arr.map(candidate.styles, (style) =>
								Str.concat(
									Arr.join(
										Arr.filter(
											[
												style.strokeColor || style.fillColor ? "the color" : undefined,
												style.textColor ? "the text color" : undefined,
												style.shape ? `the ${style.shape} shape` : undefined,
											],
											(value): value is string => value !== undefined,
										),
										" and ",
									),
									` of ${Arr.join(style.targets, ", ")}`,
								),
							),
							"; ",
						)} was not drawn.`,
						hint: "Color nodes, not edges or text, and use the flowchart's own shapes.",
					},
				]
			: [];
	// Styles reach the caller only when they apply to the built diagram; otherwise it draws unstyled.
	const operations = type === "flowchart" ? [] : styleOperations(candidate.styles ?? []);
	const styled =
		operations.length === 0
			? undefined
			: yield* buildResponse(
					applyDiagramPatch({
						source: { artifactId: buildResult.artifact.artifactId },
						intent: "Colors and shapes the request asks for",
						operations,
						options: { artifactFormats: ["scene"], inlineArtifacts: [] },
					}),
				).pipe(
					Effect.updateService(BuildRuntimeEnvironment, (capabilities) => ({
						...capabilities,
						fillNamedLogos: true,
					})),
				);
	const styleIssues: GenerateWarning[] =
		styled === undefined || styled.ok
			? []
			: [
					{
						code: "unknown_patch_target",
						severity: "warning",
						stage: "input",
						ref: { kind: "request", path: "styles" },
						message: "The colors or shapes the request asked for did not match the diagram.",
						hint: "Name the steps to style by their labels, or patch the stored diagram.",
					},
				];
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
	const success: GenerateAccepted = {
		ok: true,
		status: "generated",
		issues: [
			...Arr.map(candidate.warnings ?? [], (warning): GenerateWarning => ({
				code: warning.code,
				severity: warning.severity,
				stage: "input",
				ref: { kind: "request", path: `spec.${warning.path}` },
				message: warning.message,
				hint: warning.hint,
			})),
			// A build warning outside the published codes would make the body undecodable by
			// installed CLIs, so only published warnings travel.
			...Arr.filter(
				buildResult.issues,
				(entry): entry is GenerateWarning =>
					entry.severity === "warning" && isGenerateWarning(entry),
			),
			...styleIssues,
			...unstyled,
		],
		diagram: {
			document: { type, spec },
			scene,
			excalidraw,
			...(styled?.ok ? { patch: { operations } } : {}),
			...(candidate.edits ? { edits: candidate.edits } : {}),
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
