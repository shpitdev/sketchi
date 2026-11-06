import { assert, describe, expect, it, layer, vi } from "@effect/vitest";
import {
	makeTelemetryTestSink,
	makeWorkersTelemetryLayer,
	type TelemetryLogEvent,
	type TelemetryMetricEvent,
	type TelemetrySpanEvent,
} from "@sketchi/observability";
import { FLOWCHART_MAX_NODES, SKETCHI_DIAGRAM_STYLE } from "@sketchi/diagram-core";
import { Cause, Effect, Exit, Fiber, Layer, Schema } from "effect";
import { TestClock } from "effect/testing";

import { candidateFromText, extractJsonObject, responseErrorDiagnostic } from "./candidates.js";
import {
	diagramGenerationPolicyDefaults,
	DiagramGenerationClient,
	DiagramGenerationPolicy,
	MEASURED_OUTPUT_TOKENS_PER_SECOND,
} from "./client.js";
import { CloudflareAiGatewayBinding, type CloudflareAiGateway } from "./cloudflare-ai-gateway.js";
import {
	CloudflareGatewayChatClientLive,
	CloudflareGatewayChatConfig,
	googleGatewayChatRoute,
} from "./cloudflare-gateway-chat.js";
import {
	buildDiagramGenerationMessages,
	DEFAULT_MAX_OUTPUT_TOKENS,
	DiagramGenerationPrompt,
} from "./messages.js";
import { stripGoogleModelPrefix } from "./models.js";
import { GeneratedMindmapTree, generatedMindmapTreeToDiagram } from "./mindmap-tree.js";

const prompt: DiagramGenerationPrompt = {
	id: "pharma-batch-disposition",
	request:
		"Create a flowchart for pharma batch disposition. A batch is received, QA reviews the Certificate of Analysis, and then decides whether it passes specs. Passing goes to QA Manager final review and packaging. Retest goes through investigation and returns to final review. Reject ends at reject batch.",
	requestedType: "flowchart",
};
const expectedDiagram = {
	id: "pharma-batch-disposition-fixture",
	title: "Pharma batch disposition",
	type: "flowchart",
	nodes: [
		{ id: "received", label: "Batch received", kind: "start" },
		{
			id: "final-review",
			label: "QA Manager final review",
			kind: "decision",
		},
		{
			id: "investigation",
			label: "Investigate retesting",
			kind: "process",
		},
		{ id: "packaging", label: "Send to packaging", kind: "end" },
	],
	edges: [
		{
			id: "received-to-final-review",
			source: "received",
			target: "final-review",
		},
		{
			id: "final-review-to-packaging",
			source: "final-review",
			target: "packaging",
			label: "yes",
		},
		{
			id: "final-review-to-investigation",
			source: "final-review",
			target: "investigation",
			label: "retest",
		},
		{
			id: "investigation-to-final-review",
			source: "investigation",
			target: "final-review",
		},
	],
	layout: { direction: "TB", edgeRouting: "orthogonal" },
	style: { accentColor: "#8f707f", backgroundColor: "#fffdf8" },
};
function generationResponseText(diagram: Readonly<Record<string, unknown>>): string {
	const { title, type, ...diagramWithoutTitle } = diagram;
	return JSON.stringify(
		{
			title,
			diagram: { ...diagramWithoutTitle, type },
		},
		null,
		2,
	);
}

const expectedText = generationResponseText({
	...expectedDiagram,
	style: { accentColor: "#0f766e", backgroundColor: "#ffffff" },
});
const expectedMessages = buildDiagramGenerationMessages(prompt);
const expectedSystem = expectedMessages.system;
const expectedUser = expectedMessages.user;
const expectedChatBody = {
	max_tokens: 512,
	messages: [
		{ role: "system", content: expectedSystem },
		{ role: "user", content: expectedUser },
	],
	model: "gemini-3.1-flash-lite",
	response_format: { type: "json_object" },
	temperature: 0.2,
};

function chatResponseBody(content: string, finishReason = "stop") {
	return {
		choices: [{ finish_reason: finishReason, index: 0, message: { role: "assistant", content } }],
		created: 1,
		id: "chatcmpl-test",
		model: "gemini-3.1-flash-lite",
		object: "chat.completion",
		usage: { completion_tokens: 23, prompt_tokens: 11, total_tokens: 34 },
	};
}

const chatResponse = chatResponseBody(expectedText);

function jsonResponse(body: unknown, init?: ResponseInit): Response {
	return new Response(JSON.stringify(body), {
		headers: { "Content-Type": "application/json" },
		...init,
	});
}

const configLayer = Layer.succeed(CloudflareGatewayChatConfig, {
	collectLog: true,
	gatewayId: "sketchi",
	route: googleGatewayChatRoute,
	surface: "generate-api",
});
const retryPolicyLayer = Layer.succeed(DiagramGenerationPolicy, {
	concurrency: 2,
	maxRepairAttempts: 1,
	maxRetries: 2,
	requestTimeoutMs: 1_000,
	retryDelayMs: 100,
	totalTimeoutMs: 60_000,
});
const cancellationPolicyLayer = Layer.succeed(DiagramGenerationPolicy, {
	concurrency: 2,
	maxRepairAttempts: 1,
	maxRetries: 1,
	requestTimeoutMs: 500,
	retryDelayMs: 100,
	totalTimeoutMs: 60_000,
});

describe("diagram generation prompt mapping", () => {
	it.effect.prop(
		"round-trips generated prompt contracts through their encoded form",
		{ generatedPrompt: DiagramGenerationPrompt },
		({ generatedPrompt }) =>
			Effect.gen(function* () {
				const encoded = yield* Schema.encodeEffect(DiagramGenerationPrompt)(generatedPrompt);
				const decoded = yield* Schema.decodeUnknownEffect(DiagramGenerationPrompt)(encoded);
				assert.deepStrictEqual(decoded, generatedPrompt);
			}),
	);

	it("keeps the provider-facing prompt messages byte-for-byte stable", () => {
		expect(buildDiagramGenerationMessages(prompt)).toEqual({
			system: expectedSystem,
			user: expectedUser,
		});
	});

	it("maps mindmap requests to the mindmap IR contract", () => {
		const messages = buildDiagramGenerationMessages({
			...prompt,
			requestedType: "mindmap",
		});

		expect(messages.system).toContain('Use diagram type "mindmap".');
		expect(messages.system).toContain("one nested root topic");
		expect(messages.system).toContain("Return the diagram id");
		expect(messages.system).toContain("Do not return flat nodes");
		expect(messages.system).toContain("derived ids");
		expect(messages.system).not.toContain("2-4 children per major topic");
		expect(messages.system).toContain("Children keep their order.");
		expect(messages.user).toContain('"type":"mindmap"');
	});

	it("maps sequence requests to the native sequence contract", () => {
		const messages = buildDiagramGenerationMessages({
			...prompt,
			requestedType: "sequence",
		});

		expect(messages.system).toContain('Use diagram type "sequence".');
		expect(messages.system).toContain("ordered participants");
		expect(messages.system).toContain("chronological messages");
		expect(messages.user).toContain('"type":"sequence"');
	});

	it("gives omitted-type selection only schema-valid response examples", () => {
		const messages = buildDiagramGenerationMessages({
			id: "model-selected-kind",
			request: "Create the diagram kind that best fits this scenario",
		});

		expect(messages.user).toContain("Response example:");
		expect(messages.user).not.toContain("intent");
	});

	it("shows a type-less example that ends at stated steps and adds no loop", () => {
		const { user } = buildDiagramGenerationMessages({ id: "example", request: "Draw it" });
		const example = JSON.parse(user.slice(user.indexOf("{"), user.lastIndexOf("}") + 1)) as {
			readonly diagram: {
				readonly edges: readonly { readonly source: string; readonly target: string }[];
				readonly nodes: readonly { readonly id: string; readonly kind: string }[];
			};
		};
		const { nodes, edges } = example.diagram;
		const order = nodes.map((node) => node.id);
		expect(edges.every((edge) => order.indexOf(edge.source) < order.indexOf(edge.target))).toBe(
			true,
		);
		expect(nodes.filter((node) => node.kind === "end").map((node) => node.id)).toEqual([
			"publish",
			"cancel",
		]);
	});

	it("requires real loop topology and flowchart richness", () => {
		const messages = buildDiagramGenerationMessages(prompt);

		expect(messages.system).toContain(
			"include a real back-edge to an earlier distinct process or decision",
		);
		expect(messages.system).toContain("Never target start and never use a self-loop");
		expect(messages.system).toContain("Copy everything the scenario states, in full");
		expect(messages.system).toContain("Add nothing it does not state");
		expect(messages.system).toContain("Add no next step the scenario gives only to other branches");
		expect(messages.system).not.toContain("invent none");
		expect(messages.system).toContain(
			"If the scenario says where the flow ends, every branch leads to that node.",
		);
		expect(messages.system).toContain("a branch with no stated next step stops at its last step");
	});

	it("gives one model call time to write the whole output budget, inside the request's limit", () => {
		const { requestTimeoutMs, totalTimeoutMs } = diagramGenerationPolicyDefaults;
		const fullBudgetMs = (DEFAULT_MAX_OUTPUT_TOKENS / MEASURED_OUTPUT_TOKENS_PER_SECOND) * 1_000;
		expect(DEFAULT_MAX_OUTPUT_TOKENS).toBe(16_384);
		expect(requestTimeoutMs).toBeGreaterThan(fullBudgetMs + 5_000);
		expect(totalTimeoutMs).toBeGreaterThan(requestTimeoutMs);
		expect(diagramGenerationPolicyDefaults.maxRepairAttempts).toBe(2);
	});

	it("normalizes Cloudflare Google model ids for the Google route", () => {
		expect(stripGoogleModelPrefix("google/gemini-3.1-flash-lite")).toBe("gemini-3.1-flash-lite");
		expect(stripGoogleModelPrefix("google-ai-studio/gemini-3.1-flash-lite")).toBe(
			"gemini-3.1-flash-lite",
		);
	});
});

describe("pure candidate behavior", () => {
	it("extracts the first complete JSON object without swallowing trailing output", () => {
		expect(
			extractJsonObject(
				'Result: {"label":"Review {draft}","nested":{"ok":true}}\n{"duplicate":true}',
			),
		).toEqual({ label: "Review {draft}", nested: { ok: true } });
	});

	it.effect.prop(
		"derives a valid flat mindmap from every generated nested hierarchy",
		{ tree: GeneratedMindmapTree },
		({ tree }) =>
			Effect.gen(function* () {
				const diagram = generatedMindmapTreeToDiagram(tree);
				const root = diagram.nodes.find((node) => node.kind === "root");

				assert.strictEqual(root?.id, "topic-0");
				assert.strictEqual(diagram.edges.length, diagram.nodes.length - 1);
				assert.isTrue(diagram.nodes.length >= 2);
			}),
	);

	it("preserves explicit provider errors instead of replacing them with parse errors", () => {
		const candidate = candidateFromText({
			diagnostics: ["Google AI Studio Gateway request failed with HTTP 401."],
			error: "HTTP 401",
			model: "gemini-3.1-flash-lite",
			provider: "cloudflare-google-ai-studio",
			text: "",
		});

		expect(candidate.error).toBe("HTTP 401");
		expect(candidate.diagnostics).toContain(
			"Google AI Studio Gateway request failed with HTTP 401.",
		);
	});

	it("extracts common provider error diagnostics from HTTP response bodies", () => {
		expect(
			responseErrorDiagnostic({
				errors: [{ message: "Gateway authentication failed." }],
			}),
		).toBe("Gateway authentication failed.");
		expect(responseErrorDiagnostic({ error: { message: "Unknown model." } })).toBe(
			"Unknown model.",
		);
	});

	it("parses a local generation fixture without importing eval scenarios", () => {
		const candidate = candidateFromText({
			model: "fixture",
			provider: "fixture",
			text: expectedText,
		});

		expect(candidate.error).toBeUndefined();
		expect(candidate.diagram?.id).toBe(expectedDiagram.id);
		expect(candidate.diagram?.style).toEqual(expectedDiagram.style);
	});

	it("parses and validates native sequence candidates", () => {
		const candidate = candidateFromText({
			model: "fixture",
			provider: "fixture",
			text: generationResponseText({
				id: "login-sequence",
				title: "Login sequence",
				type: "sequence",
				participants: [
					{ id: "browser", label: "Browser" },
					{ id: "api", label: "API" },
				],
				messages: [
					{
						id: "login",
						source: "browser",
						target: "api",
						label: "Login request",
					},
				],
			}),
		});

		expect(candidate.error).toBeUndefined();
		expect(candidate.diagram?.type).toBe("sequence");
		if (candidate.diagram?.type === "sequence") {
			expect(candidate.diagram.messages).toHaveLength(1);
			expect(candidate.diagram.style).toEqual(SKETCHI_DIAGRAM_STYLE);
		}
	});

	it("reports sequence invariants with the core contract's issue codes and hints", () => {
		const candidate = candidateFromText({
			model: "fixture",
			provider: "fixture",
			text: generationResponseText({
				id: "retry-sequence",
				title: "Retry sequence",
				type: "sequence",
				participants: [
					{ id: "worker", label: "Worker" },
					{ id: "queue", label: "Queue" },
				],
				messages: [
					{ id: "poll", source: "worker", target: "queue", label: "Poll" },
					{ id: "retry", source: "worker", target: "worker", label: "Retry" },
					{ id: "ack", source: "queue", target: "billing", label: "Ack" },
				],
				style: { accentColor: "#0f766e", backgroundColor: "#ffffff" },
			}),
		});

		expect(candidate.diagram).toBeUndefined();
		// The worker's self-message is valid; only the unknown target is reported.
		expect(candidate.diagnostics).toEqual([
			'sequence.missing_message_target: Message target "billing" is not a participant. Hint: Use the id of a participant declared in participants.',
		]);
	});

	it("requires the response envelope instead of accepting raw IR", () => {
		const candidate = candidateFromText({
			model: "fixture",
			provider: "fixture",
			text: JSON.stringify(expectedDiagram),
		});

		expect(candidate.diagram).toBeUndefined();
		expect(candidate.diagnostics[0]).toContain("diagram_missing");
	});

	it("uses a deterministic id-based title fallback for invalid model titles", () => {
		const candidate = candidateFromText({
			model: "fixture",
			provider: "fixture",
			text: generationResponseText({
				...expectedDiagram,
				id: "release-approval-flow",
				title: "x".repeat(61),
			}),
		});

		expect(candidate.diagram?.title).toBe("Release approval flow");
	});

	it("normalizes empty optional edge labels before schema validation", () => {
		const candidate = candidateFromText({
			model: "fixture",
			provider: "fixture",
			text: generationResponseText({
				...expectedDiagram,
				edges: expectedDiagram.edges.map((edge, index) =>
					index === 0 ? { ...edge, label: "" } : edge,
				),
			}),
		});

		expect(candidate.error).toBeUndefined();
		expect(candidate.diagram?.type).toBe("flowchart");
		if (candidate.diagram?.type === "flowchart") {
			expect(candidate.diagram.edges[0]?.label).toBeUndefined();
		}
	});

	it("parses validated mindmap candidates through diagram-core", () => {
		const candidate = candidateFromText({
			model: "fixture",
			provider: "fixture",
			text: generationResponseText({
				id: "launch-map",
				title: "Launch map",
				type: "mindmap",
				nodes: [
					{
						id: "root",
						label: "Launch",
						kind: "root",
						metadata: { depth: 0, siblingIndex: 0 },
					},
					{
						id: "product",
						label: "Product",
						kind: "topic",
						metadata: { depth: 1, siblingIndex: 0 },
					},
				],
				edges: [
					{
						id: "root-product",
						source: "root",
						target: "product",
						metadata: { depth: 1, siblingIndex: 0 },
					},
				],
				layout: { direction: "LR", edgeRouting: "curved" },
				style: { accentColor: "#7c3aed", backgroundColor: "#ffffff" },
			}),
		});

		expect(candidate.diagram?.type).toBe("mindmap");
		expect(candidate.diagram?.style).toEqual({
			accentColor: "#8f707f",
			backgroundColor: "#fffdf8",
		});
		expect(candidate.error).toBeUndefined();
	});

	it("derives deterministic graph metadata from nested mindmap output", () => {
		const candidate = candidateFromText({
			model: "fixture",
			provider: "fixture",
			text: generationResponseText({
				id: "launch-map",
				layout: { direction: "LR", edgeRouting: "curved" },
				root: {
					children: [
						{
							children: [{ children: [], label: "Positioning" }],
							label: "Product",
						},
						{ children: [], label: "Go to market" },
					],
					label: "Launch",
				},
				title: "Launch map",
				type: "mindmap",
			}),
		});

		expect(candidate.error).toBeUndefined();
		expect(candidate.diagram?.type).toBe("mindmap");
		if (candidate.diagram?.type === "mindmap") {
			expect(candidate.diagram.nodes.map((node) => node.id)).toEqual([
				"topic-0",
				"topic-0-0",
				"topic-0-0-0",
				"topic-0-1",
			]);
			expect(candidate.diagram.edges[1]).toMatchObject({
				id: "branch-0-0-0",
				metadata: { depth: 2, siblingIndex: 0 },
				source: "topic-0-0",
				target: "topic-0-0-0",
			});
		}
	});

	it("captures every flowchart validator issue with its repair hint", () => {
		const candidate = candidateFromText({
			model: "fixture",
			provider: "fixture",
			text: generationResponseText({
				id: "broken-loop",
				title: "Broken loop",
				type: "flowchart",
				nodes: [
					{ id: "start", label: "Start", kind: "start" },
					{ id: "retry", label: "Retry?", kind: "decision" },
					{ id: "done", label: "Done", kind: "end" },
				],
				edges: [
					{ id: "start-retry", source: "start", target: "retry" },
					{ id: "retry-done", source: "retry", target: "done" },
					{ id: "done-start", source: "done", target: "start" },
				],
				layout: { direction: "TB", edgeRouting: "orthogonal" },
			}),
		});

		expect(candidate.diagram).toBeUndefined();
		expect(candidate.diagnostics).toEqual(
			expect.arrayContaining([
				expect.stringContaining("start_has_incoming"),
				expect.stringContaining("end_has_outgoing"),
				expect.stringContaining("underbranched_decision"),
				expect.stringContaining("unlabeled_decision_branch"),
				expect.stringContaining("Hint:"),
			]),
		);
	});
});

const successfulRun = vi.fn(async () => jsonResponse(chatResponse));
const successfulClientLayer = CloudflareGatewayChatClientLive.pipe(
	Layer.provide(
		Layer.mergeAll(
			Layer.succeed(CloudflareAiGatewayBinding, {
				gateway: () => ({ getUrl: vi.fn(), run: successfulRun }),
			}),
			configLayer,
			retryPolicyLayer,
		),
	),
);

layer(successfulClientLayer)("Cloudflare Google AI Studio live layer", (it) => {
	it.effect("uses the Google route with the current request settings", () =>
		Effect.gen(function* () {
			const client = yield* DiagramGenerationClient;
			const candidate = yield* client.generate({
				maxOutputTokens: 512,
				model: "google/gemini-3.1-flash-lite",
				prompt,
				temperature: 0.2,
			});

			expect(successfulRun).toHaveBeenCalledWith(
				expect.objectContaining({
					endpoint: "v1beta/openai/chat/completions",
					headers: expect.not.objectContaining({
						"Cache-Control": "no-store",
					}),
					provider: "google-ai-studio",
					query: expectedChatBody,
				}),
				expect.objectContaining({
					gateway: expect.objectContaining({
						collectLog: true,
						metadata: expect.objectContaining({ scenarioId: prompt.id }),
					}),
				}),
			);
			assert.strictEqual(candidate.diagram?.id, expectedDiagram.id);
			assert.strictEqual(candidate.usage?.totalTokens, 34);
		}),
	);

	it.effect("sends no-store headers and metadata for fresh runs", () =>
		Effect.gen(function* () {
			const client = yield* DiagramGenerationClient;
			const candidate = yield* client.generate({
				cacheMode: "fresh",
				model: "google/gemini-3.1-flash-lite",
				prompt,
			});

			expect(successfulRun).toHaveBeenLastCalledWith(
				expect.objectContaining({
					headers: expect.objectContaining({
						"Cache-Control": "no-store",
						"cf-aig-skip-cache": "true",
						Pragma: "no-cache",
					}),
				}),
				expect.objectContaining({
					gateway: expect.objectContaining({
						metadata: expect.objectContaining({ cacheMode: "fresh" }),
					}),
				}),
			);
			assert.strictEqual(candidate.cacheMode, "fresh");
		}),
	);
});

const invalidDiagramText = generationResponseText({
	id: "invalid-retry",
	title: "Invalid retry",
	type: "flowchart",
	nodes: [
		{ id: "start", kind: "start", label: "Start" },
		{ id: "retry", kind: "decision", label: "Retry?" },
		{ id: "end", kind: "end", label: "Done" },
	],
	edges: [
		{ id: "start-retry", source: "start", target: "retry" },
		{ id: "retry-end", source: "retry", target: "end" },
	],
	layout: { direction: "TB", edgeRouting: "orthogonal" },
});

const startIncomingDiagramText = generationResponseText({
	id: "expense-resubmission",
	title: "Expense resubmission",
	type: "flowchart",
	nodes: [
		{ id: "start", kind: "start", label: "Start" },
		{ id: "submission", kind: "process", label: "Submission" },
		{ id: "manager", kind: "decision", label: "Manager approves?" },
		{ id: "finance", kind: "decision", label: "Finance approves?" },
		{ id: "rejection", kind: "process", label: "Rejection" },
		{ id: "resubmit", kind: "process", label: "Resubmit" },
		{ id: "reimbursement", kind: "end", label: "Reimbursement" },
	],
	edges: [
		{ id: "start-submission", source: "start", target: "submission" },
		{ id: "submission-manager", source: "submission", target: "manager" },
		{
			id: "manager-finance",
			source: "manager",
			target: "finance",
			label: "approved",
		},
		{
			id: "manager-rejection",
			source: "manager",
			target: "rejection",
			label: "rejected",
		},
		{
			id: "finance-reimbursement",
			source: "finance",
			target: "reimbursement",
			label: "approved",
		},
		{
			id: "finance-rejection",
			source: "finance",
			target: "rejection",
			label: "rejected",
		},
		{ id: "rejection-resubmit", source: "rejection", target: "resubmit" },
		{ id: "resubmit-start", source: "resubmit", target: "start" },
	],
	layout: { direction: "TB", edgeRouting: "orthogonal" },
});

const selfLoopDiagramText = generationResponseText({
	id: "returns-fraud-review",
	title: "Returns fraud review",
	type: "flowchart",
	nodes: [
		{ id: "start", kind: "start", label: "Start" },
		{ id: "return", kind: "process", label: "Receive return" },
		{ id: "fraud", kind: "decision", label: "Fraud check passes?" },
		{ id: "done", kind: "end", label: "Refund complete" },
	],
	edges: [
		{ id: "start-return", source: "start", target: "return" },
		{ id: "return-fraud", source: "return", target: "fraud" },
		{
			id: "fraud-self",
			source: "fraud",
			target: "fraud",
			label: "re-check",
		},
		{ id: "fraud-done", source: "fraud", target: "done", label: "clear" },
	],
	layout: { direction: "TB", edgeRouting: "orthogonal" },
});

function returnsDiagramText(nodeCount: number, selfLoop: boolean): string {
	const processCount = nodeCount - 3;
	const processNodes = Array.from({ length: processCount }, (_, index) => ({
		id: `step-${index + 1}`,
		kind: "process",
		label: `Return step ${index + 1}`,
	}));
	const processEdges = processNodes.map((node, index) => ({
		id: `step-edge-${index + 1}`,
		source: node.id,
		target: processNodes[index + 1]?.id ?? "fraud-check",
	}));
	const lastProcessId = processNodes.at(-1)?.id ?? "fraud-review";
	return generationResponseText({
		id: "returns-minimum-repair",
		title: "Ecommerce returns",
		type: "flowchart",
		nodes: [
			{ id: "start", kind: "start", label: "Return initiated" },
			...processNodes,
			{ id: "fraud-check", kind: "decision", label: "Fraud check?" },
			{ id: "done", kind: "end", label: "Return closed" },
		],
		edges: [
			{
				id: "start-step",
				source: "start",
				target: processNodes[0]?.id ?? "fraud-check",
			},
			...processEdges,
			{
				id: "fraud-recheck",
				source: "fraud-check",
				target: selfLoop ? "fraud-check" : lastProcessId,
				label: "re-check",
			},
			{
				id: "fraud-clear",
				source: "fraud-check",
				target: "done",
				label: "clear",
			},
		],
		layout: { direction: "TB", edgeRouting: "orthogonal" },
	});
}

function chatTextResponse(text: string): Response {
	return jsonResponse(chatResponseBody(text));
}

let repairedRunCalls = 0;
const repairedRun = vi.fn<CloudflareAiGateway["run"]>(async () => {
	repairedRunCalls += 1;
	return repairedRunCalls === 1 ? chatTextResponse(invalidDiagramText) : jsonResponse(chatResponse);
});
const repairedClientLayer = CloudflareGatewayChatClientLive.pipe(
	Layer.provide(
		Layer.mergeAll(
			Layer.succeed(CloudflareAiGatewayBinding, {
				gateway: () => ({ getUrl: vi.fn(), run: repairedRun }),
			}),
			configLayer,
			retryPolicyLayer,
		),
	),
);

layer(repairedClientLayer)("semantic repair policy", (it) => {
	it.effect("repairs one invalid response and records repair outcomes", () => {
		const { probe, sink } = makeTelemetryTestSink();
		const telemetryLayer = makeWorkersTelemetryLayer({
			resource: { serviceName: "sketchi-generation-repair-test" },
			sink,
		});
		return Effect.gen(function* () {
			repairedRunCalls = 0;
			repairedRun.mockClear();
			const client = yield* DiagramGenerationClient;
			const candidate = yield* client.generate({
				model: "google/gemini-3.1-flash-lite",
				prompt,
			});

			assert.strictEqual(repairedRun.mock.calls.length, 2);
			assert.strictEqual(candidate.diagram?.id, expectedDiagram.id);
			assert.isTrue(
				candidate.diagnostics.some((diagnostic) =>
					diagnostic.startsWith("flowchart.underbranched_decision:"),
				),
			);
			assert.isTrue(
				candidate.diagnostics.includes("repair_succeeded: semantic repair attempt 1 succeeded."),
			);
			expect(repairedRun.mock.calls[1]?.[0]).toEqual(
				expect.objectContaining({
					headers: expect.objectContaining({
						"Cache-Control": "no-store",
						"cf-aig-skip-cache": "true",
					}),
					query: expect.objectContaining({
						messages: [
							expect.objectContaining({ role: "system" }),
							expect.objectContaining({
								content: expect.stringContaining("Invalid model output:"),
								role: "user",
							}),
						],
					}),
				}),
			);
			const repairs = probe.events.filter(
				(event): event is TelemetryMetricEvent =>
					event.event === "effect.metric" && event.metric === "sketchi_generation_repairs",
			);
			assert.deepStrictEqual(
				repairs.map((event) => event.attributes["outcome"]),
				["attempted", "succeeded"],
			);
		}).pipe(Effect.provide(telemetryLayer));
	});
});

let startIncomingRepairCalls = 0;
const startIncomingRepairRun = vi.fn<CloudflareAiGateway["run"]>(async () => {
	startIncomingRepairCalls += 1;
	return startIncomingRepairCalls === 1
		? chatTextResponse(startIncomingDiagramText)
		: jsonResponse(chatResponse);
});
const startIncomingRepairClientLayer = CloudflareGatewayChatClientLive.pipe(
	Layer.provide(
		Layer.mergeAll(
			Layer.succeed(CloudflareAiGatewayBinding, {
				gateway: () => ({ getUrl: vi.fn(), run: startIncomingRepairRun }),
			}),
			configLayer,
			retryPolicyLayer,
		),
	),
);

layer(startIncomingRepairClientLayer)("start edge semantic repair", (it) => {
	it.effect("prioritizes rerouting loop-back edges away from start", () =>
		Effect.gen(function* () {
			startIncomingRepairCalls = 0;
			startIncomingRepairRun.mockClear();
			const client = yield* DiagramGenerationClient;
			const candidate = yield* client.generate({
				model: "google/gemini-3.1-flash-lite",
				prompt,
			});

			assert.strictEqual(startIncomingRepairRun.mock.calls.length, 2);
			assert.strictEqual(candidate.diagram?.id, expectedDiagram.id);
			const repairBody = startIncomingRepairRun.mock.calls[1]?.[0];
			expect(repairBody).toEqual(
				expect.objectContaining({
					query: expect.objectContaining({
						messages: [
							expect.objectContaining({ role: "system" }),
							expect.objectContaining({
								content: expect.stringMatching(
									/Priority validator issue and hint:\n- flowchart\.start_has_incoming: Start node "start" cannot have incoming edges\. Hint: Route the start node only to later nodes\.[\s\S]*reroute each offending loop-back edge to the first process node after start\. Never target the start node; start nodes have no incoming edges\./u,
								),
								role: "user",
							}),
						],
					}),
				}),
			);
		}),
	);
});

let selfLoopRepairCalls = 0;
const selfLoopRepairRun = vi.fn<CloudflareAiGateway["run"]>(async () => {
	selfLoopRepairCalls += 1;
	return selfLoopRepairCalls === 1
		? chatTextResponse(selfLoopDiagramText)
		: jsonResponse(chatResponse);
});
const selfLoopRepairClientLayer = CloudflareGatewayChatClientLive.pipe(
	Layer.provide(
		Layer.mergeAll(
			Layer.succeed(CloudflareAiGatewayBinding, {
				gateway: () => ({ getUrl: vi.fn(), run: selfLoopRepairRun }),
			}),
			configLayer,
			retryPolicyLayer,
		),
	),
);

layer(selfLoopRepairClientLayer)("self-loop semantic repair", (it) => {
	it.effect("prioritizes rerouting self-loops to an earlier distinct node", () =>
		Effect.gen(function* () {
			selfLoopRepairCalls = 0;
			selfLoopRepairRun.mockClear();
			const client = yield* DiagramGenerationClient;
			const candidate = yield* client.generate({
				model: "google/gemini-3.1-flash-lite",
				prompt,
			});

			assert.strictEqual(selfLoopRepairRun.mock.calls.length, 2);
			assert.strictEqual(candidate.diagram?.id, expectedDiagram.id);
			const repairBody = selfLoopRepairRun.mock.calls[1]?.[0];
			expect(repairBody).toEqual(
				expect.objectContaining({
					query: expect.objectContaining({
						messages: [
							expect.objectContaining({ role: "system" }),
							expect.objectContaining({
								content: expect.stringMatching(
									/Priority validator issue and hint:\n- flowchart\.self_loop: Edge "fraud-self" connects node "fraud" to itself\. Hint: Connect the edge to a different target node\.[\s\S]*reroute each offending edge to an earlier distinct process or decision node\.[\s\S]*model every retry or re-check as a decision branch returning to that earlier distinct node\./u,
								),
								role: "user",
							}),
						],
					}),
				}),
			);
		}),
	);
});

const returnsMinimumPrompt: DiagramGenerationPrompt = {
	id: "returns-minimum-repair",
	request:
		"Create an ecommerce returns flowchart with at least 18 distinct steps and a fraud review loop.",
	requestedType: "flowchart",
};
let compactingRepairCalls = 0;
const compactingRepairRun = vi.fn<CloudflareAiGateway["run"]>(async () => {
	compactingRepairCalls += 1;
	if (compactingRepairCalls === 1) {
		return chatTextResponse(returnsDiagramText(18, true));
	}
	return chatTextResponse(
		compactingRepairCalls === 2 ? returnsDiagramText(16, false) : returnsDiagramText(18, false),
	);
});
const compactingRepairClientLayer = CloudflareGatewayChatClientLive.pipe(
	Layer.provide(
		Layer.mergeAll(
			Layer.succeed(CloudflareAiGatewayBinding, {
				gateway: () => ({ getUrl: vi.fn(), run: compactingRepairRun }),
			}),
			configLayer,
			Layer.succeed(DiagramGenerationPolicy, diagramGenerationPolicyDefaults),
		),
	),
);

layer(compactingRepairClientLayer)("repair-introduced violations", (it) => {
	it.effect("repairs a broken diagram once and delivers the repair", () =>
		Effect.gen(function* () {
			compactingRepairCalls = 0;
			compactingRepairRun.mockClear();
			const client = yield* DiagramGenerationClient;
			const candidate = yield* client.generate({
				model: "google/gemini-3.1-flash-lite",
				prompt: returnsMinimumPrompt,
			});

			assert.strictEqual(compactingRepairRun.mock.calls.length, 2);
			assert.strictEqual(candidate.diagram?.type, "flowchart");
			expect(candidate.diagnostics).toEqual(
				expect.arrayContaining([
					expect.stringContaining("flowchart.self_loop:"),
					"repair_succeeded: semantic repair attempt 1 succeeded.",
				]),
			);

			const repairBody = JSON.stringify(compactingRepairRun.mock.calls[1]?.[0].query);
			expect(repairBody).toContain(
				"PRESERVE all existing nodes and labels except the minimal edit needed",
			);
			expect(repairBody).toContain("Original hard requirements (all remain mandatory):");
			expect(repairBody).toContain("re-check");
			expect(repairBody).not.toContain("nativeKind");
		}),
	);
});

let failedRepairCalls = 0;
const failedRepairRun = vi.fn<CloudflareAiGateway["run"]>(async () => {
	failedRepairCalls += 1;
	return chatTextResponse(failedRepairCalls === 1 ? invalidDiagramText : '{"type":"flowchart"');
});
const failedRepairClientLayer = CloudflareGatewayChatClientLive.pipe(
	Layer.provide(
		Layer.mergeAll(
			Layer.succeed(CloudflareAiGatewayBinding, {
				gateway: () => ({ getUrl: vi.fn(), run: failedRepairRun }),
			}),
			configLayer,
			retryPolicyLayer,
		),
	),
);

layer(failedRepairClientLayer)("failed semantic repair", (it) => {
	it.effect("returns composed diagnostics after the bounded repair fails", () =>
		Effect.gen(function* () {
			failedRepairCalls = 0;
			failedRepairRun.mockClear();
			const client = yield* DiagramGenerationClient;
			const candidate = yield* client.generate({
				model: "google/gemini-3.1-flash-lite",
				prompt,
			});

			assert.strictEqual(failedRepairRun.mock.calls.length, 2);
			assert.isUndefined(candidate.diagram);
			assert.strictEqual(candidate.text, invalidDiagramText);
			assert.notStrictEqual(candidate.text, '{"type":"flowchart"');
			assert.match(candidate.error ?? "", /Decision node/u);
			assert.isTrue(
				candidate.diagnostics.some((diagnostic) =>
					diagnostic.startsWith("flowchart.underbranched_decision:"),
				),
			);
			assert.isTrue(
				candidate.diagnostics.some((diagnostic) => diagnostic.startsWith("json_parse_error:")),
			);
			assert.isTrue(
				candidate.diagnostics.includes("repair_failed: semantic repair attempt 1 failed."),
			);
		}),
	);
});

let exhaustedRepairCalls = 0;
const exhaustedRepairRun = vi.fn<CloudflareAiGateway["run"]>(async () => {
	exhaustedRepairCalls += 1;
	return exhaustedRepairCalls === 1
		? chatTextResponse(invalidDiagramText)
		: jsonResponse(
				{ error: { message: "repair provider temporarily unavailable" } },
				{ status: 503 },
			);
});
const exhaustedRepairClientLayer = CloudflareGatewayChatClientLive.pipe(
	Layer.provide(
		Layer.mergeAll(
			Layer.succeed(CloudflareAiGatewayBinding, {
				gateway: () => ({ getUrl: vi.fn(), run: exhaustedRepairRun }),
			}),
			configLayer,
			retryPolicyLayer,
		),
	),
);

layer(exhaustedRepairClientLayer)("failed repair transport", (it) => {
	it.effect("returns the original malformed candidate and records a failed repair", () => {
		const { probe, sink } = makeTelemetryTestSink();
		const telemetryLayer = makeWorkersTelemetryLayer({
			resource: { serviceName: "sketchi-generation-repair-failure-test" },
			sink,
		});
		return Effect.gen(function* () {
			exhaustedRepairCalls = 0;
			exhaustedRepairRun.mockClear();
			const client = yield* DiagramGenerationClient;
			const fiber = yield* Effect.forkChild(
				client.generate({
					model: "google/gemini-3.1-flash-lite",
					prompt,
				}),
			);
			yield* TestClock.adjust("1 second");
			const candidate = yield* Fiber.join(fiber);

			assert.strictEqual(exhaustedRepairRun.mock.calls.length, 4);
			assert.isUndefined(candidate.diagram);
			assert.strictEqual(candidate.text, invalidDiagramText);
			assert.match(candidate.error ?? "", /Decision node/u);
			assert.isTrue(
				candidate.diagnostics.some((diagnostic) =>
					diagnostic.includes("repair provider temporarily unavailable"),
				),
			);
			assert.isTrue(
				candidate.diagnostics.includes("repair_failed: semantic repair attempt 1 failed."),
			);
			const repairs = probe.events.filter(
				(event): event is TelemetryMetricEvent =>
					event.event === "effect.metric" && event.metric === "sketchi_generation_repairs",
			);
			assert.deepStrictEqual(
				repairs.map((event) => event.attributes["outcome"]),
				["attempted", "failed"],
			);
			assert.strictEqual(
				probe.events.filter(
					(event): event is TelemetryMetricEvent =>
						event.event === "effect.metric" && event.metric === "sketchi_generation_failures",
				).length,
				0,
			);
		}).pipe(Effect.provide(telemetryLayer));
	});
});

let interruptedRepairCalls = 0;
const interruptedRepairSignals: AbortSignal[] = [];
const interruptedRepairRun = vi.fn<CloudflareAiGateway["run"]>(async (_data, options) => {
	interruptedRepairCalls += 1;
	if (interruptedRepairCalls === 1) {
		return chatTextResponse(invalidDiagramText);
	}
	const signal = options?.signal;
	if (!signal) {
		throw new Error("Repair request omitted AbortSignal.");
	}
	interruptedRepairSignals.push(signal);
	return new Promise<Response>((_resolve, reject) => {
		signal.addEventListener(
			"abort",
			() =>
				reject(
					signal.reason instanceof Error ? signal.reason : new Error("Repair request aborted."),
				),
			{ once: true },
		);
	});
});
const interruptedRepairClientLayer = CloudflareGatewayChatClientLive.pipe(
	Layer.provide(
		Layer.mergeAll(
			Layer.succeed(CloudflareAiGatewayBinding, {
				gateway: () => ({ getUrl: vi.fn(), run: interruptedRepairRun }),
			}),
			configLayer,
			retryPolicyLayer,
		),
	),
);

layer(interruptedRepairClientLayer)("repair interruption", (it) => {
	it.effect("does not turn repair interruption into malformed output", () =>
		Effect.gen(function* () {
			interruptedRepairCalls = 0;
			interruptedRepairSignals.length = 0;
			interruptedRepairRun.mockClear();
			const client = yield* DiagramGenerationClient;
			const fiber = yield* Effect.forkChild(
				client.generate({
					model: "google/gemini-3.1-flash-lite",
					prompt,
				}),
			);
			while (interruptedRepairSignals.length === 0) {
				yield* Effect.yieldNow;
			}
			yield* Fiber.interrupt(fiber);
			const exit = yield* Fiber.await(fiber);

			if (Exit.isSuccess(exit)) {
				return assert.fail("Interrupted repair unexpectedly succeeded.");
			}
			assert.isTrue(Cause.hasInterrupts(exit.cause));
			assert.strictEqual(interruptedRepairRun.mock.calls.length, 2);
			assert.isTrue(interruptedRepairSignals[0]?.aborted);
		}),
	);
});

let multiRepairCalls = 0;
const multiRepairRun = vi.fn<CloudflareAiGateway["run"]>(async () => {
	multiRepairCalls += 1;
	if (multiRepairCalls === 1) {
		return jsonResponse(chatResponseBody('{"type":"flowchart"'));
	}
	return multiRepairCalls === 2 ? chatTextResponse(invalidDiagramText) : jsonResponse(chatResponse);
});
const multiRepairClientLayer = CloudflareGatewayChatClientLive.pipe(
	Layer.provide(
		Layer.mergeAll(
			Layer.succeed(CloudflareAiGatewayBinding, {
				gateway: () => ({ getUrl: vi.fn(), run: multiRepairRun }),
			}),
			configLayer,
			Layer.succeed(DiagramGenerationPolicy, {
				concurrency: 2,
				maxRepairAttempts: 2,
				maxRetries: 0,
				requestTimeoutMs: 1_000,
				retryDelayMs: 100,
				totalTimeoutMs: 60_000,
			}),
		),
	),
);

layer(multiRepairClientLayer)("multi-attempt semantic repair", (it) => {
	it.effect("repairs each attempt from only the latest invalid answer", () =>
		Effect.gen(function* () {
			multiRepairCalls = 0;
			multiRepairRun.mockClear();
			const client = yield* DiagramGenerationClient;
			const candidate = yield* client.generate({
				model: "google/gemini-3.1-flash-lite",
				prompt,
			});

			assert.strictEqual(candidate.diagram?.id, expectedDiagram.id);
			assert.strictEqual(candidate.attempts, 3);
			assert.deepStrictEqual(candidate.usage, {
				inputTokens: 33,
				outputTokens: 69,
				totalTokens: 102,
			});
			assert.strictEqual(multiRepairRun.mock.calls.length, 3);
			const firstRepair = JSON.stringify(multiRepairRun.mock.calls[1]?.[0].query);
			const secondRepair = JSON.stringify(multiRepairRun.mock.calls[2]?.[0].query);
			expect(firstRepair).toContain("Repair attempt 1");
			expect(secondRepair).toContain("Repair attempt 2");
			expect(candidate.diagnostics).toEqual(
				expect.arrayContaining([
					"repair_failed: semantic repair attempt 1 failed.",
					"repair_succeeded: semantic repair attempt 2 succeeded.",
				]),
			);
		}),
	);
});

const gatewayConstructionFailure = new Error("gateway construction failed");
const gatewayConstructionFailureLayer = CloudflareGatewayChatClientLive.pipe(
	Layer.provide(
		Layer.mergeAll(
			Layer.succeed(CloudflareAiGatewayBinding, {
				gateway: () => {
					throw gatewayConstructionFailure;
				},
			}),
			configLayer,
			retryPolicyLayer,
		),
	),
);

layer(gatewayConstructionFailureLayer)("provider preflight failures", (it) => {
	it.effect(
		"records terminal telemetry without an upstream attempt when gateway construction fails",
		() => {
			const { probe, sink } = makeTelemetryTestSink();
			const telemetryLayer = makeWorkersTelemetryLayer({
				resource: { serviceName: "sketchi-generation-preflight-test" },
				sink,
			});
			return Effect.gen(function* () {
				const client = yield* DiagramGenerationClient;
				const error = yield* Effect.flip(
					client.generate({
						model: "google/gemini-3.1-flash-lite",
						prompt,
					}),
				);

				assert.strictEqual(error._tag, "DiagramGenerationTransportError");
				if (error._tag === "DiagramGenerationTransportError") {
					assert.strictEqual(error.operation, "ai.gateway");
					assert.isFalse(error.retryable);
				}
				const metrics = probe.events.filter(
					(event): event is TelemetryMetricEvent => event.event === "effect.metric",
				);
				assert.strictEqual(
					metrics.filter((metric) => metric.metric === "sketchi_generation_attempts").length,
					0,
				);
				assert.strictEqual(
					metrics.filter((metric) => metric.metric === "sketchi_generation_retries").length,
					0,
				);
				for (const metricName of [
					"sketchi_generation_requests",
					"sketchi_generation_failures",
					"sketchi_generation_duration_ms",
				]) {
					const matching = metrics.filter((metric) => metric.metric === metricName);
					assert.strictEqual(matching.length, 1);
					assert.deepInclude(matching[0]?.attributes, {
						failure_category: "DiagramGenerationTransportError",
						operation: "generate",
						provider: "cloudflare-google-ai-studio",
					});
				}
			}).pipe(Effect.provide(telemetryLayer));
		},
	);
});

let transientAttempts = 0;
const transientRun = vi.fn(async () => {
	transientAttempts += 1;
	return transientAttempts < 3
		? jsonResponse({ error: { message: "temporarily unavailable" } }, { status: 503 })
		: jsonResponse(chatResponse);
});
const retryClientLayer = CloudflareGatewayChatClientLive.pipe(
	Layer.provide(
		Layer.mergeAll(
			Layer.succeed(CloudflareAiGatewayBinding, {
				gateway: () => ({ getUrl: vi.fn(), run: transientRun }),
			}),
			configLayer,
			retryPolicyLayer,
		),
	),
);

layer(retryClientLayer)("bounded retry policy", (it) => {
	it.effect("retries transient failures with correlated telemetry", () => {
		const { probe, sink } = makeTelemetryTestSink();
		const telemetryLayer = makeWorkersTelemetryLayer({
			resource: { serviceName: "sketchi-generation-test" },
			sink,
		});
		return Effect.gen(function* () {
			const client = yield* DiagramGenerationClient;
			const fiber = yield* Effect.forkChild(
				client.generate({
					model: "google/gemini-3.1-flash-lite",
					prompt,
				}),
			);
			yield* TestClock.adjust("1 second");
			const candidate = yield* Fiber.join(fiber);

			assert.strictEqual(candidate.diagram?.id, expectedDiagram.id);
			assert.strictEqual(transientAttempts, 3);
			const metrics = probe.events.filter(
				(event): event is TelemetryMetricEvent => event.event === "effect.metric",
			);
			const logs = probe.events.filter(
				(event): event is TelemetryLogEvent => event.event === "effect.log",
			);
			const attempts = probe.events.filter(
				(event): event is TelemetrySpanEvent =>
					event.event === "effect.span" && event.name === "diagramGeneration.gatewayChat.attempt",
			);
			assert.strictEqual(
				metrics.filter((metric) => metric.metric === "sketchi_generation_attempts").length,
				3,
			);
			assert.strictEqual(
				metrics.filter((metric) => metric.metric === "sketchi_generation_retries").length,
				2,
			);
			assert.deepStrictEqual(
				logs.map((log) => log.fields["attempt"]),
				[2, 3],
			);
			assert.deepStrictEqual(
				attempts.map((span) => span.attributes["attempt"]),
				[1, 2, 3],
			);
			assert.isTrue(
				attempts.every(
					(span) =>
						span.attributes["sketchi.scenario_id"] === prompt.id &&
						span.trace_id === attempts[0]?.trace_id,
				),
			);
		}).pipe(Effect.provide(telemetryLayer));
	});
});

const permanentRun = vi.fn(async () =>
	jsonResponse({ error: { message: "invalid request" } }, { status: 400 }),
);
const permanentClientLayer = CloudflareGatewayChatClientLive.pipe(
	Layer.provide(
		Layer.mergeAll(
			Layer.succeed(CloudflareAiGatewayBinding, {
				gateway: () => ({ getUrl: vi.fn(), run: permanentRun }),
			}),
			configLayer,
			retryPolicyLayer,
		),
	),
);

layer(permanentClientLayer)("non-retryable failures", (it) => {
	it.effect("does not retry a permanent HTTP failure", () =>
		Effect.gen(function* () {
			const client = yield* DiagramGenerationClient;
			const error = yield* Effect.flip(
				client.generate({
					model: "google/gemini-3.1-flash-lite",
					prompt,
				}),
			);

			assert.strictEqual(error._tag, "DiagramGenerationHttpError");
			assert.strictEqual(permanentRun.mock.calls.length, 1);
		}),
	);
});

const cancellationSignals: AbortSignal[] = [];
let activeUpstreamRequests = 0;
let maxActiveUpstreamRequests = 0;
const timeoutRun = vi.fn<CloudflareAiGateway["run"]>((_data, options) => {
	const signal = options?.signal;

	if (!signal) {
		return Promise.reject(new Error("Generation request omitted AbortSignal."));
	}

	cancellationSignals.push(signal);
	activeUpstreamRequests += 1;
	maxActiveUpstreamRequests = Math.max(maxActiveUpstreamRequests, activeUpstreamRequests);

	return new Promise<Response>((_resolve, reject) => {
		signal.addEventListener(
			"abort",
			() => {
				activeUpstreamRequests -= 1;
				reject(
					signal.reason instanceof Error ? signal.reason : new Error("Upstream request aborted."),
				);
			},
			{ once: true },
		);
	});
});
const timeoutClientLayer = CloudflareGatewayChatClientLive.pipe(
	Layer.provide(
		Layer.mergeAll(
			Layer.succeed(CloudflareAiGatewayBinding, {
				gateway: () => ({ getUrl: vi.fn(), run: timeoutRun }),
			}),
			configLayer,
			cancellationPolicyLayer,
		),
	),
);

layer(timeoutClientLayer)("timeouts and interruption", (it) => {
	it.effect("aborts timed-out attempts and records one terminal timeout", () => {
		const { probe, sink } = makeTelemetryTestSink();
		const telemetryLayer = makeWorkersTelemetryLayer({
			resource: { serviceName: "sketchi-generation-timeout-test" },
			sink,
		});
		return Effect.gen(function* () {
			cancellationSignals.length = 0;
			activeUpstreamRequests = 0;
			maxActiveUpstreamRequests = 0;
			timeoutRun.mockClear();
			const client = yield* DiagramGenerationClient;
			const fiber = yield* Effect.forkChild(
				Effect.flip(
					client.generate({
						model: "google/gemini-3.1-flash-lite",
						prompt,
					}),
				),
			);
			yield* TestClock.adjust("2 seconds");
			const error = yield* Fiber.join(fiber);

			assert.strictEqual(error._tag, "DiagramGenerationTimeoutError");
			assert.strictEqual(timeoutRun.mock.calls.length, 2);
			assert.strictEqual(cancellationSignals.length, 2);
			assert.isTrue(cancellationSignals.every((signal) => signal.aborted));
			assert.strictEqual(activeUpstreamRequests, 0);
			assert.strictEqual(maxActiveUpstreamRequests, 1);
			const metrics = probe.events.filter(
				(event): event is TelemetryMetricEvent => event.event === "effect.metric",
			);
			const logs = probe.events.filter(
				(event): event is TelemetryLogEvent => event.event === "effect.log",
			);
			assert.strictEqual(
				metrics.filter((metric) => metric.metric === "sketchi_generation_timeouts").length,
				1,
			);
			assert.deepInclude(
				metrics.find((metric) => metric.metric === "sketchi_generation_failures")?.attributes,
				{
					failure_category: "DiagramGenerationTimeoutError",
					operation: "generate",
					provider: "cloudflare-google-ai-studio",
				},
			);
			assert.strictEqual(logs.length, 1);
			assert.strictEqual(logs[0]?.message, "Retrying diagram generation");
			assert.strictEqual(logs[0]?.fields["attempt"], 2);
		}).pipe(Effect.provide(telemetryLayer));
	});

	it.effect("preserves interruption instead of translating it", () =>
		Effect.gen(function* () {
			cancellationSignals.length = 0;
			activeUpstreamRequests = 0;
			maxActiveUpstreamRequests = 0;
			timeoutRun.mockClear();
			const client = yield* DiagramGenerationClient;
			const signalCountBeforeInterrupt = cancellationSignals.length;
			const fiber = yield* Effect.forkChild(
				client.generate({
					model: "google/gemini-3.1-flash-lite",
					prompt,
				}),
			);
			while (cancellationSignals.length === signalCountBeforeInterrupt) {
				yield* Effect.yieldNow;
			}
			yield* Fiber.interrupt(fiber);
			const exit = yield* Fiber.await(fiber);

			if (Exit.isSuccess(exit)) {
				return assert.fail("Interrupted generation unexpectedly succeeded.");
			}
			assert.isTrue(Cause.hasInterrupts(exit.cause));
			assert.strictEqual(cancellationSignals.length, signalCountBeforeInterrupt + 1);
			assert.isTrue(cancellationSignals.at(-1)?.aborted);
			assert.strictEqual(activeUpstreamRequests, 0);
		}),
	);
});

const malformedRun = vi.fn(async () =>
	jsonResponse({ choices: [], created: 1, id: "chatcmpl-test", model: "m" }),
);
const malformedClientLayer = CloudflareGatewayChatClientLive.pipe(
	Layer.provide(
		Layer.mergeAll(
			Layer.succeed(CloudflareAiGatewayBinding, {
				gateway: () => ({ getUrl: vi.fn(), run: malformedRun }),
			}),
			configLayer,
			retryPolicyLayer,
		),
	),
);

layer(malformedClientLayer)("malformed model responses", (it) => {
	it.effect("returns a typed response error without retrying", () =>
		Effect.gen(function* () {
			const client = yield* DiagramGenerationClient;
			const error = yield* Effect.flip(
				client.generate({
					model: "google/gemini-3.1-flash-lite",
					prompt,
				}),
			);

			assert.strictEqual(error._tag, "DiagramGenerationResponseError");
			assert.strictEqual(error.message, "Gemini response did not include text content.");
			assert.strictEqual(malformedRun.mock.calls.length, 1);
		}),
	);
});

const truncatedRun = vi.fn<CloudflareAiGateway["run"]>(async () =>
	jsonResponse(chatResponseBody('{"type":"flowchart"', "length")),
);
const truncatedClientLayer = CloudflareGatewayChatClientLive.pipe(
	Layer.provide(
		Layer.mergeAll(
			Layer.succeed(CloudflareAiGatewayBinding, {
				gateway: () => ({ getUrl: vi.fn(), run: truncatedRun }),
			}),
			configLayer,
			retryPolicyLayer,
		),
	),
);

layer(truncatedClientLayer)("token-budget exhaustion", (it) => {
	it.effect("fails a cut-off answer as an output limit without regenerating or repairing it", () =>
		Effect.gen(function* () {
			truncatedRun.mockClear();
			const client = yield* DiagramGenerationClient;
			const error = yield* Effect.flip(
				client.generate({
					model: "google/gemini-3.1-flash-lite",
					prompt,
				}),
			);

			assert.strictEqual(error._tag, "DiagramGenerationLimitError");
			assert.strictEqual(truncatedRun.mock.calls.length, 1);
			expect(error).toMatchObject({
				limit: "output_tokens",
				message: "The diagram needs more than the 16,384-token output limit allows in one answer.",
			});
		}),
	);
});

/** A flowchart one node past the family limit, as a model would return it. */
const oversizedFlowchartText = generationResponseText({
	id: "oversized",
	title: "Oversized",
	type: "flowchart",
	nodes: Array.from({ length: FLOWCHART_MAX_NODES + 1 }, (_, index) => ({
		id: `n${index}`,
		kind: index === 0 ? "start" : index === FLOWCHART_MAX_NODES ? "end" : "process",
		label: `Step ${index}`,
	})),
	edges: Array.from({ length: FLOWCHART_MAX_NODES }, (_, index) => ({
		id: `e${index}`,
		source: `n${index}`,
		target: `n${index + 1}`,
	})),
	layout: { direction: "TB", edgeRouting: "orthogonal" },
});
let oversizedCalls = 0;
const oversizedRun = vi.fn<CloudflareAiGateway["run"]>(async () => {
	oversizedCalls += 1;
	// The repair of an invalid first answer comes back past the size limit.
	return chatTextResponse(oversizedCalls === 1 ? '{"type":"flowchart"' : oversizedFlowchartText);
});
const oversizedClientLayer = CloudflareGatewayChatClientLive.pipe(
	Layer.provide(
		Layer.mergeAll(
			Layer.succeed(CloudflareAiGatewayBinding, {
				gateway: () => ({ getUrl: vi.fn(), run: oversizedRun }),
			}),
			configLayer,
			Layer.succeed(DiagramGenerationPolicy, {
				concurrency: 2,
				maxRepairAttempts: 2,
				maxRetries: 2,
				requestTimeoutMs: 1_000,
				retryDelayMs: 100,
				totalTimeoutMs: 60_000,
			}),
		),
	),
);

layer(oversizedClientLayer)("family size limits", (it) => {
	it.effect("fails a diagram past its family limit instead of repairing content away", () =>
		Effect.gen(function* () {
			oversizedCalls = 0;
			oversizedRun.mockClear();
			const client = yield* DiagramGenerationClient;
			const error = yield* Effect.flip(
				client.generate({ model: "google/gemini-3.1-flash-lite", prompt }),
			);

			assert.strictEqual(error._tag, "DiagramGenerationLimitError");
			assert.strictEqual(oversizedRun.mock.calls.length, 2);
			expect(error).toMatchObject({
				limit: "diagram_size",
				message: `Flowchart has ${FLOWCHART_MAX_NODES + 1} nodes; the supported maximum is ${FLOWCHART_MAX_NODES}.`,
			});
			expect(error._tag === "DiagramGenerationLimitError" && error.diagnostics[0]).toMatch(
				/^flowchart\.flowchart_too_large: /,
			);
		}),
	);
});

const deadlineClientLayer = CloudflareGatewayChatClientLive.pipe(
	Layer.provide(
		Layer.mergeAll(
			Layer.succeed(CloudflareAiGatewayBinding, {
				gateway: () => ({ getUrl: vi.fn(), run: timeoutRun }),
			}),
			configLayer,
			Layer.succeed(DiagramGenerationPolicy, {
				concurrency: 2,
				maxRepairAttempts: 2,
				maxRetries: 2,
				requestTimeoutMs: 1_000,
				retryDelayMs: 100,
				totalTimeoutMs: 1_500,
			}),
		),
	),
);

layer(deadlineClientLayer)("request deadline", (it) => {
	it.effect("retries a slow call only while the request's limit leaves time", () =>
		Effect.gen(function* () {
			cancellationSignals.length = 0;
			timeoutRun.mockClear();
			const client = yield* DiagramGenerationClient;
			const fiber = yield* Effect.forkChild(
				Effect.flip(client.generate({ model: "google/gemini-3.1-flash-lite", prompt })),
			);
			yield* TestClock.adjust("2 seconds");
			const error = yield* Fiber.join(fiber);

			// One full call, then a retry cut short by the request's 1.5 s limit, then no more.
			assert.strictEqual(timeoutRun.mock.calls.length, 2);
			expect(error).toMatchObject({
				_tag: "DiagramGenerationTimeoutError",
				message: "Generation did not finish within its 1.5-second limit.",
				scope: "request",
				timeoutMs: 1_500,
			});
			assert.isTrue(cancellationSignals.every((signal) => signal.aborted));
		}),
	);
});

const substitutedClientLayer = Layer.succeed(DiagramGenerationClient, {
	provider: "fixture",
	generate: Effect.fn("diagramGeneration.test.generate")(function* () {
		return candidateFromText({
			model: "fixture",
			provider: "fixture",
			text: expectedText,
		});
	}),
});

layer(substitutedClientLayer)("client layer substitution", (it) => {
	it.effect("substitutes the client without changing business code", () =>
		Effect.gen(function* () {
			const client = yield* DiagramGenerationClient;
			const candidate = yield* client.generate({ model: "fixture", prompt });

			assert.strictEqual(client.provider, "fixture");
			assert.strictEqual(candidate.diagram?.id, expectedDiagram.id);
		}),
	);
});
