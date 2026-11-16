import { Deferred, Effect, Schema } from "effect";
import { MAX_AGENT_STEPS, MAX_DIAGRAM_BUILD_ATTEMPTS } from "@sketchi/diagrams/build/policy";
import { STUDIO_RAN_OUT_REPLY } from "./studio-reply.server";
import { it, expect, vi } from "@effect/vitest";
import { makeTelemetryTestSink, makeWorkersTelemetryLayer } from "@sketchi/observability";
import { AgUiSchema } from "effect/ai";
import { families, familyForType } from "@sketchi/diagrams/family";
import {
	CodeModeArtifactStorage,
	makeMemoryArtifactStorage,
} from "@sketchi/diagrams/build/code-mode/artifacts";
import { attemptLimitIssue, turnAlreadyAcceptedIssue } from "./studio-build-tool.server";
import { STUDIO_COVERAGE_HINT } from "./studio-build-policy.server";
import { toCodeModeJsonSchema } from "@sketchi/diagrams/build/code-mode/contract";
import type { CloudflareAiGateway } from "@sketchi/cloudflare/ai-gateway";
import { handleStudioAgentRequest } from "./agent.server";
import { runPlaygroundEffect } from "../../server/runtime/runtime.server";

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
			Effect.provideService(CodeModeArtifactStorage, { ...storage, write }),
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

it.each([
	{ name: "decode rejection", input: { title: "Missing nodes" }, accepted: false },
	{ name: "valid success", input: spec, accepted: true },
])(
	"records one correlated build outcome for $name on the real handler",
	async ({ input, accepted }) => {
		const requestId = "studio-build-telemetry";
		const { body, probe, write } = await runWire((round) =>
			wireResponse([
				...(round === 1 ? toolEvents(JSON.stringify({ requestId, spec: input }), round) : []),
				terminal(),
			]),
		);
		const results = buildResults(body, familyForType("flowchart").contracts.output);
		expect(results).toHaveLength(1);
		expect(results[0]).toMatchObject({
			ok: accepted,
			status: accepted ? "accepted" : "invalid_input",
		});
		if (!accepted) {
			expect(results[0]?.issues).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ stage: "input", hint: expect.any(String) }),
				]),
			);
		}
		expect(write).toHaveBeenCalledTimes(accepted ? 1 : 0);
		const metrics = probe.metrics.filter(
			(metric) => metric.attributes.operation === "buildFlowchart",
		);
		const requests = metrics.filter((metric) => metric.metric === "sketchi_codemode_requests");
		expect(requests).toHaveLength(1);
		expect(requests[0]).toMatchObject({
			value: 1,
			attributes: { outcome: accepted ? "success" : "failure" },
		});
		const durations = metrics.filter((metric) => metric.metric === "sketchi_codemode_duration_ms");
		expect(durations).toHaveLength(1);
		expect(durations[0]?.value).toBeGreaterThanOrEqual(0);
		const failures = metrics.filter((metric) => metric.metric === "sketchi_codemode_failures");
		expect(failures).toHaveLength(accepted ? 0 : 1);
		if (!accepted)
			expect(failures[0]).toMatchObject({
				value: 1,
				attributes: { failure_category: "invalid_input" },
			});
		expect(metrics.filter((metric) => metric.metric === "sketchi_codemode_artifacts")).toHaveLength(
			accepted ? 1 : 0,
		);
		const decodes = probe.spans.filter((span) => span.name === "flowchart.decodeRequest");
		expect(decodes.length).toBeGreaterThan(0);
		for (const span of decodes) expect(span.attributes["sketchi.request_id"]).toBe(requestId);
		if (!accepted) {
			expect(probe.spans.some((span) => span.name === "flowchart.render")).toBe(false);
			expect(probe.spans.some((span) => span.name === "codeMode.artifacts.exportAndStore")).toBe(
				false,
			);
		}
	},
);

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
const erShorthand = {
	spec: {
		title: "Customer orders",
		entities: [
			{ id: "customers", fields: ["id uuid PK"] },
			{ id: "orders", fields: ["id uuid PK", "customer_id uuid FK"] },
		],
		relationships: [{ source: "customers.id", target: "orders.customer_id", cardinality: "1:N" }],
	},
};
it.each([
	{ family: familyForType("org-chart"), input: orgChartShorthand },
	{ family: familyForType("er"), input: erShorthand },
])("prepares $family.type shorthand inside the one-save turn guard", async ({ family, input }) => {
	expect(Schema.is(family.studioInput)(input)).toBe(false);
	const result = await runWire((round) =>
		wireResponse([
			...(round <= 4 ? toolEvents(JSON.stringify(input), round, true, family.docs.toolName) : []),
			terminal(),
		]),
	);
	const results = buildResults(
		result.body,
		Schema.Union([
			familyForType("org-chart").contracts.output,
			familyForType("er").contracts.output,
		]),
	);
	expect(result.body).not.toContain('"type":"RUN_ERROR"');
	expect(results).toHaveLength(4);
	const first = results[0];
	expect(first?.ok).toBe(true);
	if (!first?.ok) throw new Error("Prepared shorthand should build.");
	expect(results).toEqual([first, first, first, first]);
	expect(result.write).toHaveBeenCalledTimes(1);
	expect(first.artifact.formats).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ format: "scene", inline: expect.anything() }),
			expect.objectContaining({ format: "excalidraw" }),
		]),
	);
});

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

it("grounds canonical prepared input and applies the user's coverage and Studio artifact options", async () => {
	const input = {
		spec: {
			...spec,
			request: "Draw a flowchart",
			nodes: { ...spec.nodes, start: { label: "Open", icon: "aws" } },
		},
		options: { artifactFormats: ["scene"], inlineArtifacts: [] },
	};
	const result = await runWire(
		(round) =>
			wireResponse([...(round === 1 ? toolEvents(JSON.stringify(input), round) : []), terminal()]),
		'Draw a flowchart ending at "Release shipped".',
	);
	const [built] = buildResults(result.body, familyForType("flowchart").contracts.output);
	expect(built?.ok).toBe(true);
	if (!built?.ok) throw new Error("Prepared flowchart should build.");
	expect(built.normalizedSpec.nodes.start).not.toHaveProperty("icon");
	expect(built.issues).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				code: "unknown_icon",
				ref: { kind: "node", id: "start", path: "nodes.start.icon" },
			}),
			expect.objectContaining({
				code: "quoted_text_missing",
				stage: "coverage",
				hint: STUDIO_COVERAGE_HINT,
			}),
		]),
	);
	expect(built.artifact.formats).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ format: "scene", inline: expect.anything() }),
			expect.objectContaining({ format: "excalidraw" }),
		]),
	);
	expect(result.write).toHaveBeenCalledTimes(1);
});
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
	expect(result.write).toHaveBeenCalledTimes(1);
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
it.each(["request", "response body"])(
	"cancels the gateway stream through %s while awaiting the terminal reason",
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

it.each([
	"I’ll sketch Meridian Infrastructure’s complete reporting tree, preserving each person’s full name, title, department, and manager exactly as provided.",
	"I saved your diagram successfully.",
])("explains a length finish with unfinished tool arguments instead of %s", async (preamble) => {
	const item = {
		type: "message",
		id: "text-1",
		role: "assistant",
		status: "completed",
		content: [],
	};
	const result = await runWire((round) =>
		wireResponse([
			{ type: "response.output_item.added", output_index: 0, item },
			{
				type: "response.output_text.delta",
				item_id: item.id,
				output_index: 0,
				content_index: 0,
				delta: preamble,
			},
			{ type: "response.output_item.done", output_index: 0, item },
			...toolEvents(
				'{"spec":{"title":"Meridian Infrastructure","people":[{"id":"e000","name":"Employee',
				round,
				true,
				"build_org_chart",
			).map((part) => ({ ...part, output_index: 1 })),
			terminal("max_output_tokens"),
		]),
	);
	expect(result.calls).toHaveLength(1);
	expect(result.body).not.toContain(preamble);
	expect(result.body).toContain(STUDIO_RAN_OUT_REPLY);
	expect(result.body).not.toContain('"type":"RUN_ERROR"');
	expect(result.body).not.toContain('"type":"TOOL_CALL_RESULT"');
	expect(result.body).toContain('"type":"RUN_FINISHED"');
	expect(result.write).not.toHaveBeenCalled();
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
