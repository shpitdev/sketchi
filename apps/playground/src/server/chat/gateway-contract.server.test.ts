import { Schema } from "effect";
import { it, expect } from "@effect/vitest";
import { families } from "@sketchi/diagrams/family";
import { toCodeModeJsonSchema } from "@sketchi/diagrams/build/code-mode/contract";
import type { CloudflareAiGateway } from "@sketchi/cloudflare/ai-gateway";
import { handleStudioAgentRequest } from "./agent.server";
import { runPlaygroundEffect } from "../runtime/runtime.server";

type GatewayData = Parameters<CloudflareAiGateway["run"]>[0];
const spec = { title: "Review", nodes: { start: "Open", end: "Done" }, edges: [["start", "end"]] };
const event = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
it("keeps the gateway settings, all family contracts and compact build results on the real handler/provider path", async () => {
	const calls: GatewayData[] = [];
	const gateway: CloudflareAiGateway = {
		getUrl: async () => "",
		run: async (data, options) => {
			calls.push(data);
			expect(options?.gateway).toEqual({
				collectLog: true,
				skipCache: true,
				metadata: { sketchiSurface: "studio-agent", sketchiTraceId: "trace-wire" },
			});
			const tool = {
				type: "function_call",
				id: "item-build",
				call_id: "call-build",
				name: "build_flowchart",
				arguments: JSON.stringify({ spec }),
			};
			const response = {
				id: "resp_1",
				created_at: 1,
				model: "gpt-6-luna",
				status: "completed",
				output: calls.length === 1 ? [tool] : [],
				usage: { input_tokens: 1, output_tokens: 0, total_tokens: 1 },
			};
			return new Response(
				(calls.length === 1
					? event({
							type: "response.output_item.added",
							output_index: 0,
							item: { ...tool, arguments: "" },
						}) +
						event({
							type: "response.function_call_arguments.delta",
							item_id: tool.id,
							output_index: 0,
							delta: tool.arguments,
						}) +
						event({ type: "response.output_item.done", output_index: 0, item: tool })
					: "") + event({ type: "response.completed", response }),
				{ headers: { "content-type": "text/event-stream" } },
			);
		},
	};
	const request = new Request("https://studio.test/api/studio/chat", {
		method: "POST",
		headers: { "x-sketchi-trace-id": "trace-wire" },
		body: JSON.stringify({
			threadId: "studio",
			runId: "run-wire",
			messages: [{ id: "u1", role: "user", content: "Draw the release review." }],
		}),
	});
	const response = await runPlaygroundEffect(handleStudioAgentRequest(request), {
		request,
		env: { AI: { gateway: () => gateway } },
		platform: { waitUntilPromise: () => undefined },
	});
	const body = await response.text();
	expect(response.status).toBe(200);
	expect(body).not.toContain('"type":"RUN_ERROR"');
	expect(body).toContain('\\"elements\\"');
	expect(calls).toHaveLength(2);
	expect(calls[0]).toMatchObject({
		provider: "openai",
		endpoint: "responses",
		query: {
			model: "gpt-6-luna",
			temperature: 0.4,
			max_output_tokens: 4096,
			reasoning: { effort: "none" },
			store: false,
			parallel_tool_calls: false,
			tool_choice: "auto",
			stream: true,
			include: ["reasoning.encrypted_content"],
		},
	});
	const expected = [...families]
		.sort((a, b) => a.docs.studioOrder - b.docs.studioOrder)
		.map((family) => ({
			type: "function",
			name: family.docs.toolName,
			description: family.docs.toolDescription,
			strict: false,
			parameters: toCodeModeJsonSchema(family.studioInput),
		}));
	const first = Schema.decodeUnknownSync(Schema.Struct({ tools: Schema.Unknown }))(calls[0]?.query);
	expect(first.tools).toEqual(expected);
	const next = JSON.stringify(
		Schema.decodeUnknownSync(Schema.Struct({ input: Schema.Unknown }))(calls[1]?.query).input,
	);
	for (const heavy of ['\\"elements\\"', '\\"normalizedSpec\\"', '\\"formats\\"', '\\"inline\\"'])
		expect(next).not.toContain(heavy);
	expect(next).toContain("function_call_output");
	expect(next).toContain("artifactId");
});
