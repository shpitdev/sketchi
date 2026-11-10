import { describe, expect, it } from "@effect/vitest";
import { convertArrayToReadableStream, MockLanguageModelV4 } from "ai/test";
import { Effect, Option } from "effect";

import {
	buildFlowchart,
	CodeModeArtifactStorage,
	CodeModeRuntimeEnvironment,
	makeMemoryArtifactStorage,
	type BuildFlowchartResult,
} from "@sketchi/diagram-agent";

import { PlaygroundAiModel } from "../ai/model.server";
import { PlaygroundCodeMode, type PlaygroundCodeModeShape } from "../codemode/service.server";

import { PlaygroundRequestMetadata } from "../runtime/context.server";
import { PlaygroundRequestCallbacks, runPlaygroundEffect } from "../runtime/runtime.server";
import { handleStudioAgentRequest, makeStudioBuildToolCallback } from "./agent.server";

const repairResult: BuildFlowchartResult = {
	ok: false,
	status: "invalid_input",
	issues: [],
};

describe("Studio agent request callbacks", () => {
	it("preserves the chat request trace in the build_flowchart callback", async () => {
		let callbackContext:
			| {
					parentSpanId: string | undefined;
					spanId: string;
					spanName: string;
					spanTraceId: string;
					traceId: string;
			  }
			| undefined;
		const observeContext = Effect.gen(function* () {
			const metadata = yield* PlaygroundRequestMetadata;
			const span = yield* Effect.currentSpan;
			const parent = Option.getOrUndefined(span.parent);
			return {
				parentSpanId: parent?.spanId,
				spanName: span.name,
				spanId: span.spanId,
				spanTraceId: span.traceId,
				traceId: metadata.traceId,
			};
		});
		const request = new Request("https://studio.test/api/chat", {
			headers: { "x-sketchi-trace-id": "trace-chat-tool" },
			method: "POST",
		});

		const root = await runPlaygroundEffect(
			Effect.gen(function* () {
				const callbacks = yield* PlaygroundRequestCallbacks;
				const requestContext = yield* observeContext;
				const execute = makeStudioBuildToolCallback(
					{
						execute: () =>
							observeContext.pipe(
								Effect.tap((context) =>
									Effect.sync(() => {
										callbackContext = context;
									}),
								),
								Effect.as(repairResult),
							),
					},
					callbacks.runPromise,
				);
				return {
					callback: execute({
						spec: {
							title: "Trace context",
							direction: "TB",
							nodes: {
								start: "Start",
								done: "Done",
							},
							edges: [["start", "done"]],
						},
					}),
					requestContext,
				};
			}),
			{
				env: {},
				platform: { waitUntilPromise: () => undefined },
				request,
			},
		);

		await root.callback;
		expect(callbackContext?.spanTraceId).toBe(root.requestContext.spanTraceId);
		expect(callbackContext?.parentSpanId).toBe(root.requestContext.spanId);
		expect(callbackContext?.spanName).toBe("playground.request.callback");
		expect(callbackContext?.traceId).toBe("trace-chat-tool");
	});
});

describe("chat request boundaries", () => {
	const message = {
		id: "user-1",
		role: "user",
		parts: [{ type: "text", text: "Draw a flowchart" }],
	};
	function chat(body: unknown) {
		const request = new Request("https://studio.test/api/chat", {
			method: "POST",
			body: JSON.stringify(body),
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
			messages: [{ ...message, parts: [{ type: "text", text: "x".repeat(32_001) }] }],
		},
		{ messages: [message], extra: "x".repeat(128 * 1024) },
	])("rejects oversized chat input before AI configuration", async (body) => {
		expect((await chat(body)).status).toBe(413);
	});
	it("accepts the message-count and serialized character boundaries", async () => {
		expect((await chat({ messages: Array.from({ length: 64 }, () => message) })).status).toBe(503);
		const empty = [{ ...message, parts: [{ type: "text", text: "" }] }];
		const text = "x".repeat(32_000 - JSON.stringify(empty).length);
		expect(
			(
				await chat({
					messages: [{ ...message, parts: [{ type: "text", text }] }],
				})
			).status,
		).toBe(503);
	});
	it("maps a failed chat body stream at the HTTP runtime edge", async () => {
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.error(new Error("private body failure"));
			},
		});
		const init: RequestInit & { duplex: "half" } = {
			method: "POST",
			body: stream,
			duplex: "half",
		};
		const request = new Request("https://studio.test/api/chat", init);
		const response = await runPlaygroundEffect(handleStudioAgentRequest(request), {
			env: {},
			platform: { waitUntilPromise: () => undefined },
			request,
		});
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			ok: false,
			error: "The request body could not be read.",
		});
	});
	it("rejects invalid message structure", async () => {
		expect((await chat({ messages: [{ role: "not-a-role", parts: [] }] })).status).toBe(400);
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
		buildFlowchart(input).pipe(
			Effect.provideService(CodeModeArtifactStorage, makeMemoryArtifactStorage()),
			Effect.provideService(CodeModeRuntimeEnvironment, {
				createId: (prefix) => `${prefix}_fixed`,
			}),
		);
	type StreamResult = Awaited<ReturnType<MockLanguageModelV4["doStream"]>>;
	type StreamPart = StreamResult["stream"] extends ReadableStream<infer Part> ? Part : never;
	const step = (parts: StreamPart[]): StreamResult => ({
		stream: convertArrayToReadableStream(parts),
	});
	const usage = {
		inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
		outputTokens: { total: 1, text: 1, reasoning: undefined },
	};

	it("keeps the scene, its files and the normalized spec out of every model call", async () => {
		// The history a client replays carries an earlier build's full result, scene and all.
		const earlier: BuildFlowchartResult = await Effect.runPromise(build({ spec }));
		expect(JSON.stringify(earlier)).toContain('"elements"');
		const model = new MockLanguageModelV4({
			doStream: [
				step([
					{ type: "stream-start", warnings: [] },
					{
						type: "tool-call",
						toolCallId: "call-2",
						toolName: "build_flowchart",
						input: JSON.stringify({ spec: { ...spec, title: "Release review, revised" } }),
					},
					{ type: "finish", usage, finishReason: { unified: "tool-calls", raw: undefined } },
				]),
				step([
					{ type: "stream-start", warnings: [] },
					{ type: "text-start", id: "t" },
					{ type: "text-delta", id: "t", delta: "Updated." },
					{ type: "text-end", id: "t" },
					{ type: "finish", usage, finishReason: { unified: "stop", raw: undefined } },
				]),
			],
		});
		const codeMode = { buildFlowchart: build } as unknown as PlaygroundCodeModeShape;
		const request = new Request("https://studio.test/api/chat", {
			method: "POST",
			body: JSON.stringify({
				messages: [
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
				],
			}),
		});
		const response = await runPlaygroundEffect(
			handleStudioAgentRequest(request).pipe(
				Effect.provideService(PlaygroundAiModel, { model: Effect.succeed(model) }),
				Effect.provideService(PlaygroundCodeMode, codeMode),
			),
			{ env: {}, platform: { waitUntilPromise: () => undefined }, request },
		);
		const body = await response.text();
		// The client still gets the scene.
		expect(body).toContain('"elements"');
		expect(model.doStreamCalls).toHaveLength(2);
		const prompts = JSON.stringify(model.doStreamCalls.map((call) => call.prompt));
		for (const kept of ['"elements"', '"files"', '"inline"', "normalizedSpec", '"formats"'])
			expect(prompts).not.toContain(kept);
		expect(prompts).toContain('"artifactId":"artifact_fixed"');
		expect(prompts).toContain('"status":"accepted"');
	});
});
