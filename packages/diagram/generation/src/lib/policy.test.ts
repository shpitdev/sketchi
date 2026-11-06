import { describe, expect, it } from "@effect/vitest";
import { mediaPlayerStateMachine, parseFlowchartDiagram } from "@sketchi/diagram-core";
import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";

import {
	candidateFromText,
	type DiagramGenerationCandidate,
	type DiagramGenerationRequest,
} from "./candidates.js";
import { DiagramGenerationHttpError } from "./errors.js";
import { runDiagramGenerationWithPolicy } from "./policy.js";

const request: DiagramGenerationRequest = {
	model: "fixture-model",
	prompt: {
		id: "refund-flow",
		request: "Draw the refund approval flow.",
		requestedType: "flowchart",
	},
};
const acceptedDiagram = parseFlowchartDiagram({
	id: "refund-flow",
	title: "Refund approval",
	type: "flowchart",
	nodes: [
		{ id: "start", kind: "start", label: "Receive return" },
		{ id: "approve", kind: "process", label: "Approve refund" },
		{ id: "done", kind: "end", label: "Refund issued" },
	],
	edges: [
		{ id: "start-approve", source: "start", target: "approve" },
		{ id: "approve-done", source: "approve", target: "done" },
	],
});
const currentIssue =
	'flowchart.underbranched_decision: Decision node "approve" needs two branches.';

function runRepairs(initialDiagnostics: string[]) {
	const requests: DiagramGenerationRequest[] = [];
	const candidates: DiagramGenerationCandidate[] = [
		{
			provider: "fixture",
			model: request.model,
			text: "initial invalid output",
			diagnostics: initialDiagnostics,
		},
		{
			provider: "fixture",
			model: request.model,
			text: "latest invalid output",
			diagnostics: [currentIssue],
		},
		{
			provider: "fixture",
			model: request.model,
			text: JSON.stringify(acceptedDiagram),
			diagram: acceptedDiagram,
			diagnostics: [],
		},
	];
	const prepareAttempt = Effect.fn("diagramGeneration.test.prepareAttempt")(function* (
		callRequest: DiagramGenerationRequest,
	) {
		const candidate = candidates[requests.length];
		if (!candidate) {
			throw new Error("Unexpected generation attempt.");
		}
		requests.push(callRequest);
		return yield* Effect.succeed(candidate);
	});
	return runDiagramGenerationWithPolicy(prepareAttempt, request, "fixture", {
		concurrency: 1,
		maxRepairAttempts: 2,
		maxRetries: 0,
		requestTimeoutMs: 1_000,
		retryDelayMs: 1,
		totalTimeoutMs: 60_000,
	}).pipe(Effect.map((candidate) => ({ candidate, requests })));
}

describe("generation repair prompts", () => {
	it.effect("keeps default warnings non-blocking", () =>
		Effect.gen(function* () {
			const requests: DiagramGenerationRequest[] = [];
			const candidate = candidateFromText({
				model: "fixture-model",
				provider: "fixture",
				text: JSON.stringify({
					title: "Player",
					diagram: {
						...mediaPlayerStateMachine,
						states: mediaPlayerStateMachine.states.map(({ initial: _initial, ...state }) => state),
					},
				}),
			});
			const result = yield* runDiagramGenerationWithPolicy(
				(input) => {
					requests.push(input);
					return Effect.succeed(candidate);
				},
				{ ...request, prompt: { ...request.prompt, requestedType: "state-machine" } },
				"fixture",
				{
					concurrency: 1,
					maxRepairAttempts: 1,
					maxRetries: 0,
					requestTimeoutMs: 1000,
					retryDelayMs: 1,
					totalTimeoutMs: 60_000,
				},
			);
			expect(requests).toHaveLength(1);
			expect(result.warnings?.[0]?.code).toBe("composite_initial_defaulted");
			expect(result.error).toBeUndefined();
		}),
	);

	for (const [name, texts, expectedCalls] of [
		["stops when a repair repeats the attempt before it", ["same", "same", "unused"], 2],
		["keeps repairing while repairs change", ["first", "second", "third"], 3],
	] as const) {
		it.effect(name, () =>
			Effect.gen(function* () {
				const requests: DiagramGenerationRequest[] = [];
				const result = yield* runDiagramGenerationWithPolicy(
					(input) =>
						Effect.sync(() => {
							requests.push(input);
							return {
								diagnostics: [currentIssue],
								error: "Invalid.",
								model: request.model,
								provider: "fixture" as const,
								text: texts[requests.length - 1] ?? "",
							};
						}),
					request,
					"fixture",
					{
						concurrency: 1,
						maxRepairAttempts: 2,
						maxRetries: 0,
						requestTimeoutMs: 1_000,
						retryDelayMs: 1,
						totalTimeoutMs: 60_000,
					},
				);
				expect(requests).toHaveLength(expectedCalls);
				expect(result.error).toBe("Invalid.");
				expect(result.text).toBe(texts[0]);
			}),
		);
	}

	for (const initialDiagnostics of [
		["output_truncated: Regenerate the complete diagram."],
		[
			"flowchart.self_loop: Reroute the retry edge.",
			"flowchart.start_has_incoming: Reroute the loop-back edge.",
		],
	]) {
		it.effect(`uses only the latest diagnostics after ${initialDiagnostics[0]}`, () =>
			Effect.gen(function* () {
				const { candidate, requests } = yield* runRepairs(initialDiagnostics);
				expect(requests).toHaveLength(3);
				const repair = requests[2];
				expect(repair?.cacheMode).toBe("fresh");
				expect(repair?.prompt.request).toContain(`Validator diagnostics:\n- ${currentIssue}`);
				expect(repair?.prompt.request).toContain("latest invalid output");
				for (const staleIssue of initialDiagnostics) {
					expect(repair?.prompt.request).not.toContain(staleIssue);
				}
				expect(repair?.prompt.request).not.toMatch(
					/repair_attempted:|repair_failed:|Priority validator issue|Required correction/,
				);
				expect(candidate.diagram).toEqual(acceptedDiagram);
				expect(candidate.diagnostics).toEqual([
					...initialDiagnostics,
					expect.stringContaining("repair_attempted:"),
					currentIssue,
					"repair_failed: semantic repair attempt 1 failed.",
					expect.stringContaining("repair_attempted:"),
					"repair_succeeded: semantic repair attempt 2 succeeded.",
				]);
			}),
		);
	}

	it.effect("includes the original scenario once in each repair prompt", () =>
		Effect.gen(function* () {
			const { requests } = yield* runRepairs(["flowchart.self_loop: Retry edge."]);
			for (const repair of requests.slice(1)) {
				expect(repair.prompt.request.split(request.prompt.request)).toHaveLength(2);
				expect(repair.prompt.request).toContain(`- Original scenario: ${request.prompt.request}`);
			}
		}),
	);
});

describe("generation size limits", () => {
	it.effect("repairs a layout bound, which restructuring meets without dropping content", () =>
		Effect.gen(function* () {
			const { candidate, requests } = yield* runRepairs([
				"wireframe.wireframe_too_large: Components nest 10 levels deep; a wireframe draws at most 8. Hint: Remove wrappers that hold a single child.",
			]);
			expect(candidate.diagram).toBeDefined();
			expect(requests).toHaveLength(3);
		}),
	);

	it.effect("fails a count limit at once, which repair could meet only by dropping content", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				runRepairs([
					"org-chart.org_chart_too_large: An org chart holds at most 100 people; this one has 120. Hint: Draw each division as its own chart.",
				]),
			);
			expect(error).toMatchObject({
				_tag: "DiagramGenerationLimitError",
				limit: "diagram_size",
				message: "An org chart holds at most 100 people; this one has 120.",
			});
		}),
	);
});

describe("generation request deadline", () => {
	const invalid: DiagramGenerationCandidate = {
		provider: "fixture",
		model: request.model,
		text: "invalid output",
		diagnostics: [currentIssue],
	};
	const busy = DiagramGenerationHttpError.make({
		diagnostics: ["busy"],
		durationMs: 1,
		provider: "fixture",
		raw: {},
		retryable: true,
		status: 503,
	});
	const policy = {
		concurrency: 1,
		maxRepairAttempts: 2,
		maxRetries: 2,
		requestTimeoutMs: 5_000,
		retryDelayMs: 150,
		totalTimeoutMs: 1_000,
	};

	it.effect("reports a repair that runs past the request's limit as a timeout", () =>
		Effect.gen(function* () {
			let calls = 0;
			const prepareAttempt = (_request: DiagramGenerationRequest) =>
				Effect.suspend(() => {
					calls += 1;
					return calls === 1 ? Effect.succeed(invalid) : Effect.never;
				});
			const fiber = yield* Effect.forkChild(
				Effect.flip(runDiagramGenerationWithPolicy(prepareAttempt, request, "fixture", policy)),
			);
			yield* TestClock.adjust("2 seconds");
			const error = yield* Fiber.join(fiber);
			expect(calls).toBe(2);
			expect(error).toMatchObject({ _tag: "DiagramGenerationTimeoutError", scope: "request" });
		}),
	);

	it.effect("dispatches no call once a retry's backoff reaches the request's limit", () =>
		Effect.gen(function* () {
			let calls = 0;
			const prepareAttempt = (_request: DiagramGenerationRequest) =>
				Effect.suspend(() => {
					calls += 1;
					return Effect.fail(busy);
				});
			const fiber = yield* Effect.forkChild(
				Effect.flip(
					runDiagramGenerationWithPolicy(prepareAttempt, request, "fixture", {
						...policy,
						totalTimeoutMs: 40,
					}),
				),
			);
			yield* TestClock.adjust("1 second");
			const error = yield* Fiber.join(fiber);
			expect(calls).toBe(1);
			expect(error).toMatchObject({
				_tag: "DiagramGenerationTimeoutError",
				scope: "request",
				timeoutMs: 40,
			});
		}),
	);
});
