import { CanvasSpec } from "@sketchi/drawing";
import { DIAGRAM_TYPES, diagramFixtures, familyForType } from "@sketchi/diagrams/family";

import {
	type CloudflareAiGateway,
	type CloudflareAiGatewayProvider,
} from "@sketchi/cloudflare/ai-gateway";
import { diagramScenarios, scenarioFlowchartDocument } from "@sketchi/diagram-scenarios";

import {
	FlowchartDiagram,
	FLOWCHART_MAX_NODES,
} from "@sketchi/diagrams/families/flowchart/document";
import { sankeyStressFixtures } from "@sketchi/diagrams/families/sankey/fixtures";
import { mediaPlayerStateMachine } from "@sketchi/diagrams/families/state-machine/document";
import { ExcalidrawFile } from "@sketchi/drawing/excalidraw";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { type StudioEnv } from "../../../server/studio-env.server";
import { runStudioEffect } from "../../../server/runtime.server";
import { serveDiagramsApi } from "../../build/http.server";

/** A model's flowchart answer: the flowchart document. */
const flowchartAnswer = {
	id: "generated-release-flow",
	title: "Generated release flow",
	type: "flowchart",
	nodes: {
		start: "Change proposed",
		review: "Review evidence",
		decision: "Evidence complete?",
		approve: "Approve release",
		revise: "Request revision",
		end: "Release recorded",
	},
	edges: [
		["start", "review"],
		["review", "decision"],
		["decision", "approve", "Complete"],
		["decision", "revise", "Incomplete"],
		["approve", "end"],
		["revise", "end"],
	],
};

function generationText(diagram: Readonly<Record<string, unknown>>): string {
	const { title, type, ...diagramWithoutTitle } = diagram;
	// A drawn flowchart fixture reaches the model's answer as its document.
	if (type === "flowchart" && Array.isArray(diagram["nodes"])) {
		const { title: documentTitle, ...document } = scenarioFlowchartDocument(
			Schema.decodeUnknownSync(FlowchartDiagram)(diagram),
		);
		return JSON.stringify({ title: documentTitle, diagram: { type, ...document } });
	}
	return JSON.stringify({
		title,
		diagram: { ...diagramWithoutTitle, type },
	});
}

function fakeAiGateway(
	text: string,
	observeRun?: (...args: Parameters<CloudflareAiGateway["run"]>) => void,
	completion: { readonly finishReason?: string; readonly usage?: unknown } = {},
): CloudflareAiGatewayProvider {
	return {
		gateway: () => ({
			run: (input, options) => {
				observeRun?.(input, options);
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
	return runStudioEffect(serveDiagramsApi(request), testBoundary(env, request));
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
			expect(() => decode(CanvasSpec, body.diagram?.scene)).not.toThrow();
			expect(() => decode(ExcalidrawFile, body.diagram?.excalidraw)).not.toThrow();
			expect(() =>
				decode(familyForType(diagram.type).spec, body.diagram?.document.spec),
			).not.toThrow();
		},
	);

	it("decoded a response from every canonical family", () => {
		expect(decoded).toEqual(new Set(DIAGRAM_TYPES));
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

	it("reports a provider failure when the AI binding is missing", async () => {
		const response = await generateRequest({}, { prompt: "Any diagram" });

		expect(response.status).toBe(502);
		const body = (await response.json()) as Record<string, unknown>;
		expect(body.ok).toBe(false);
		expect(body.status).toBe("provider_failed");
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
			nodes: Object.fromEntries(
				Array.from({ length: steps }, (_, index) => [`n${index}`, `Step ${index}`]),
			),
			edges: Array.from({ length: steps - 1 }, (_, index) => [`n${index}`, `n${index + 1}`]),
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

	it("reports a generated mindmap's size limit without another model call", async () => {
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
		let modelCalls = 0;
		const env: StudioEnv = {
			AI: fakeAiGateway(wide, () => {
				modelCalls++;
			}),
		};
		const response = await generateRequest(env, { prompt: "Map every idea", type: "mindmap" });

		expect(response.status).toBe(413);
		expect(modelCalls).toBe(1);
		expect(await response.json()).toMatchObject({
			status: "limit_exceeded",
			issues: [
				{
					code: "diagram_too_large",
					stage: "generation",
					message: "Mindmap exceeds the supported maximum of 200 topic slots.",
				},
			],
		});
	});
});

describe("revising a stored diagram", () => {
	it("rejects a base that is not a valid document before calling the model", async () => {
		let called = false;
		const env: StudioEnv = {
			AI: fakeAiGateway(generationText(flowchartAnswer), () => {
				called = true;
			}),
		};
		const response = await generateRequest(env, {
			prompt: "Add a step",
			base: { type: "flowchart", spec: { title: "No nodes" } },
		});

		expect(response.status).toBe(400);
		expect(called).toBe(false);
		const body = (await response.json()) as { issues: Array<{ code: string }> };
		expect(body.issues.map((entry) => entry.code)).toEqual(["invalid_base"]);
	});
});
