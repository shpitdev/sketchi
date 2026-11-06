import {
	CANONICAL_DOCUMENT_SPECS,
	ExcalidrawFileSchema,
	RenderedDiagramSceneSchema,
} from "@sketchi/diagram-agent";
import {
	diagramFixtures,
	FLOWCHART_MAX_NODES,
	mediaPlayerStateMachine,
	sankeyStressFixtures,
} from "@sketchi/diagram-core";
import { diagramScenarios } from "@sketchi/diagram-scenarios";
import { Schema } from "effect";
import type { CloudflareAiGateway, CloudflareAiGatewayProvider } from "@sketchi/diagram-generation";
import { describe, expect, it } from "vitest";

import { aiEnvironment } from "../bindings/ai-env.server";
import type { StudioEnv } from "../bindings/studio-env.server";
import { runPlaygroundEffect } from "../runtime/runtime.server";
import { handleGenerateDiagramRequest } from "./api.server";

const flowchartIr = {
	id: "generated-release-flow",
	title: "Generated release flow",
	type: "flowchart",
	nodes: [
		{ id: "start", label: "Change proposed", kind: "start" },
		{ id: "review", label: "Review evidence", kind: "process" },
		{ id: "decision", label: "Evidence complete?", kind: "decision" },
		{ id: "approve", label: "Approve release", kind: "process" },
		{ id: "revise", label: "Request revision", kind: "process" },
		{ id: "end", label: "Release recorded", kind: "end" },
	],
	edges: [
		{ id: "e1", source: "start", target: "review" },
		{ id: "e2", source: "review", target: "decision" },
		{ id: "e3", source: "decision", target: "approve", label: "Complete" },
		{ id: "e4", source: "decision", target: "revise", label: "Incomplete" },
		{ id: "e5", source: "approve", target: "end" },
		{ id: "e6", source: "revise", target: "end" },
	],
	layout: { direction: "TB", edgeRouting: "orthogonal" },
	style: { accentColor: "#0f766e", backgroundColor: "#ffffff" },
};

const sequenceIr = {
	id: "generated-login-sequence",
	title: "Login sequence",
	type: "sequence",
	participants: [
		{ id: "browser", label: "Browser" },
		{ id: "api", label: "API" },
		{ id: "database", label: "Database" },
	],
	messages: [
		{
			id: "login",
			source: "browser",
			target: "api",
			label: "Login request",
		},
		{
			id: "lookup",
			source: "api",
			target: "database",
			label: "Look up user",
		},
		{
			id: "record",
			source: "database",
			target: "api",
			label: "User record",
			type: "return",
		},
	],
};

function generationText(diagram: Readonly<Record<string, unknown>>): string {
	const { title, type, ...diagramWithoutTitle } = diagram;
	return JSON.stringify({
		title,
		diagram: { ...diagramWithoutTitle, type },
	});
}

function fakeAiGateway(
	text: string,
	observeRun?: (input: Parameters<CloudflareAiGateway["run"]>[0]) => void,
	completion: { readonly finishReason?: string; readonly usage?: unknown } = {},
): CloudflareAiGatewayProvider {
	return {
		gateway: () => ({
			run: (input) => {
				observeRun?.(input);
				return Promise.resolve(
					new Response(
						JSON.stringify({
							choices: [
								{
									finish_reason: completion.finishReason ?? "stop",
									index: 0,
									message: { content: text, role: "assistant" },
								},
							],
							created: 1,
							id: "chatcmpl-test",
							model: "gemini-3.1-flash-lite",
							...(completion.usage ? { usage: completion.usage } : {}),
						}),
						{ status: 200, headers: { "content-type": "application/json" } },
					),
				);
			},
			getUrl: () => Promise.resolve("https://gateway.invalid"),
		}),
	};
}

function testBoundary(env: StudioEnv, request: Request) {
	return {
		env,
		request,
		platform: {
			waitUntilPromise: (promise: Promise<unknown>) => {
				void promise;
			},
		},
	};
}

function generateRequest(env: StudioEnv, body: unknown): Promise<Response> {
	const request = new Request("https://playground.sketchi.app/api/v1/generate", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
	return runPlaygroundEffect(handleGenerateDiagramRequest(request), testBoundary(env, request));
}

// The published CLI decodes a 200 with exactly these schemas (apps/cli/src/generation.ts), and
// installed versions cannot be patched, so a response that fails them is a broken generate.
describe("generate responses installed CLIs can decode", () => {
	const diagrams = [
		...diagramFixtures,
		...Object.values(sankeyStressFixtures),
		...diagramScenarios.flatMap((scenario) => scenario.expectedDiagram ?? []),
	];
	const decoded = new Set<string>();

	it.each(diagrams.map((diagram) => [`${diagram.type} ${diagram.id}`, diagram] as const))(
		"%s",
		async (_name, diagram) => {
			const response = await generateRequest(
				{ AI: fakeAiGateway(generationText({ ...diagram })) },
				{ prompt: "Draw it", type: diagram.type },
			);
			const body = (await response.json()) as {
				readonly ok: boolean;
				readonly diagram?: {
					readonly document: { readonly spec: unknown };
					readonly excalidraw: unknown;
					readonly scene: unknown;
				};
			};
			// A diagram this API rejects with a typed failure is not this mismatch.
			if (!body.ok) return;
			decoded.add(diagram.type);
			const decode = (schema: Schema.Top & { readonly DecodingServices: never }, value: unknown) =>
				Schema.decodeUnknownSync(schema)(value);
			expect(() => decode(RenderedDiagramSceneSchema, body.diagram?.scene)).not.toThrow();
			expect(() => decode(ExcalidrawFileSchema, body.diagram?.excalidraw)).not.toThrow();
			expect(() =>
				decode(CANONICAL_DOCUMENT_SPECS[diagram.type], body.diagram?.document.spec),
			).not.toThrow();
		},
	);

	it("decoded a response from every canonical family", () => {
		expect(decoded).toEqual(new Set(Object.keys(CANONICAL_DOCUMENT_SPECS)));
	});
});

describe("public generate endpoint", () => {
	it("returns composite-entry warnings without blocking or retrying generation", async () => {
		let calls = 0;
		const diagram = {
			...mediaPlayerStateMachine,
			states: mediaPlayerStateMachine.states.map(({ initial: _initial, ...state }) => state),
		};
		const env: StudioEnv = {
			AI: fakeAiGateway(generationText(diagram), () => {
				calls += 1;
			}),
		};
		const response = await generateRequest(env, { prompt: "Media player", type: "state-machine" });
		const body = (await response.json()) as {
			ok: boolean;
			issues?: { code: string; severity: string; message: string }[];
		};
		expect(response.status).toBe(200);
		expect(body.ok).toBe(true);
		expect(calls).toBe(1);
		expect(body.issues).toEqual([
			expect.objectContaining({
				code: "composite_initial_defaulted",
				severity: "warning",
				message: expect.stringContaining('"playing"'),
			}),
		]);
	});

	it("generates and returns a built flowchart with inline artifacts", async () => {
		const env: StudioEnv = { AI: fakeAiGateway(generationText(flowchartIr)) };
		const response = await generateRequest(env, {
			prompt: "Map release approval with pass and revise branches",
			type: "flowchart",
		});

		expect(response.status).toBe(200);
		const body = (await response.json()) as Record<string, unknown>;
		expect(body.ok).toBe(true);
		expect(body.status).toBe("generated");
		const diagram = body.diagram as Record<string, unknown>;
		const document = diagram.document as { type: string };
		expect(document.type).toBe("flowchart");
		expect(diagram.scene).toBeTruthy();
		expect(diagram.excalidraw).toBeTruthy();
		const generation = body.generation as { provider: string };
		expect(generation.provider).toBe("cloudflare-google-ai-studio");
	});

	it("generates and returns a native sequence with inline artifacts", async () => {
		const env: StudioEnv = { AI: fakeAiGateway(generationText(sequenceIr)) };
		const response = await generateRequest(env, {
			prompt: "Show Browser, API, and Database login interactions",
			type: "sequence",
		});

		expect(response.status).toBe(200);
		const body = (await response.json()) as Record<string, unknown>;
		const diagram = body.diagram as Record<string, unknown>;
		const document = diagram.document as {
			type: string;
			spec: {
				participants: ReadonlyArray<unknown>;
				messages: ReadonlyArray<unknown>;
			};
		};
		expect(document.type).toBe("sequence");
		expect(document.spec.participants).toHaveLength(3);
		expect(document.spec.messages).toHaveLength(3);
		expect(diagram.scene).toBeTruthy();
		expect(diagram.excalidraw).toBeTruthy();
	});

	it("generates a native state machine whose transitions omit ids", async () => {
		const env: StudioEnv = {
			AI: fakeAiGateway(
				generationText({
					id: "turnstile",
					title: "Turnstile",
					type: "state-machine",
					initial: "locked",
					states: [
						{ id: "locked", label: "Locked" },
						{ id: "unlocked", label: "Unlocked" },
					],
					transitions: [
						{ source: "locked", target: "unlocked", event: "coin", guard: "valid" },
						{ source: "unlocked", target: "locked", event: "push" },
						{ source: "locked", target: "locked", event: "push", action: "alarm" },
					],
				}),
			),
		};
		const response = await generateRequest(env, {
			prompt: "Draw a coin turnstile state machine",
			type: "state-machine",
		});

		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			diagram: {
				document: { type: string; spec: { transitions: ReadonlyArray<{ id: string }> } };
				scene: unknown;
			};
		};
		expect(body.diagram.document.type).toBe("state-machine");
		expect(body.diagram.document.spec.transitions.map((transition) => transition.id)).toEqual([
			"locked-unlocked",
			"unlocked-locked",
			"locked-locked",
		]);
		expect(body.diagram.scene).toBeTruthy();
	});

	it("generates a native ER diagram from one-line fields and unnumbered relationships", async () => {
		const env: StudioEnv = {
			AI: fakeAiGateway(
				generationText({
					id: "shop",
					title: "Shop",
					type: "er",
					entities: [
						{ id: "customers", fields: ["id uuid PK", "email text UK"] },
						{ id: "orders", fields: ["id uuid PK", "customer_id uuid FK", "shipped_at date?"] },
					],
					relationships: [
						{
							from: "orders.customer_id",
							to: "customers.id",
							fromCardinality: "0..*",
							toCardinality: "exactly one",
						},
					],
				}),
			),
		};
		const response = await generateRequest(env, { prompt: "Draw the shop schema", type: "er" });

		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			diagram: {
				document: {
					type: string;
					spec: {
						entities: ReadonlyArray<{ fields: ReadonlyArray<Record<string, unknown>> }>;
						relationships: ReadonlyArray<Record<string, unknown>>;
					};
				};
				scene: unknown;
			};
		};
		expect(body.diagram.document.type).toBe("er");
		expect(body.diagram.document.spec.entities[1]?.fields[2]).toEqual({
			name: "shipped_at",
			type: "date",
			nullable: true,
		});
		expect(body.diagram.document.spec.relationships[0]).toMatchObject({
			id: "orders-customer_id-customers-id",
			fromCardinality: "zero-or-many",
			toCardinality: "one",
		});
		expect(body.diagram.scene).toBeTruthy();
	});

	it("lets the model select a native type when type is omitted", async () => {
		const env: StudioEnv = { AI: fakeAiGateway(generationText(sequenceIr)) };
		const response = await generateRequest(env, {
			prompt: "Show Browser, API, and Database login interactions",
		});

		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			diagram: { document: { type: string } };
		};
		expect(body.diagram.document.type).toBe("sequence");
	});

	it.each(["architecture", "swimlane", "gitgraph"])(
		"rejects type %s as invalid input before provider dispatch",
		async (type) => {
			let dispatched = false;
			const env: StudioEnv = {
				AI: fakeAiGateway(generationText(flowchartIr), () => {
					dispatched = true;
				}),
			};
			const response = await generateRequest(env, { prompt: "Draw it", type });

			expect(response.status).toBe(400);
			const body = (await response.json()) as { status: string };
			expect(body.status).toBe("invalid_input");
			expect(dispatched).toBe(false);
		},
	);

	it("rejects a diagram of another type than the request names", async () => {
		const response = await generateRequest(
			{ AI: fakeAiGateway(generationText(flowchartIr)) },
			{ prompt: "Draw it", type: "sequence" },
		);
		expect(response.status).toBe(422);
		const body = (await response.json()) as {
			status: string;
			issues: ReadonlyArray<{ code: string }>;
		};
		expect(body.status).toBe("quality_failed");
		expect(body.issues[0]?.code).toBe("explicit_type_not_met");
	});

	it("grounds generated node logos in the technologies the prompt names", async () => {
		const observedRuns: Array<Parameters<CloudflareAiGateway["run"]>[0]> = [];
		const logoIr = {
			...flowchartIr,
			nodes: flowchartIr.nodes.map((node) =>
				node.id === "start"
					? { ...node, label: "Change pushed to GitHub", icon: { slug: "github" } }
					: node.id === "review"
						? { ...node, icon: { slug: "kubernetes" } }
						: node,
			),
		};
		const assetRequests: string[] = [];
		const env: StudioEnv = {
			AI: fakeAiGateway(generationText(logoIr), (input) => {
				observedRuns.push(input);
			}),
			ASSETS: {
				fetch: async (input) => {
					const path = new URL(input instanceof Request ? input.url : input).pathname;
					assetRequests.push(path);
					return new Response(
						'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path d="M0 0h1"/></svg>',
					);
				},
			},
		};
		const response = await generateRequest(env, {
			prompt: "Push to GitHub, build with Docker, then release",
			type: "flowchart",
		});

		expect(response.status).toBe(200);
		const providerRequest = JSON.stringify(observedRuns[0]);
		expect(providerRequest).toContain("- github: Github");
		expect(providerRequest).toContain("- docker: Docker");
		expect(providerRequest).not.toContain("- kubernetes:");
		const body = (await response.json()) as {
			diagram: {
				document: { spec: { nodes: Array<{ id: string; icon?: unknown }> } };
				excalidraw: { elements: Array<{ type: string }>; files: object };
				scene: { icons?: Record<string, unknown> };
			};
		};
		expect(
			body.diagram.document.spec.nodes
				.filter((node) => node.icon)
				.map((node) => [node.id, node.icon]),
		).toEqual([["start", { slug: "github" }]]);
		expect(Object.keys(body.diagram.scene.icons ?? {})).toEqual(["github"]);
		expect(
			body.diagram.excalidraw.elements.filter((element) => element.type === "image"),
		).toHaveLength(1);
		expect(Object.keys(body.diagram.excalidraw.files)).toHaveLength(1);
		expect(assetRequests).toEqual(["/node-logos/github.svg"]);
	});

	it("requests fresh provider output for reliability probes", async () => {
		const observedRuns: Array<Parameters<CloudflareAiGateway["run"]>[0]> = [];
		const env: StudioEnv = {
			AI: fakeAiGateway(generationText(flowchartIr), (input) => {
				observedRuns.push(input);
			}),
		};
		const response = await generateRequest(env, {
			cacheMode: "fresh",
			prompt: "Map release approval with pass and revise branches",
			type: "flowchart",
		});

		expect(response.status).toBe(200);
		expect(observedRuns).toHaveLength(1);
		expect(observedRuns[0]).toEqual(
			expect.objectContaining({
				headers: expect.objectContaining({
					"Cache-Control": "no-store",
					"cf-aig-skip-cache": "true",
					Pragma: "no-cache",
				}),
			}),
		);
	});

	it("rejects an empty prompt with a typed invalid-input contract", async () => {
		const env: StudioEnv = { AI: fakeAiGateway(generationText(flowchartIr)) };
		const response = await generateRequest(env, { prompt: "   " });

		expect(response.status).toBe(400);
		const body = (await response.json()) as Record<string, unknown>;
		expect(body.ok).toBe(false);
		expect(body.status).toBe("invalid_input");
	});

	it("reports a provider failure when the AI binding is missing", async () => {
		const response = await generateRequest({}, { prompt: "Any diagram" });

		expect(response.status).toBe(502);
		const body = (await response.json()) as Record<string, unknown>;
		expect(body.ok).toBe(false);
		expect(body.status).toBe("provider_failed");
	});

	it("rejects a generated diagram whose type does not match the request", async () => {
		const env: StudioEnv = { AI: fakeAiGateway(generationText(flowchartIr)) };
		const response = await generateRequest(env, {
			prompt: "Organize launch readiness",
			type: "mindmap",
		});

		expect(response.status).toBe(422);
		const body = (await response.json()) as Record<string, unknown>;
		expect(body.status).toBe("quality_failed");
	});

	it("treats non-JSON model output as malformed output", async () => {
		const env: StudioEnv = { AI: fakeAiGateway("not a diagram") };
		const response = await generateRequest(env, {
			prompt: "Map a flow",
			type: "flowchart",
		});

		expect(response.status).toBe(422);
		const body = (await response.json()) as Record<string, unknown>;
		expect(body.status).toBe("malformed_output");
	});

	it("returns bounded validator diagnostics for malformed diagrams", async () => {
		const invalidFlowchart = {
			...flowchartIr,
			edges: [
				...flowchartIr.edges.map((edge) =>
					edge.id === "e4" ? { ...edge, label: "Complete" } : edge,
				),
				{ id: "end-retry", source: "end", target: "review" },
			],
		};
		const env: StudioEnv = {
			AI: fakeAiGateway(generationText(invalidFlowchart)),
		};
		const response = await generateRequest(env, {
			prompt: "Map a release flow with a retry loop",
			type: "flowchart",
		});

		expect(response.status).toBe(422);
		const body = (await response.json()) as {
			status: string;
			issues: ReadonlyArray<{ message: string }>;
		};
		expect(body.status).toBe("malformed_output");
		expect(body.issues.length).toBeGreaterThan(1);
		expect(body.issues.length).toBeLessThanOrEqual(8);
		expect(body.issues.map((entry) => entry.message).join("\n")).toContain("end_has_outgoing");
	});

	it("names the output limit an answer reached instead of repairing it", async () => {
		const runs: unknown[] = [];
		const env: StudioEnv = {
			AI: fakeAiGateway(
				'{"title":"Release","diagram":{"type":"flowchart"',
				(input) => runs.push(input),
				{
					finishReason: "length",
				},
			),
		};
		const response = await generateRequest(env, { prompt: "Map a flow", type: "flowchart" });

		expect(response.status).toBe(413);
		expect(runs).toHaveLength(1);
		expect(await response.json()).toMatchObject({
			ok: false,
			status: "limit_exceeded",
			issues: [
				{
					code: "output_limit_exceeded",
					message:
						"The diagram needs more than the 16,384-token output limit allows in one answer.",
				},
			],
		});
	});

	it("names the family limit a diagram passed instead of trimming it", async () => {
		const runs: unknown[] = [];
		const steps = FLOWCHART_MAX_NODES + 1;
		const oversized = {
			id: "oversized",
			title: "Oversized",
			type: "flowchart",
			nodes: Array.from({ length: steps }, (_, index) => ({
				id: `n${index}`,
				label: `Step ${index}`,
				kind: index === 0 ? "start" : index === steps - 1 ? "end" : "process",
			})),
			edges: Array.from({ length: steps - 1 }, (_, index) => ({
				id: `e${index}`,
				source: `n${index}`,
				target: `n${index + 1}`,
			})),
		};
		const env: StudioEnv = {
			AI: fakeAiGateway(generationText(oversized), (input) => runs.push(input)),
		};
		const response = await generateRequest(env, { prompt: "Map a long flow", type: "flowchart" });

		expect(response.status).toBe(413);
		expect(runs).toHaveLength(1);
		expect(await response.json()).toMatchObject({
			status: "limit_exceeded",
			issues: [
				{
					code: "diagram_too_large",
					message: `Flowchart has ${steps} nodes; the supported maximum is ${FLOWCHART_MAX_NODES}.`,
				},
			],
		});
	});

	it("reports a build's size limit as a limit, not a defect", async () => {
		const wide = JSON.stringify({
			title: "Every idea",
			diagram: {
				type: "mindmap",
				id: "every-idea",
				root: {
					label: "Ideas",
					children: Array.from({ length: 210 }, (_, index) => ({
						label: `Idea ${index + 1}`,
						children: [],
					})),
				},
			},
		});
		const env: StudioEnv = { AI: fakeAiGateway(wide) };
		const response = await generateRequest(env, { prompt: "Map every idea", type: "mindmap" });

		expect(response.status).toBe(413);
		expect(await response.json()).toMatchObject({
			status: "limit_exceeded",
			issues: [{ code: "mindmap_too_large", stage: "build" }],
		});
	});

	it("reports the model calls, time and tokens a generation took", async () => {
		const env: StudioEnv = {
			AI: fakeAiGateway(generationText(flowchartIr), undefined, {
				usage: { prompt_tokens: 6_000, completion_tokens: 900, total_tokens: 6_900 },
			}),
		};
		const response = await generateRequest(env, {
			prompt: "Show release approval",
			type: "flowchart",
		});
		const body = (await response.json()) as { generation: unknown };

		expect(response.status).toBe(200);
		expect(body.generation).toMatchObject({
			attempts: 1,
			usage: { inputTokens: 6_000, outputTokens: 900 },
		});
	});
});

describe("generation request boundaries", () => {
	it.each([
		"gemini-2.5-flash",
		"google/gemini-2.5-flash",
		"google-ai-studio/gemini-2.5-flash",
		"google-ai-studio/google/gemini-3.1-flash-lite",
		"GEMINI-3.1-FLASH-LITE",
		" gemini-3.1-flash-lite ",
		"gemini-2.5-flash:countTokens?x=",
		"google/../other",
		"x".repeat(129),
		"",
	])("rejects unsupported model %s before gateway dispatch", async (model) => {
		let calls = 0;
		const response = await generateRequest(
			{
				AI: fakeAiGateway(generationText(flowchartIr), () => {
					calls += 1;
				}),
			},
			{
				prompt: "Show release approval",
				model,
			},
		);
		expect(response.status).toBe(400);
		const body = (await response.json()) as {
			ok: boolean;
			status: string;
			issues: { code: string; stage: string; message: string; hint: string }[];
		};
		expect(body).toMatchObject({
			ok: false,
			status: "unsupported_model",
			issues: [{ code: "unsupported_model", stage: "input" }],
		});
		expect(body.issues[0]?.message).toBe("The requested model is not supported.");
		expect(calls).toBe(0);
	});

	it("rejects a non-string model as invalid input before gateway dispatch", async () => {
		let calls = 0;
		const response = await generateRequest(
			{
				AI: fakeAiGateway(generationText(flowchartIr), () => {
					calls += 1;
				}),
			},
			{ prompt: "Show release approval", model: 42 },
		);
		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ ok: false, status: "invalid_input" });
		expect(calls).toBe(0);
	});

	// Installed CLIs send the bare id on every request, so naming it follows the deployment.
	it.each([
		"gemini-3.1-flash-lite",
		"google/gemini-3.1-flash-lite",
		"google-ai-studio/gemini-3.1-flash-lite",
	])("resolves the installed CLI default %s to the configured model", async (model) => {
		const models: unknown[] = [];
		const response = await generateRequest(
			{
				AI: fakeAiGateway(generationText(flowchartIr), (input) => {
					models.push((input.query as { readonly model?: unknown }).model);
				}),
				SKETCHI_AI_MODEL: "google/configured-model",
			},
			{ prompt: "Show release approval", type: "flowchart", model },
		);
		expect(response.status).toBe(200);
		expect(models).toEqual(["configured-model"]);
	});

	it.each([
		["with no model", {}],
		["naming the installed CLI default", { model: "gemini-3.1-flash-lite" }],
	])("routes generate to its own model %s", async (_name, requested) => {
		const runs: Parameters<CloudflareAiGateway["run"]>[0][] = [];
		const response = await generateRequest(
			{
				AI: fakeAiGateway(generationText(flowchartIr), (input) => {
					runs.push(input);
				}),
				SKETCHI_AI_GENERATE_MODEL: "anthropic/claude-haiku-5-5",
				SKETCHI_AI_MODEL: "google/configured-model",
			},
			{ prompt: "Show release approval", type: "flowchart", ...requested },
		);
		const body = (await response.json()) as { generation: unknown };
		expect(response.status).toBe(200);
		expect(body.generation).toEqual({
			attempts: 1,
			durationMs: expect.any(Number),
			model: "claude-haiku-5-5",
			provider: "cloudflare-anthropic",
		});
		expect(runs).toMatchObject([
			{
				endpoint: "v1/chat/completions",
				provider: "anthropic",
				query: { model: "claude-haiku-5-5" },
			},
		]);
	});

	it("does not route chat's model through a Haiku generate model", () => {
		const environment = aiEnvironment({
			SKETCHI_AI_GENERATE_MODEL: "anthropic/claude-haiku-5-5",
			SKETCHI_AI_MODEL: "google/configured-model",
		});
		expect(environment.model).toBe("google/configured-model");
		expect(environment.generateModel).toBe("anthropic/claude-haiku-5-5");
	});

	it("falls back to the shared model when generate has none of its own", () => {
		expect(aiEnvironment({ SKETCHI_AI_MODEL: "google/configured-model" }).generateModel).toBe(
			"google/configured-model",
		);
	});

	it("draws the logo a group's label names once the diagram draws a logo", async () => {
		const diagram = {
			...flowchartIr,
			groups: [{ id: "edge", label: "Vercel" }],
			nodes: flowchartIr.nodes.map((node, index) =>
				index === 0
					? { ...node, label: "Push to GitHub", group: "edge", icon: { slug: "github" } }
					: node,
			),
		};
		const response = await generateRequest(
			{
				AI: fakeAiGateway(generationText(diagram)),
				ASSETS: {
					fetch: async () =>
						new Response(
							'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0h1"/></svg>',
						),
				},
			},
			{ prompt: "Push to GitHub on Vercel", type: "flowchart" },
		);
		const body = (await response.json()) as {
			issues: readonly { readonly severity: string }[];
			diagram: { scene: { icons?: Record<string, unknown> } };
		};
		expect(response.status).toBe(200);
		expect(Object.keys(body.diagram.scene.icons ?? {}).toSorted()).toEqual(["github", "vercel"]);
		expect(body.issues.filter((issue) => issue.severity === "info")).toEqual([]);
	});

	it("uses the configured model when a request names none", async () => {
		const models: unknown[] = [];
		const response = await generateRequest(
			{
				AI: fakeAiGateway(generationText(flowchartIr), (input) => {
					models.push((input.query as { readonly model?: unknown }).model);
				}),
				SKETCHI_AI_MODEL: "google/configured-model",
			},
			{ prompt: "Show release approval", type: "flowchart" },
		);
		expect(response.status).toBe(200);
		expect(models).toEqual(["configured-model"]);
	});

	it.each(["__tooLarge", "__invalidJson"])(
		"does not treat client key %s as a reader result",
		async (key) => {
			const response = await generateRequest(
				{ AI: fakeAiGateway(generationText(flowchartIr)) },
				{ prompt: "Show release approval", [key]: true },
			);
			expect(response.status).toBe(200);
		},
	);
});
