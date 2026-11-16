import { Layer } from "effect";
import { AgUi, type AgUiSchema } from "effect/ai";
import { FetchHttpClient } from "effect/http";
import { AtomRegistry } from "effect/reactivity";
import { afterEach, describe, expect, it } from "vitest";
import { makeStudioChat, type StudioChatState } from "./chat-client";
import { chatMessageViews, toAgUiMessages } from "./chat-message";
import { deriveBuildState } from "./build-result";

const disposers: Array<() => void> = [];
afterEach(() => {
	for (const dispose of disposers.splice(0)) dispose();
});
const encode = (event: AgUiSchema.Event) =>
	new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
function harness(respond: (body: AgUiSchema.RunAgentInput, init: RequestInit) => Response) {
	const requests: AgUiSchema.RunAgentInput[] = [];
	const fetcher: typeof fetch = async (_url, init) => {
		if (!init) throw new Error("Expected request options");
		const body: AgUiSchema.RunAgentInput = JSON.parse(
			new TextDecoder().decode(init.body as Uint8Array),
		);
		requests.push(body);
		return respond(body, init);
	};
	const chat = makeStudioChat(
		FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetcher))),
	);
	const registry = AtomRegistry.make();
	registry.mount(chat.state);
	registry.mount(chat.send);
	disposers.push(() => registry.dispose());
	const state = () => registry.get(chat.state);
	const until = (test: (state: StudioChatState) => boolean) =>
		new Promise<StudioChatState>((resolve) => {
			let off = () => {};
			const check = (value: StudioChatState) => {
				if (test(value)) {
					off();
					resolve(value);
				}
			};
			off = registry.subscribe(chat.state, check);
			check(state());
		});
	return {
		requests,
		state,
		until,
		send: (text: string) => registry.set(chat.send, text),
		retry: () => registry.set(chat.send, { retry: true }),
		stop: () => registry.set(chat.stop, undefined),
	};
}
function streamResponse(events: ReadonlyArray<AgUiSchema.Event>) {
	return new Response(
		new ReadableStream({
			start(controller) {
				for (const event of events) controller.enqueue(encode(event));
				controller.close();
			},
		}),
		{ headers: { "content-type": "text/event-stream" } },
	);
}
const start = (runId: string): AgUiSchema.Event => ({
	type: "RUN_STARTED",
	threadId: "studio",
	runId,
});
const end = (runId: string): AgUiSchema.Event => ({
	type: "RUN_FINISHED",
	threadId: "studio",
	runId,
});
const text: AgUiSchema.Event[] = [
	{ type: "TEXT_MESSAGE_START", messageId: "answer", role: "assistant" },
	{ type: "TEXT_MESSAGE_CONTENT", messageId: "answer", delta: "Which title?" },
	{ type: "TEXT_MESSAGE_END", messageId: "answer" },
];

describe("Studio native chat atoms", () => {
	it("projects partial arguments, reasoning and a failed tool result and replays the failure", async () => {
		let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
		const chat = harness(
			(body) =>
				new Response(
					new ReadableStream({
						start(value) {
							controller = value;
							value.enqueue(encode(start(body.runId)));
						},
					}),
					{ headers: { "content-type": "text/event-stream" } },
				),
		);
		chat.send("Draw a flowchart");
		await chat.until((state) => state.status === "streaming");
		const push = (event: AgUiSchema.Event) => controller?.enqueue(encode(event));
		push({ type: "REASONING_MESSAGE_START", messageId: "reason", role: "reasoning" });
		push({ type: "REASONING_MESSAGE_CONTENT", messageId: "reason", delta: "Checking the request" });
		push({ type: "REASONING_MESSAGE_END", messageId: "reason" });
		push({ type: "TOOL_CALL_START", toolCallId: "build", toolCallName: "build_flowchart" });
		push({
			type: "TOOL_CALL_ARGS",
			toolCallId: "build",
			delta:
				'{"spec":{"title":"Review","edges":[["a","b"]],"nodes":{"a":"Open review","b":"Approve',
		});
		const partial = await chat.until(
			(state) =>
				deriveBuildState(chatMessageViews(state.messages, state.completed), true).ghostLabels
					.length === 2,
		);
		expect(
			deriveBuildState(chatMessageViews(partial.messages, partial.completed), true).ghostLabels,
		).toEqual(["Open review", "Approve"]);
		expect(chatMessageViews(partial.messages, partial.completed)[1]?.parts).toEqual([
			{ type: "reasoning", text: "Checking the request", state: "done" },
		]);
		expect(toAgUiMessages(chatMessageViews(partial.messages, partial.completed))).toHaveLength(1);
		push({ type: "TOOL_CALL_ARGS", toolCallId: "build", delta: '"}}}' });
		push({ type: "TOOL_CALL_END", toolCallId: "build" });
		push({
			type: "TOOL_CALL_RESULT",
			toolCallId: "build",
			messageId: "result",
			content: '{"message":"Build failed"}',
			metadata: { "effect/ai": { isFailure: true } },
		});
		push(end(chat.requests[0]?.runId ?? ""));
		controller?.close();
		const done = await chat.until((state) => state.status === "ready");
		const views = chatMessageViews(done.messages, done.completed);
		expect(views.at(-1)?.parts[0]).toMatchObject({
			state: "output-error",
			errorText: '{"message":"Build failed"}',
		});
		const replay = AgUi.toPrompt({
			threadId: "studio",
			runId: "next",
			tools: [],
			context: [],
			messages: toAgUiMessages(views),
		});
		expect(replay.content.at(-1)).toMatchObject({
			role: "tool",
			content: [{ type: "tool-result", isFailure: true }],
		});
	});
	it.each([
		[
			"malformed JSON",
			() =>
				new Response("data: {broken}\n\n", { headers: { "content-type": "text/event-stream" } }),
		],
		[
			"truncated SSE",
			(body: AgUiSchema.RunAgentInput) => streamResponse([start(body.runId), ...text]),
		],
		["wrong run", () => streamResponse([start("other"), end("other")])],
		[
			"event after run end",
			(body: AgUiSchema.RunAgentInput) =>
				streamResponse([start(body.runId), end(body.runId), ...text]),
		],
		[
			"old page response",
			() => new Response("<!doctype html>", { headers: { "content-type": "text/html" } }),
		],
		["missing route", () => new Response("Not found", { status: 404 })],
		["unavailable", () => new Response("Chat is temporarily unavailable.", { status: 503 })],
	] as const)("shows an actionable error for %s", async (_name, respond) => {
		const chat = harness(respond);
		chat.send("Draw it");
		expect((await chat.until((state) => state.status === "error")).error).toMatch(
			/Try again|try again|Reload|unavailable/,
		);
	});
	it("retries a failed turn once without duplicating the user message", async () => {
		let attempts = 0;
		const chat = harness((body) =>
			++attempts === 1
				? streamResponse([
						start(body.runId),
						{ type: "RUN_ERROR", message: "Provider unavailable" },
					])
				: streamResponse([start(body.runId), ...text, end(body.runId)]),
		);
		chat.send("Draw it");
		await chat.until((state) => state.status === "error");
		chat.retry();
		const done = await chat.until((state) => state.status === "ready");
		expect(done.error).toBeUndefined();
		expect(done.messages.filter((message) => message.role === "user")).toHaveLength(1);
		expect(chat.requests).toHaveLength(2);
		expect(chat.requests[1]?.runId).not.toBe(chat.requests[0]?.runId);
		expect(chat.requests[1]?.messages.map((message) => message.role)).toEqual(["user"]);
	});
	it("aborts the transport on Stop and permits a fresh identical submit", async () => {
		let signal: AbortSignal | undefined;
		let cancelled = false;
		const chat = harness((body, init) => {
			if (chat.requests.length > 1)
				return streamResponse([start(body.runId), ...text, end(body.runId)]);
			signal = init.signal ?? undefined;
			return new Response(
				new ReadableStream({
					start(controller) {
						controller.enqueue(encode(start(body.runId)));
					},
					cancel() {
						cancelled = true;
					},
				}),
				{ headers: { "content-type": "text/event-stream" } },
			);
		});
		chat.send("Draw it");
		await chat.until((state) => state.status === "streaming");
		chat.stop();
		await chat.until((state) => state.status === "ready");
		expect(signal?.aborted).toBe(true);
		expect(cancelled).toBe(true);
		chat.send("Draw it");
		await chat.until(
			(state) =>
				state.status === "ready" && state.messages.some((message) => message.id === "answer"),
		);
		expect(chat.requests).toHaveLength(2);
		expect(chat.requests[1]?.runId).not.toBe(chat.requests[0]?.runId);
	});
});
