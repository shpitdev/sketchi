import { describe, expect, it } from "@effect/vitest";
import { generateText, jsonSchema, tool } from "ai";
import { Effect } from "effect";

import type { CloudflareAiGateway } from "@sketchi/diagram-generation";

import { PlaygroundBindings, PlaygroundRequestMetadata } from "../runtime/context.server";
import { PlaygroundAiModel, PlaygroundAiModelLive } from "./model.server";

type GatewayRun = Parameters<CloudflareAiGateway["run"]>;

const responsesAnswer = {
	id: "resp_1",
	object: "response",
	created_at: 1,
	model: "gpt-6-luna",
	status: "completed",
	output: [
		{
			type: "message",
			id: "msg_1",
			role: "assistant",
			status: "completed",
			content: [{ type: "output_text", text: "Here it is.", annotations: [] }],
		},
	],
	usage: { input_tokens: 10, output_tokens: 3, total_tokens: 13 },
};

type GatewayCall = { gatewayId: string; data: GatewayRun[0]; options: GatewayRun[1] };

/** The Studio model over a fake gateway binding that records every call. */
function studioModel(runs: GatewayCall[]) {
	const ai = {
		gateway: (gatewayId: string): CloudflareAiGateway => ({
			getUrl: async () => "",
			run: async (data, options) => {
				runs.push({ gatewayId, data, options });
				return Response.json(responsesAnswer);
			},
		}),
	};
	return Effect.gen(function* () {
		return yield* (yield* PlaygroundAiModel).model;
	}).pipe(
		Effect.provide(PlaygroundAiModelLive),
		Effect.provideService(PlaygroundBindings, { AI: ai }),
		Effect.provideService(PlaygroundRequestMetadata, {
			attemptId: "attempt_1",
			method: "POST",
			origin: "https://studio.test",
			path: "/api/chat",
			request: new Request("https://studio.test/api/chat"),
			runId: "run_1",
			traceId: "trace_1",
		}),
	);
}

describe("Studio model", () => {
	it.effect("calls gpt-6-luna on OpenAI's Responses API through the gateway binding", () =>
		Effect.gen(function* () {
			const runs: GatewayCall[] = [];
			const model = yield* studioModel(runs);
			const result = yield* Effect.promise(() =>
				generateText({
					model,
					prompt: "Draw the release review.",
					temperature: 0.4,
					tools: {
						build_flowchart: tool({
							inputSchema: jsonSchema<{ title: string }>({
								type: "object",
								properties: { title: { type: "string" } },
							}),
						}),
					},
				}),
			);
			expect(result.text).toBe("Here it is.");
			expect(runs).toHaveLength(1);
			const [run] = runs;
			expect(run?.gatewayId).toBe("google-ai-studio");
			expect(run?.data).toMatchObject({ provider: "openai", endpoint: "responses" });
			expect(run?.data.query).toMatchObject({
				model: "gpt-6-luna",
				reasoning: { effort: "none" },
				parallel_tool_calls: false,
				store: false,
				temperature: 0.4,
			});
			expect(run?.options?.gateway).toEqual({
				collectLog: true,
				metadata: { sketchiSurface: "studio-agent", sketchiTraceId: "trace_1" },
				skipCache: true,
			});
		}),
	);

	it.effect("asks the gateway for a new answer each time the same message is sent", () =>
		Effect.gen(function* () {
			const runs: GatewayCall[] = [];
			const model = yield* studioModel(runs);
			for (const _ of [1, 2]) {
				yield* Effect.promise(() => generateText({ model, prompt: "Draw the release review." }));
			}
			expect(runs).toHaveLength(2);
			expect(runs[1]?.data.query).toEqual(runs[0]?.data.query);
			expect(runs.map((run) => run.options?.gateway?.skipCache)).toEqual([true, true]);
		}),
	);
});
