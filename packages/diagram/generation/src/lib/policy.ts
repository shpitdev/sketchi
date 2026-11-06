import { recordMetric, withTelemetryCorrelation } from "@sketchi/observability";
import { Cause, Clock, Effect, Exit, Metric, Ref, Result, Schedule } from "effect";

import {
	type DiagramGenerationCandidate,
	type DiagramGenerationProviderId,
	type DiagramGenerationRequest,
	type DiagramGenerationUsage,
	enforceCandidateRequestRequirements,
} from "./candidates.js";
import type { DiagramGenerationPolicyConfig } from "./client.js";
import {
	type DiagramGenerationError,
	DiagramGenerationLimitError,
	DiagramGenerationTimeoutError,
	generationErrorToCandidate,
	isRetryableGenerationError,
} from "./errors.js";
import { checkRequestCoverage, type CoverageIssue, keepsStatedStructure } from "./coverage.js";

const generationAttempts = Metric.counter("sketchi_generation_attempts", {
	description: "Diagram generation upstream attempts",
	incremental: true,
});
const generationRequests = Metric.counter("sketchi_generation_requests", {
	description: "Diagram generation requests by terminal outcome",
	incremental: true,
});
const generationRetries = Metric.counter("sketchi_generation_retries", {
	description: "Diagram generation retry attempts",
	incremental: true,
});
const generationRepairs = Metric.counter("sketchi_generation_repairs", {
	description: "Diagram generation semantic repair attempts by outcome",
	incremental: true,
});
const generationCoverageRepairs = Metric.counter("sketchi_generation_coverage_repairs", {
	description: "Repairs of accepted diagrams that miss what their request states, by outcome",
	incremental: true,
});
const generationFailures = Metric.counter("sketchi_generation_failures", {
	description: "Diagram generation terminal failures",
	incremental: true,
});
const generationTimeouts = Metric.counter("sketchi_generation_timeouts", {
	description: "Diagram generation upstream timeouts",
	incremental: true,
});
const generationDuration = Metric.histogram("sketchi_generation_duration_ms", {
	description: "Diagram generation request duration in milliseconds",
	boundaries: Metric.boundariesFromIterable([
		50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 30_000, 60_000, 90_000, 120_000,
	]),
});

function isAcceptedCandidate(candidate: DiagramGenerationCandidate): boolean {
	return Boolean(candidate.diagram);
}

const seconds = (milliseconds: number) => String(Math.round(milliseconds / 100) / 10);

/** A family validator's size limit, such as `flowchart.flowchart_too_large: ...`. */
const DIAGRAM_SIZE_LIMIT = /^[a-z-]+\.[a-z_]+_too_large: /;
/**
 * Size limits on how a diagram is arranged rather than how much it states: how
 * deep components or zones nest, how deep reporting chains run, how many stages
 * a flow passes. A model can meet these by restructuring, such as dropping a
 * redundant wrapper, without losing stated content, so repair still applies.
 */
const LAYOUT_BOUND =
	/\bnest \d+ (?:levels )?deep\b|\brun \d+ levels deep\b|\bruns through \d+ stages\b/;

/** A limit on how much the diagram holds, which repair can only meet by dropping content. */
export function isDiagramSizeLimitDiagnostic(diagnostic: string): boolean {
	return DIAGRAM_SIZE_LIMIT.test(diagnostic) && !LAYOUT_BOUND.test(diagnostic);
}

/** The validator's own sentence, without its family code or its repair hint. */
function diagramSizeLimitMessage(diagnostic: string): string {
	return diagnostic.replace(DIAGRAM_SIZE_LIMIT, "").replace(/ Hint: .*$/s, "");
}

/** Every call a request makes is billed, so its usage is their sum. */
function addUsage(
	total: DiagramGenerationUsage | undefined,
	next: DiagramGenerationUsage | undefined,
): DiagramGenerationUsage | undefined {
	if (!next) return total;
	if (!total) return next;
	const sum = (a: number | undefined, b: number | undefined) =>
		a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0);
	const inputTokens = sum(total.inputTokens, next.inputTokens);
	const outputTokens = sum(total.outputTokens, next.outputTokens);
	const totalTokens = sum(total.totalTokens, next.totalTokens);
	return {
		...(inputTokens === undefined ? {} : { inputTokens }),
		...(outputTokens === undefined ? {} : { outputTokens }),
		...(totalTokens === undefined ? {} : { totalTokens }),
	};
}

export const runDiagramGenerationWithPolicy = Effect.fn("diagramGeneration.runWithPolicy")(
	function* (
		prepareAttempt: (
			request: DiagramGenerationRequest,
		) => Effect.Effect<DiagramGenerationCandidate, DiagramGenerationError>,
		request: DiagramGenerationRequest,
		provider: DiagramGenerationProviderId,
		policy: DiagramGenerationPolicyConfig,
	) {
		const startedAt = yield* Clock.currentTimeMillis;
		const deadline = startedAt + policy.totalTimeoutMs;
		const requestTimeout = () =>
			DiagramGenerationTimeoutError.make({
				message: `Generation did not finish within its ${seconds(policy.totalTimeoutMs)}-second limit.`,
				provider,
				scope: "request",
				timeoutMs: policy.totalTimeoutMs,
			});
		const callsRef = yield* Ref.make(0);
		const usageRef = yield* Ref.make<DiagramGenerationUsage | undefined>(undefined);
		const executeModelCall = Effect.fn("diagramGeneration.executeModelCall")(function* (
			callRequest: DiagramGenerationRequest,
		) {
			const attempt = prepareAttempt(callRequest);
			const attemptRef = yield* Ref.make(0);
			const previousErrorTagRef = yield* Ref.make("initial");
			const measuredAttempt = Effect.gen(function* () {
				const attemptNumber = yield* Ref.updateAndGet(attemptRef, (value) => value + 1);
				if (attemptNumber > 1) {
					const previousErrorTag = yield* Ref.get(previousErrorTagRef);
					yield* recordMetric(generationRetries, 1, {
						operation: "generate",
						provider,
						retryKind: "transient",
					});
					yield* Effect.logWarning("Retrying diagram generation", {
						attempt: attemptNumber,
						error_tag: previousErrorTag,
						operation: "generate",
						provider,
						retry_kind: "transient",
					});
				}
				// Each call gets its own limit, cut short by what is left of the request's,
				// and none starts once the request's is spent.
				const remainingMs = deadline - (yield* Clock.currentTimeMillis);
				if (remainingMs <= 0) return yield* requestTimeout();
				const scope = remainingMs < policy.requestTimeoutMs ? "request" : "attempt";
				const timeoutMs = Math.min(policy.requestTimeoutMs, remainingMs);
				return yield* attempt.pipe(
					Effect.onExit((exit) => {
						const failure = Exit.isFailure(exit) ? Cause.findError(exit.cause) : undefined;
						// Initialization is not an upstream call, even when its error is replayed.
						if (
							failure &&
							Result.isSuccess(failure) &&
							failure.success._tag === "DiagramGenerationTransportError" &&
							failure.success.operation === "ai.gateway"
						) {
							return Effect.void;
						}
						return Effect.andThen(
							Ref.update(callsRef, (calls) => calls + 1),
							recordMetric(generationAttempts, 1, {
								operation: "generate",
								provider,
							}),
						);
					}),
					Effect.tap((candidate) =>
						Ref.update(usageRef, (total) => addUsage(total, candidate.usage)),
					),
					Effect.annotateSpans({ attempt: attemptNumber }),
					Effect.timeoutOrElse({
						duration: timeoutMs,
						orElse: () =>
							Effect.fail(
								scope === "request"
									? requestTimeout()
									: DiagramGenerationTimeoutError.make({
											message: `A model call did not finish within its ${seconds(policy.requestTimeoutMs)}-second limit.`,
											provider,
											scope,
											timeoutMs: policy.requestTimeoutMs,
										}),
							),
					}),
					Effect.tapError((error) => Ref.set(previousErrorTagRef, error._tag)),
				);
			});
			const remainingMs = deadline - (yield* Clock.currentTimeMillis);
			if (remainingMs <= 0) return yield* requestTimeout();
			const candidate = yield* measuredAttempt.pipe(
				Effect.retry({
					schedule: Schedule.exponential(policy.retryDelayMs),
					times: policy.maxRetries,
					while: isRetryableGenerationError,
				}),
				// A retry's backoff ends at the request's limit too, not past it.
				Effect.timeoutOrElse({
					duration: remainingMs,
					orElse: () => Effect.fail(requestTimeout()),
				}),
			);
			// Repair could only meet a family limit by dropping what the request states.
			const tooLarge = candidate.diagnostics.filter(isDiagramSizeLimitDiagnostic);
			if (tooLarge.length > 0) {
				return yield* DiagramGenerationLimitError.make({
					diagnostics: tooLarge,
					limit: "diagram_size",
					message: diagramSizeLimitMessage(tooLarge[0]!),
					provider,
				});
			}
			return candidate;
		});

		const operation = Effect.gen(function* () {
			const originalCandidate = enforceCandidateRequestRequirements(
				yield* executeModelCall(request),
				request,
			);
			let latestCandidate = originalCandidate;
			let candidate = originalCandidate;
			let diagnostics = [...originalCandidate.diagnostics];
			// Validation and coverage repairs share the caller's repair budget.
			let repairsUsed = 0;
			for (
				let repairAttempt = 1;
				repairAttempt <= policy.maxRepairAttempts && !isAcceptedCandidate(latestCandidate);
				repairAttempt += 1
			) {
				repairsUsed = repairAttempt;
				yield* recordMetric(generationRepairs, 1, {
					operation: "generate",
					outcome: "attempted",
					provider,
				});
				yield* Effect.logWarning("Repairing invalid diagram generation", {
					operation: "generate",
					provider,
					repair_attempt: repairAttempt,
					repair_kind: "repair_invalid",
				});
				const repairRequest = buildRepairRequest(request, latestCandidate, repairAttempt);
				const attemptedDiagnostic = `repair_attempted: requested a corrected response (attempt ${repairAttempt}).`;
				const repairResult = yield* Effect.result(executeModelCall(repairRequest));
				// A limit is the answer: the repaired diagram cannot fit either. A spent
				// request limit ends the request, which reports it as a timeout.
				if (
					Result.isFailure(repairResult) &&
					(repairResult.failure._tag === "DiagramGenerationLimitError" ||
						(repairResult.failure._tag === "DiagramGenerationTimeoutError" &&
							repairResult.failure.scope === "request"))
				) {
					return yield* repairResult.failure;
				}
				if (Result.isFailure(repairResult)) {
					const failedRepairCandidate = generationErrorToCandidate(
						repairResult.failure,
						repairRequest,
					);
					diagnostics = [
						...diagnostics,
						attemptedDiagnostic,
						...failedRepairCandidate.diagnostics,
						`repair_failed: semantic repair attempt ${repairAttempt} failed.`,
					];
					yield* recordMetric(generationRepairs, 1, {
						operation: "generate",
						outcome: "failed",
						provider,
					});
					candidate = { ...originalCandidate, diagnostics };
					break;
				}
				const repaired = enforceCandidateRequestRequirements(repairResult.success, request);
				const repairedAccepted = isAcceptedCandidate(repaired);
				const outcome = repairedAccepted ? "succeeded" : "failed";
				yield* recordMetric(generationRepairs, 1, {
					operation: "generate",
					outcome,
					provider,
				});
				diagnostics = [
					...diagnostics,
					attemptedDiagnostic,
					...repaired.diagnostics,
					`repair_${outcome}: semantic repair attempt ${repairAttempt} ${outcome}.`,
				];
				// Another attempt differs only by its number, so the same answer would come back.
				const repeated = repaired.text.trim() === latestCandidate.text.trim();
				latestCandidate = repaired;
				candidate = repairedAccepted
					? { ...repaired, diagnostics }
					: { ...originalCandidate, diagnostics };
				if (repeated) break;
			}
			// Check the accepted diagram against what the request states outright, and repair once
			// with the specific miss. A diagram that passes costs nothing more.
			const coverage =
				candidate.diagram && !candidate.error && !request.prompt.base
					? checkRequestCoverage(request.prompt.request, candidate.diagram)
					: [];
			const covered = candidate.diagram;
			if (coverage.length > 0 && covered && repairsUsed < policy.maxRepairAttempts) {
				const original = candidate;
				const issueDiagnostics = coverage.map(
					(issue) => `coverage.${issue.code}: ${issue.message}`,
				);
				yield* Effect.logInfo("Repairing a diagram that misses what its request states", {
					coverage_issues: coverage.map((issue) => issue.code).join(","),
					operation: "generate",
					provider,
				});
				const repairResult = yield* Effect.result(
					executeModelCall(buildCoverageRepairRequest(request, original, coverage)),
				);
				const repaired = Result.isSuccess(repairResult)
					? enforceCandidateRequestRequirements(repairResult.success, request)
					: undefined;
				// A repair in another family would pass the other family's checks without fixing anything.
				const remaining =
					repaired?.diagram && !repaired.error && repaired.diagram.type === covered.type
						? checkRequestCoverage(request.prompt.request, repaired.diagram)
						: undefined;
				// Keep the repair only when it fixes a miss without dropping what the diagram held.
				const improved =
					repaired?.diagram !== undefined &&
					remaining !== undefined &&
					remaining.length < coverage.length &&
					keepsStatedStructure(request.prompt.request, covered, repaired.diagram);
				yield* recordMetric(generationCoverageRepairs, 1, {
					operation: "generate",
					outcome: improved ? "succeeded" : "kept_original",
					provider,
				});
				candidate =
					improved && repaired
						? {
								...repaired,
								diagnostics: [
									...original.diagnostics,
									...issueDiagnostics,
									...repaired.diagnostics,
									`coverage_repair_succeeded: ${String(remaining?.length ?? 0)} of ${String(coverage.length)} issues remain.`,
								],
							}
						: {
								...original,
								diagnostics: [
									...original.diagnostics,
									...issueDiagnostics,
									"coverage_repair_kept_original: the repair fixed nothing without losing content, or failed.",
								],
							};
			}
			const finishedAt = yield* Clock.currentTimeMillis;
			const usage = yield* Ref.get(usageRef);
			return {
				...candidate,
				attempts: yield* Ref.get(callsRef),
				durationMs: Math.round(finishedAt - startedAt),
				...(usage ? { usage } : {}),
			};
		}).pipe(
			Effect.tap((candidate) =>
				Effect.all([
					recordMetric(generationRequests, 1, {
						operation: "generate",
						outcome: isAcceptedCandidate(candidate) ? "success" : "invalid",
						provider,
					}),
					recordMetric(generationDuration, candidate.durationMs, {
						operation: "generate",
						outcome: isAcceptedCandidate(candidate) ? "success" : "invalid",
						provider,
					}),
				]),
			),
			Effect.tapError((error) =>
				Effect.gen(function* () {
					const finishedAt = yield* Clock.currentTimeMillis;
					const durationMs = Math.max(0, finishedAt - startedAt);
					yield* recordMetric(generationRequests, 1, {
						failureCategory: error._tag,
						operation: "generate",
						outcome: "failure",
						provider,
					});
					yield* recordMetric(generationFailures, 1, {
						failureCategory: error._tag,
						operation: "generate",
						provider,
					});
					yield* recordMetric(generationDuration, durationMs, {
						failureCategory: error._tag,
						operation: "generate",
						outcome: "failure",
						provider,
					});
					if (error._tag === "DiagramGenerationTimeoutError") {
						yield* recordMetric(generationTimeouts, 1, {
							operation: "generate",
							provider,
							timeoutKind: "upstream",
						});
					}
				}),
			),
		);

		return yield* withTelemetryCorrelation(operation, {
			scenarioId: request.prompt.id,
		});
	},
);

function buildRepairRequest(
	request: DiagramGenerationRequest,
	candidate: DiagramGenerationCandidate,
	repairAttempt: number,
): DiagramGenerationRequest {
	const priorityDiagnostics = candidate.diagnostics.filter(
		(diagnostic) =>
			diagnostic.startsWith("flowchart.start_has_incoming:") ||
			diagnostic.startsWith("flowchart.self_loop:"),
	);
	const priorityCorrections = [
		...(priorityDiagnostics.some((diagnostic) =>
			diagnostic.startsWith("flowchart.start_has_incoming:"),
		)
			? [
					"Required correction for start-node incoming edges: reroute each offending loop-back edge to the first process node after start. Never target the start node; start nodes have no incoming edges.",
				]
			: []),
		...(priorityDiagnostics.some((diagnostic) => diagnostic.startsWith("flowchart.self_loop:"))
			? [
					"Required correction for self-loops: reroute each offending edge to an earlier distinct process or decision node. Never keep the same node as both source and target; model every retry or re-check as a decision branch returning to that earlier distinct node.",
				]
			: []),
	];
	const priorityGuidance =
		priorityDiagnostics.length > 0
			? [
					"Priority validator issue and hint:",
					...priorityDiagnostics.map((diagnostic) => `- ${diagnostic}`),
					...priorityCorrections,
					"",
				]
			: [];
	const originalHardRequirements = [
		"Original hard requirements (all remain mandatory):",
		`- Diagram type authority: ${request.prompt.requestedType ?? "model-selected from the original scenario"}.`,
		`- Original scenario: ${request.prompt.request}`,
		"- Preserve the model-authored concise title unless a validator diagnostic requires changing it.",
		"",
	];
	return {
		...request,
		cacheMode: "fresh",
		prompt: {
			...request.prompt,
			request: [
				`Repair attempt ${repairAttempt}: return a complete corrected diagram that satisfies every validator diagnostic below.`,
				"PRESERVE all existing nodes and labels except the minimal edit needed to fix the listed issues. Do not compact, summarize, remove, combine, rename, or relabel unaffected content.",
				"",
				...originalHardRequirements,
				...priorityGuidance,
				"Invalid model output:",
				candidate.text,
				"",
				"Validator diagnostics:",
				...candidate.diagnostics.map((diagnostic) => `- ${diagnostic}`),
			].join("\n"),
		},
	};
}

/**
 * One repair of a valid diagram that misses what its request states: the
 * specific misses, the request, and the diagram as the model wrote it.
 */
export function buildCoverageRepairRequest(
	request: DiagramGenerationRequest,
	candidate: DiagramGenerationCandidate,
	issues: readonly CoverageIssue[],
): DiagramGenerationRequest {
	return {
		...request,
		cacheMode: "fresh",
		prompt: {
			...request.prompt,
			request: [
				"Your diagram for the request below is valid, but it misses what the request states. Return the complete corrected diagram.",
				"Fix exactly these misses, and keep every other element with its id, label, details and order:",
				...issues.map((issue) => `- ${issue.message}`),
				"",
				"Request:",
				request.prompt.request,
				"",
				"Your diagram:",
				candidate.text,
			].join("\n"),
		},
	};
}
