import { Deferred, Effect, Schema } from "effect";
import { MAX_AGENT_STEPS } from "@sketchi/diagrams/build/policy";
import { STUDIO_RAN_OUT_REPLY } from "./studio-reply.server";
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

const terminal = (reason?: "max_output_tokens" | "content_filter") => ({
	type: reason ? "response.incomplete" : "response.completed",
	response: {
		id: "resp",
		created_at: 1,
		model: "gpt-6-luna",
		status: reason ? "incomplete" : "completed",
		...(reason ? { incomplete_details: { reason } } : {}),
		output: [],
		usage: { input_tokens: 1, output_tokens: 4096, total_tokens: 4097 },
	},
});
const toolEvents = (args: string, round: number, argumentsDone = true) => {
	const item = {
		type: "function_call",
		id: `item-${round}`,
		call_id: `call-${round}`,
		name: "build_flowchart",
		arguments: args,
		status: "incomplete",
	};
	return [
		{
			type: "response.output_item.added",
			output_index: 0,
			item: { ...item, status: "in_progress", arguments: "" },
		},
		{
			type: "response.function_call_arguments.delta",
			item_id: item.id,
			output_index: 0,
			delta: args,
		},
		...(argumentsDone
			? [
					{
						type: "response.function_call_arguments.done",
						item_id: item.id,
						output_index: 0,
						arguments: args,
					},
				]
			: []),
		{ type: "response.output_item.done", output_index: 0, item },
	];
};
const wireResponse = (events: unknown[]) =>
	new Response(events.map(event).join(""), {
		headers: { "content-type": "text/event-stream" },
	});
async function runWire(respond: (round: number) => Response) {
	const calls: GatewayData[] = [];
	const request = new Request("https://studio.test/api/studio/chat", {
		method: "POST",
		body: JSON.stringify({
			threadId: "studio",
			runId: "wire",
			messages: [{ id: "user", role: "user", content: "Draw a flowchart" }],
		}),
	});
	const response = await runPlaygroundEffect(handleStudioAgentRequest(request), {
		request,
		platform: { waitUntilPromise: () => undefined },
		env: {
			AI: {
				gateway: () => ({
					getUrl: async () => "",
					run: async (data) => {
						calls.push(data);
						return respond(calls.length);
					},
				}),
			},
		},
	});
	return { body: await response.text(), calls };
}
it.each([
	[{ title: "Missing nodes" }, "spec.nodes"],
	[{ ...spec, direction: "diagonal" }, "spec.direction"],
])("returns canonical invalid input and lets Chat repair it: %j", async (bad, path) => {
	const result = await runWire((round) =>
		wireResponse([
			...(round < 3 ? toolEvents(JSON.stringify({ spec: round === 1 ? bad : spec }), round) : []),
			terminal(),
		]),
	);
	expect(result.body).not.toContain('"type":"RUN_ERROR"');
	expect(result.body).toContain('"type":"TOOL_CALL_RESULT"');
	expect(result.calls).toHaveLength(3);
	const repair = JSON.stringify(result.calls[1]?.query);
	expect(repair).toContain("invalid_input");
	expect(repair).toContain(path);
	expect(repair).toMatch(/Repair|schema/);
	expect(JSON.stringify(result.calls[2]?.query)).toContain("accepted");
});
it("bounds repeated invalid tool arguments by the native Chat step limit", async () => {
	const result = await runWire((round) =>
		wireResponse([...toolEvents('{"spec":{"title":"Missing nodes"}}', round), terminal()]),
	);
	expect(result.calls).toHaveLength(MAX_AGENT_STEPS);
	expect(result.body).not.toContain('"type":"RUN_ERROR"');
	expect(result.body.match(/"type":"TOOL_CALL_RESULT"/g)).toHaveLength(MAX_AGENT_STEPS);
});
const partial = '{"spec":{"title":"Review","nodes":{"a":"Open';
it.each([true, false])(
	"retries a truncated output-limit call once (arguments.done=%s)",
	async (argumentsDone) => {
		const result = await runWire((round) =>
			wireResponse(
				round === 1
					? [...toolEvents(partial, round, argumentsDone), terminal("max_output_tokens")]
					: [terminal()],
			),
		);
		expect(result.calls).toHaveLength(2);
		expect(result.body).not.toContain('"type":"RUN_ERROR"');
		expect(result.body).not.toContain('"type":"TOOL_CALL_RESULT"');
		expect(result.body).not.toContain(STUDIO_RAN_OUT_REPLY);
		expect(result.body).toContain('"type":"RUN_FINISHED"');
		// An unfinished call must not be replayed as an executable call on the retry.
		expect(JSON.stringify(result.calls[1]?.query)).not.toContain("call-1");
	},
);
it("explains exhaustion after the second truncated output-limit call", async () => {
	const result = await runWire((round) =>
		wireResponse([...toolEvents(partial, round), terminal("max_output_tokens")]),
	);
	expect(result.calls).toHaveLength(2);
	expect(result.body).toContain(STUDIO_RAN_OUT_REPLY);
	expect(result.body).not.toContain('"type":"RUN_ERROR"');
	expect(result.body).not.toContain('"type":"TOOL_CALL_RESULT"');
});
it.each(["completed", "content_filter", "eof"] as const)(
	"keeps malformed arguments a terminal error after %s",
	async (finish) => {
		const result = await runWire((round) =>
			wireResponse([
				...toolEvents(partial, round),
				...(finish === "eof" ? [] : [terminal(finish === "content_filter" ? finish : undefined)]),
			]),
		);
		expect(result.calls).toHaveLength(1);
		expect(result.body).toContain('"type":"RUN_ERROR"');
		expect(result.body).not.toContain(STUDIO_RAN_OUT_REPLY);
	},
);
it("keeps secure JSON rejection on the native parser even with an output limit", async () => {
	const result = await runWire((round) =>
		wireResponse([
			...toolEvents('{"__proto__":{"polluted":true}}', round),
			terminal("max_output_tokens"),
		]),
	);
	expect(result.calls).toHaveLength(1);
	expect(result.body).toContain('"type":"RUN_ERROR"');
});
it("cancels the gateway stream while a malformed completion awaits its terminal reason", async () => {
	const read = Deferred.makeUnsafe<void>();
	const cancelled = Deferred.makeUnsafe<void>();
	const abort = new AbortController();
	let signal: AbortSignal | undefined;
	let calls = 0;
	const request = new Request("https://studio.test/api/studio/chat", {
		method: "POST",
		signal: abort.signal,
		body: JSON.stringify({
			threadId: "studio",
			runId: "cancel",
			messages: [{ id: "u", role: "user", content: "Draw a flowchart" }],
		}),
	});
	const response = await runPlaygroundEffect(handleStudioAgentRequest(request), {
		request,
		platform: { waitUntilPromise: () => undefined },
		env: {
			AI: {
				gateway: () => ({
					getUrl: async () => "",
					run: async (_data, options) => {
						calls++;
						signal = options?.signal;
						const events = toolEvents(partial, 1).map(event);
						return new Response(
							new ReadableStream<Uint8Array>({
								pull(controller) {
									const next = events.shift();
									if (next) controller.enqueue(new TextEncoder().encode(next));
									else {
										Effect.runSync(Deferred.succeed(read, undefined));
										return new Promise<void>(() => {});
									}
								},
								cancel() {
									Effect.runSync(Deferred.succeed(cancelled, undefined));
								},
							}),
							{ headers: { "content-type": "text/event-stream" } },
						);
					},
				}),
			},
		},
	});
	const body = response.text();
	await Effect.runPromise(Deferred.await(read));
	abort.abort();
	await Effect.runPromise(Deferred.await(cancelled));
	await body;
	expect(signal?.aborted).toBe(true);
	expect(calls).toBe(1);
});

it("keeps text after truncated arguments and does not classify it as empty output", async () => {
	const item = {
		type: "message",
		id: "text-1",
		role: "assistant",
		status: "incomplete",
		content: [],
	};
	const result = await runWire((round) =>
		wireResponse([
			...toolEvents(partial, round),
			{ type: "response.output_item.added", output_index: 1, item },
			{
				type: "response.output_text.delta",
				item_id: item.id,
				output_index: 1,
				content_index: 0,
				delta: "Partial explanation.",
			},
			{ type: "response.output_item.done", output_index: 1, item },
			terminal("max_output_tokens"),
		]),
	);
	expect(result.calls).toHaveLength(1);
	expect(result.body).toContain("Partial explanation.");
	expect(result.body).not.toContain(STUDIO_RAN_OUT_REPLY);
	expect(result.body).not.toContain('"type":"RUN_ERROR"');
});
it("preserves failure ordering before a subsequent valid completion when the response completes", async () => {
	const [added, delta, done] = toolEvents(partial, 1);
	const finalItem = {
		type: "function_call",
		id: "item-1",
		call_id: "call-1",
		name: "build_flowchart",
		arguments: JSON.stringify({ spec }),
		status: "completed",
	};
	const result = await runWire(() =>
		wireResponse([
			added,
			delta,
			done,
			{ type: "response.output_item.done", output_index: 0, item: finalItem },
			terminal(),
		]),
	);
	expect(result.calls).toHaveLength(1);
	expect(result.body).toContain('"type":"RUN_ERROR"');
	expect(result.body).not.toContain('"type":"TOOL_CALL_RESULT"');
});
