import { Layer } from "effect";
import { type AgUiSchema } from "effect/ai";
import { FetchHttpClient } from "effect/http";
import { AtomRegistry } from "effect/reactivity";
import { afterEach, describe, expect, it } from "vitest";
import { makeStudioChat, type StudioChatState } from "../chat-client";

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
		// @effect-diagnostics-next-line newPromise:off -- The AG-UI transport fixture deliberately leaves a native callback pending.
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
