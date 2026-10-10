import { describe, expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";

import type { BuildFlowchartResult } from "@sketchi/diagram-agent";

import { PlaygroundRequestMetadata } from "../runtime/context.server";
import { PlaygroundRequestCallbacks, runPlaygroundEffect } from "../runtime/runtime.server";
import { handleStudioAgentRequest, makeStudioFlowchartToolCallback } from "./agent.server";

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
				const execute = makeStudioFlowchartToolCallback(
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
							nodes: [
								{ id: "start", kind: "start", label: "Start" },
								{ id: "done", kind: "end", label: "Done" },
							],
							edges: [{ source: "start", target: "done" }],
							layout: { direction: "TB" },
							style: {
								accentColor: "#2563eb",
								backgroundColor: "#ffffff",
							},
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
