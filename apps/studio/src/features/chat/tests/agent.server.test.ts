import { describe, expect, it, vi } from "@effect/vitest";
import type { CloudflareAiGateway } from "@sketchi/cloudflare/ai-gateway";
import {
	ArtifactStorage,
	makeMemoryArtifactStorage,
	buildFlowchart,
	BuildRuntimeEnvironment,
	buildResponse,
} from "@sketchi/diagrams/build";
import { toCodeModeJsonSchema } from "@sketchi/diagrams/build/contract";
import { MAX_AGENT_STEPS, MAX_DIAGRAM_BUILD_ATTEMPTS } from "@sketchi/diagrams/build/policy";
import { families, familyForType } from "@sketchi/diagrams/family";
import { type BuildFlowchartResult } from "@sketchi/diagrams/families/flowchart/build";
import { type FlowchartDocument } from "@sketchi/diagrams/families/flowchart/document";
import { makeTelemetryTestSink, makeWorkersTelemetryLayer } from "@sketchi/observability";
import { Deferred, Duration, Effect, Exit, Layer, Schema, Scope, Stream } from "effect";
import { AgUiSchema, LanguageModel, Response as AiResponse } from "effect/ai";
import { TestClock } from "effect/testing";

import { runPlaygroundEffect } from "../../../server/runtime.server";
import { handleStudioAgentRequest } from "../agent.server";
import { toAgUiMessages, type ChatMessage } from "../chat-message";
import { PlaygroundAiModel, STUDIO_MODEL_IDLE_TIMEOUT } from "../model.server";
import { makeStudioFlowchartToolExecutor } from "../studio-build-policy.server";
import { attemptLimitIssue, turnAlreadyAcceptedIssue } from "../studio-build-tool.server";
import { MAX_CHAT_TOTAL_CHARACTERS, studioChatRequestMessages } from "../studio-chat-request";
import { STUDIO_RAN_OUT_REPLY } from "../studio-reply.server";

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
const toolEvents = (
	args: string,
	round: number,
	argumentsDone = true,
	name = "build_flowchart",
) => {
	const item = {
		type: "function_call",
		id: `item-${round}`,
		call_id: `call-${round}`,
		name,
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
async function runWire(respond: (round: number) => Response, content = "Draw a flowchart") {
	const calls: GatewayData[] = [];
	const { probe, sink } = makeTelemetryTestSink();
	const storage = makeMemoryArtifactStorage();
	const write = vi.fn(storage.write);
	const request = new Request("https://studio.test/api/studio/chat", {
		method: "POST",
		body: JSON.stringify({
			threadId: "studio",
			runId: "wire",
			messages: [{ id: "user", role: "user", content }],
		}),
	});
	const response = await runPlaygroundEffect(
		handleStudioAgentRequest(request).pipe(
			Effect.provideService(ArtifactStorage, { ...storage, write }),
			Effect.provide(makeWorkersTelemetryLayer({ resource: { serviceName: "studio-test" }, sink })),
		),
		{
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
		},
	);
	return { body: await response.text(), calls, write, probe };
}

function buildResults<A>(body: string, schema: Schema.Codec<A, unknown>) {
	return body
		.split("\n")
		.filter((line) => line.startsWith("data:"))
		.flatMap((line) => {
			const event = Schema.decodeUnknownSync(Schema.fromJsonString(AgUiSchema.Event))(
				line.slice(5),
			);
			return event.type === "TOOL_CALL_RESULT"
				? [Schema.decodeUnknownSync(Schema.fromJsonString(schema))(event.content)]
				: [];
		});
}

// The independent review's prepared inputs: neither passes the raw tool schema.
const orgChartShorthand = {
	spec: {
		title: "Engineering",
		employees: [
			{ id: "lead", name: "Engineering Lead" },
			{ id: "dev", name: "Developer", manager: "lead" },
		],
	},
	options: { artifactFormats: ["scene"], inlineArtifacts: ["scene"] },
};

it("shares invalid-input attempts across families and caps later prepared shorthand", async () => {
	const result = await runWire((round) =>
		wireResponse([
			...(round <= MAX_DIAGRAM_BUILD_ATTEMPTS
				? toolEvents(
						'{"spec":{"title":"Missing fields"}}',
						round,
						true,
						round === 2 ? "build_sequence_diagram" : "build_flowchart",
					)
				: round === MAX_DIAGRAM_BUILD_ATTEMPTS + 1
					? toolEvents(
							JSON.stringify(orgChartShorthand),
							round,
							true,
							familyForType("org-chart").docs.toolName,
						)
					: []),
			terminal(),
		]),
	);
	const results = buildResults(result.body, familyForType("org-chart").contracts.output);
	expect(results).toHaveLength(MAX_DIAGRAM_BUILD_ATTEMPTS + 1);
	expect(results.slice(0, MAX_DIAGRAM_BUILD_ATTEMPTS).map((result) => result.status)).toEqual(
		Array(MAX_DIAGRAM_BUILD_ATTEMPTS).fill("invalid_input"),
	);
	expect(results.at(-1)).toEqual({
		ok: false,
		status: "quality_failed",
		issues: [attemptLimitIssue],
	});
	expect(result.write).not.toHaveBeenCalled();
	expect(result.body).toContain("I couldn't save a diagram");
});

it("blocks another family's prepared build after one artifact is saved", async () => {
	const result = await runWire((round) =>
		wireResponse([
			...(round === 1
				? toolEvents(JSON.stringify({ spec }), round)
				: round === 2
					? toolEvents(
							JSON.stringify(orgChartShorthand),
							round,
							true,
							familyForType("org-chart").docs.toolName,
						)
					: []),
			terminal(),
		]),
	);
	const results = buildResults(
		result.body,
		Schema.Union([
			familyForType("flowchart").contracts.output,
			familyForType("org-chart").contracts.output,
		]),
	);
	expect(results[0]?.ok).toBe(true);
	expect(results[1]).toEqual({
		ok: false,
		status: "quality_failed",
		issues: [turnAlreadyAcceptedIssue],
	});
	expect(result.write).toHaveBeenCalledTimes(1);
});

it("suppresses a false saved reply after canonical input rejection without storing an artifact", async () => {
	const item = {
		type: "message",
		id: "text-1",
		role: "assistant",
		status: "completed",
		content: [],
	};
	const claim = "I saved your diagram successfully.";
	const result = await runWire((round) =>
		wireResponse([
			...(round === 1
				? toolEvents('{"spec":{"title":"Missing nodes"}}', round)
				: [
						{ type: "response.output_item.added", output_index: 0, item },
						{
							type: "response.output_text.delta",
							item_id: item.id,
							output_index: 0,
							content_index: 0,
							delta: claim,
						},
						{ type: "response.output_item.done", output_index: 0, item },
					]),
			terminal(),
		]),
	);
	const results = buildResults(result.body, familyForType("flowchart").contracts.output);
	expect(results).toHaveLength(1);
	expect(results[0]).toMatchObject({ ok: false, status: "invalid_input" });
	expect(results[0]).not.toHaveProperty("buildId");
	expect(result.write).not.toHaveBeenCalled();
	expect(result.body).not.toContain(claim);
	expect(result.body).toContain("I couldn't save a diagram");
	expect(result.body).toContain('"type":"RUN_FINISHED"');
});

it("bounds repeated invalid tool arguments by the native Chat step limit", async () => {
	const result = await runWire((round) =>
		wireResponse([...toolEvents('{"spec":{"title":"Missing nodes"}}', round), terminal()]),
	);
	expect(result.calls).toHaveLength(MAX_AGENT_STEPS);
	expect(result.body).not.toContain('"type":"RUN_ERROR"');
	expect(result.body.match(/"type":"TOOL_CALL_RESULT"/g)).toHaveLength(MAX_AGENT_STEPS);
	const results = buildResults(result.body, familyForType("flowchart").contracts.output);
	expect(results.filter((result) => result.status === "invalid_input")).toHaveLength(
		MAX_DIAGRAM_BUILD_ATTEMPTS,
	);
	expect(
		results
			.slice(MAX_DIAGRAM_BUILD_ATTEMPTS)
			.every((result) => result.issues[0]?.message === attemptLimitIssue.message),
	).toBe(true);
	expect(result.write).not.toHaveBeenCalled();
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
it.each(["request", "response body"])(
	"cancels the gateway stream through %s while awaiting the terminal reason (local cancellation only; deployed Stop is a Preview platform limitation)",
	async (boundary) => {
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
		const reader = response.body?.getReader();
		if (!reader) throw new Error("Expected the chat response stream.");
		const body = (async () => {
			while (!(await reader.read()).done) {
				// Consume the real handler's SSE until the test cancels it.
			}
		})();
		await Effect.runPromise(Deferred.await(read));
		if (boundary === "request") abort.abort();
		else await reader.cancel();
		await Effect.runPromise(Deferred.await(cancelled));
		await body;
		expect(signal?.aborted).toBe(true);
		expect(calls).toBe(1);
	},
);

it.each(["response headers", "the next event"])(
	"fails a model turn that stalls before %s, cancels the gateway, and lets each event reset the bound",
	async (stall) => {
		const scope = Effect.runSync(Scope.make());
		const clock = await Effect.runPromise(Layer.buildWithScope(TestClock.layer(), scope));
		const adjust = (duration: Duration.Input) =>
			Effect.runPromise(TestClock.adjust(duration).pipe(Effect.provide(clock)));
		const almost = Duration.subtract(STUDIO_MODEL_IDLE_TIMEOUT, Duration.seconds(1));
		const encoder = new TextEncoder();
		const requested = Deferred.makeUnsafe<void>();
		const cancelled = Deferred.makeUnsafe<void>();
		let push = (_value: unknown) => {};
		let signal: AbortSignal | undefined;
		let calls = 0;
		const request = new Request("https://studio.test/api/studio/chat", {
			method: "POST",
			body: JSON.stringify({
				threadId: "studio",
				runId: "stall",
				messages: [{ id: "u", role: "user", content: "Draw a flowchart" }],
			}),
		});
		const response = await runPlaygroundEffect(
			handleStudioAgentRequest(request).pipe(Effect.provide(clock)),
			{
				request,
				platform: { waitUntilPromise: () => undefined },
				env: {
					AI: {
						gateway: () => ({
							getUrl: async () => "",
							run: async (_data, options) => {
								calls++;
								signal = options?.signal;
								Effect.runSync(Deferred.succeed(requested, undefined));
								if (stall === "response headers") return new Promise<Response>(() => {});
								return new Response(
									new ReadableStream<Uint8Array>({
										start(controller) {
											push = (value) => controller.enqueue(encoder.encode(event(value)));
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
			},
		);
		const reader = response.body?.getReader();
		if (!reader) throw new Error("Expected the chat response stream.");
		const decoder = new TextDecoder();
		let body = "";
		let ended = false;
		let changed = () => {};
		const consumed = (async () => {
			for (let next = await reader.read(); !next.done; next = await reader.read()) {
				body += decoder.decode(next.value, { stream: true });
				changed();
			}
			ended = true;
			changed();
		})();
		const until = async (text: string) => {
			while (!body.includes(text)) {
				if (ended) throw new Error(`The stream ended before ${text}:\n${body}`);
				await new Promise<void>((resolve) => (changed = resolve));
			}
		};
		await Effect.runPromise(Deferred.await(requested));
		if (stall === "the next event") {
			const [added, ...rest] = toolEvents(partial, 1);
			push(added);
			await until('"type":"TOOL_CALL_START"');
			// Active events keep a turn alive past the bound in total.
			for (const delta of ["alpha", "bravo"]) {
				await adjust(almost);
				push({ ...rest[0], delta });
				await until(delta);
			}
			expect(body).not.toContain('"type":"RUN_ERROR"');
		}
		await adjust(STUDIO_MODEL_IDLE_TIMEOUT);
		await consumed;
		expect(body).toContain('"type":"RUN_ERROR"');
		expect(body).not.toContain('"type":"RUN_FINISHED"');
		expect(signal?.aborted).toBe(true);
		expect(calls).toBe(1);
		if (stall === "the next event") await Effect.runPromise(Deferred.await(cancelled));
		await Effect.runPromise(Scope.close(scope, Exit.void));
	},
);

const runInput = (messages: unknown) => ({ threadId: "studio", runId: "run-1", messages });
const usage = new AiResponse.Usage({ inputTokens: { total: 1 }, outputTokens: { total: 1 } });
const finish = (reason: AiResponse.FinishReason = "stop") =>
	AiResponse.makePart("finish", { reason, usage });
const answer = (text: string) => [
	AiResponse.makePart("text-start", { id: "t" }),
	AiResponse.makePart("text-delta", { id: "t", delta: text }),
	AiResponse.makePart("text-end", { id: "t" }),
	finish(),
];
async function mockModel(rounds: ReadonlyArray<ReadonlyArray<AiResponse.StreamPartEncoded>>) {
	const calls: LanguageModel.ProviderOptions[] = [];
	const model = await Effect.runPromise(
		LanguageModel.make({
			generateText: () => Effect.die("Unexpected generateText"),
			streamText: (options) => {
				calls.push(options);
				return Stream.fromIterable(rounds[calls.length - 1] ?? []);
			},
		}),
	);
	return { model, calls };
}

describe("chat request boundaries", () => {
	const message = {
		id: "user-1",
		role: "user",
		content: "Draw a flowchart",
	};
	function chat(body: unknown) {
		const request = new Request("https://studio.test/api/studio/chat", {
			method: "POST",
			body: JSON.stringify({ threadId: "studio", runId: "run-1", ...(body as object) }),
		});
		return runPlaygroundEffect(handleStudioAgentRequest(request), {
			env: {},
			platform: { waitUntilPromise: () => undefined },
			request,
		});
	}
	it("reports a missing AI binding as a static 503", async () => {
		const response = await chat({ messages: [message] });
		expect(response.status).toBe(503);
		expect(await response.text()).toBe("Chat is temporarily unavailable.");
	});
	it.each([
		{ messages: Array.from({ length: 65 }, () => message) },
		{
			messages: [{ ...message, content: "x".repeat(32_001) }],
		},
		{ messages: [message], extra: "x".repeat(128 * 1024) },
	])("rejects oversized chat input before AI configuration", async (body) => {
		expect((await chat(body)).status).toBe(413);
	});
	it("accepts the message-count and serialized character boundaries", async () => {
		expect((await chat({ messages: Array.from({ length: 64 }, () => message) })).status).toBe(503);
		const empty = [{ ...message, content: "" }];
		const text = "x".repeat(32_000 - JSON.stringify(empty).length);
		expect(
			(
				await chat({
					messages: [{ ...message, content: text }],
				})
			).status,
		).toBe(503);
	});
});

describe("Studio build results the model reads", () => {
	const spec = {
		title: "Release review",
		direction: "TB",
		nodes: { start: "Open release", review: "Approved?", ship: "Ship release", fix: "Fix release" },
		edges: [
			["start", "review"],
			["review", "ship", "yes"],
			["review", "fix", "no"],
			["fix", "review"],
		],
	};
	const build = (input: unknown) =>
		buildResponse(buildFlowchart(input)).pipe(
			Effect.provideService(ArtifactStorage, makeMemoryArtifactStorage()),
			Effect.provideService(BuildRuntimeEnvironment, {
				createId: (prefix) => `${prefix}_fixed`,
			}),
		);

	it("keeps the scene, its files and the normalized spec out of every model call", async () => {
		// The history a client replays carries an earlier build's full result, scene and all.
		const earlier: BuildFlowchartResult = await Effect.runPromise(build({ spec }));
		expect(JSON.stringify(earlier)).toContain('"elements"');
		const { model, calls } = await mockModel([
			[
				AiResponse.makePart("tool-call", {
					id: "call-2",
					name: "build_flowchart",
					providerExecuted: false,
					params: { spec: { ...spec, title: "Release review, revised" } },
				}),
				finish("tool-calls"),
			],
			answer("Updated."),
		]);
		const request = new Request("https://studio.test/api/studio/chat", {
			method: "POST",
			body: JSON.stringify(
				runInput(
					toAgUiMessages([
						{ id: "u1", role: "user", parts: [{ type: "text", text: "Draw the release review." }] },
						{
							id: "a1",
							role: "assistant",
							parts: [
								{
									type: "tool-build_flowchart",
									toolCallId: "call-1",
									state: "output-available",
									input: { spec },
									output: earlier,
								},
								{ type: "text", text: "Here it is." },
							],
						},
						{ id: "u2", role: "user", parts: [{ type: "text", text: "Retitle it." }] },
					]),
				),
			),
		});
		const response = await runPlaygroundEffect(
			handleStudioAgentRequest(request).pipe(
				Effect.provideService(PlaygroundAiModel, { model: Effect.succeed(model) }),
			),
			{ env: {}, platform: { waitUntilPromise: () => undefined }, request },
		);
		const body = await response.text();
		// The client still gets the scene.
		expect(body).toContain('\\"elements\\"');
		expect(calls).toHaveLength(2);
		const prompts = calls
			.flatMap((call) =>
				call.prompt.content.flatMap((message) =>
					message.role === "tool"
						? message.content.flatMap((part) =>
								part.type === "tool-result" ? part.modelOutput : [],
							)
						: [],
				),
			)
			.map((part) => (part?.type === "text" ? part.text : ""))
			.join("\n");
		for (const kept of ['"elements"', '"files"', '"inline"', "normalizedSpec", '"formats"'])
			expect(prompts).not.toContain(kept);
		expect(prompts).toContain('"artifactId":"artifact_fixed"');
		expect(prompts).toContain('"status":"accepted"');
	});

	it("keeps a long conversation on a large diagram within the request limits", async () => {
		const earlier: BuildFlowchartResult = await Effect.runPromise(build({ spec }));
		if (!earlier.ok) throw new Error("The release review should build.");
		// A large diagram: each accepted result carries a scene of about 16k characters.
		const large = {
			...earlier,
			artifact: {
				...earlier.artifact,
				formats: [{ format: "scene", inline: { elements: "x".repeat(16_000) } }],
			},
		};
		const messages: ChatMessage[] = [];
		for (let edit = 0; edit < 12; edit += 1) {
			messages.push({
				id: `u${edit}`,
				role: "user",
				parts: [{ type: "text", text: edit === 0 ? "Draw the release review." : `Edit ${edit}.` }],
			});
			messages.push({
				id: `a${edit}`,
				role: "assistant",
				parts: [
					{
						type: "tool-build_flowchart",
						toolCallId: `call-${edit}`,
						state: "output-available",
						input: { spec: { ...spec, title: `Release review ${edit}` } },
						output: large,
					},
					{ type: "text", text: "Updated." },
				],
			});
		}
		messages.push({ id: "u-last", role: "user", parts: [{ type: "text", text: "Retitle it." }] });
		expect(JSON.stringify(messages).length).toBeGreaterThan(MAX_CHAT_TOTAL_CHARACTERS);

		const { model, calls } = await mockModel([answer("Which title?")]);
		const request = new Request("https://studio.test/api/studio/chat", {
			method: "POST",
			body: JSON.stringify(runInput(toAgUiMessages(studioChatRequestMessages(messages)))),
		});
		const response = await runPlaygroundEffect(
			handleStudioAgentRequest(request).pipe(
				Effect.provideService(PlaygroundAiModel, { model: Effect.succeed(model) }),
			),
			{ env: {}, platform: { waitUntilPromise: () => undefined }, request },
		);
		expect(response.status).toBe(200);
		await response.text();
		const prompt = JSON.stringify(calls[0]?.prompt);
		expect(prompt).toContain("Release review 11");
		expect(prompt).toContain("Retitle it.");
	});

	it("keeps a saved diagram's logos when trimming drops the request that named them", async () => {
		const earlier: BuildFlowchartResult = await Effect.runPromise(build({ spec }));
		if (!earlier.ok) throw new Error("The release review should build.");
		const withLogos = {
			...earlier,
			normalizedSpec: {
				...earlier.normalizedSpec,
				logos: true,
				nodes: {
					errors: { label: "Sentry", icon: "sentry" },
					db: { label: "Postgres", icon: "postgresql" },
				},
			},
		};
		const messages: ChatMessage[] = [
			{
				id: "u0",
				role: "user",
				parts: [
					{ type: "text", text: "Draw our backend: Sentry tracks errors, Postgres stores orders." },
				],
			},
			{
				id: "a0",
				role: "assistant",
				parts: [
					{
						type: "tool-build_flowchart",
						toolCallId: "call-0",
						state: "output-available",
						input: { spec },
						output: withLogos,
					},
				],
			},
		];
		for (let turn = 1; turn < 10; turn += 1) {
			messages.push(
				{ id: `u${turn}`, role: "user", parts: [{ type: "text", text: `Question ${turn}?` }] },
				{ id: `a${turn}`, role: "assistant", parts: [{ type: "text", text: "w".repeat(4_000) }] },
			);
		}
		messages.push({ id: "u-last", role: "user", parts: [{ type: "text", text: "Retitle it." }] });
		const sent = studioChatRequestMessages(messages);
		expect(JSON.stringify(sent)).not.toContain("Draw our backend");

		const { model, calls } = await mockModel([answer("Which title?")]);
		const request = new Request("https://studio.test/api/studio/chat", {
			method: "POST",
			body: JSON.stringify(runInput(toAgUiMessages(sent))),
		});
		const response = await runPlaygroundEffect(
			handleStudioAgentRequest(request).pipe(
				Effect.provideService(PlaygroundAiModel, { model: Effect.succeed(model) }),
			),
			{ env: {}, platform: { waitUntilPromise: () => undefined }, request },
		);
		expect(response.status).toBe(200);
		await response.text();
		const prompt = JSON.stringify(calls[0]?.prompt);
		expect(prompt).toContain("NODE LOGOS");
		expect(prompt).toContain("sentry (Sentry)");
		expect(prompt).toContain("postgresql");
	});
});

function acceptedSpec(): FlowchartDocument {
	return {
		id: "release-review-loop",
		title: "Release review loop",
		direction: "TB",
		nodes: {
			start: "Open release",
			review: "Release ready?",
			publish: "Publish release",
			revise: "Revise release",
			done: "Release live",
		},
		edges: [
			["start", "review"],
			["review", "publish", "yes"],
			["review", "revise", "no"],
			["revise", "review"],
			["publish", "done"],
		],
	};
}

function countingStore() {
	const memory = makeMemoryArtifactStorage();
	const write = vi.fn(memory.write);
	return {
		store: { ...memory, write },
		writes: () => write.mock.calls.length,
	};
}

function deterministicRuntime(counted: ReturnType<typeof countingStore>) {
	return (input: unknown) =>
		buildResponse(buildFlowchart(input)).pipe(
			Effect.provideService(ArtifactStorage, counted.store),
			Effect.provideService(BuildRuntimeEnvironment, {
				createId: (prefix) => `${prefix}_fixed`,
			}),
		);
}

function deferred<T>() {
	let resolve: (value: T | PromiseLike<T>) => void = () => undefined;
	const promise = new Promise<T>((complete) => {
		resolve = complete;
	});
	return { promise, resolve };
}

describe("Studio build turn", () => {
	it("serializes concurrent accepted calls and persists only the first artifact", async () => {
		const counted = countingStore();
		const build = deterministicRuntime(counted);
		const started = deferred<void>();
		const release = deferred<void>();
		let runtimeCalls = 0;
		const executor = await Effect.runPromise(
			makeStudioFlowchartToolExecutor((input) =>
				Effect.sync(() => {
					runtimeCalls += 1;
					started.resolve(undefined);
				}).pipe(
					Effect.andThen(Effect.promise(() => release.promise)),
					Effect.andThen(build(input)),
				),
			),
		);

		const firstPromise = Effect.runPromise(
			executor.execute({
				requestId: "accepted-first",
				spec: acceptedSpec(),
			}),
		);
		const queuedPromise = Effect.runPromise(
			executor.execute({
				requestId: "accepted-queued",
				spec: acceptedSpec(),
			}),
		);

		await started.promise;
		expect(runtimeCalls).toBe(1);
		await expect(Effect.runPromise(executor.attempts)).resolves.toBe(1);
		expect(counted.writes()).toBe(0);

		release.resolve(undefined);
		const [first, queued] = await Promise.all([firstPromise, queuedPromise]);

		expect(first).toMatchObject({ ok: true, status: "accepted" });
		expect(queued).toBe(first);
		expect(runtimeCalls).toBe(1);
		await expect(Effect.runPromise(executor.attempts)).resolves.toBe(1);
		expect(counted.writes()).toBe(1);
	});
});
