import type { CodeModeIssue } from "@sketchi/diagram-agent";
import { jsonSchema, stepCountIs, streamText, tool, type UIMessageChunk } from "ai";
import { convertArrayToReadableStream, MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";

import type { StudioTurnOutcome } from "./studio-build-tool.server";
import {
	STUDIO_RAN_OUT_REPLY,
	studioRejectedReply,
	studioReplyStream,
} from "./studio-reply.server";

type StreamResult = Awaited<ReturnType<MockLanguageModelV4["doStream"]>>;
type StreamPart = StreamResult["stream"] extends ReadableStream<infer Part> ? Part : never;
const step = (parts: StreamPart[]): StreamResult => ({
	stream: convertArrayToReadableStream(parts),
});

const usage = {
	inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
	outputTokens: { total: 5, text: 5, reasoning: undefined },
};
const finish = (unified: "stop" | "length" | "tool-calls"): StreamPart => ({
	type: "finish",
	usage,
	finishReason: { unified, raw: undefined },
});
const start: StreamPart = { type: "stream-start", warnings: [] };

/** A model step that answers in words. */
const says = (text: string) =>
	step([
		start,
		{ type: "text-start", id: "t" },
		{ type: "text-delta", id: "t", delta: text },
		{ type: "text-end", id: "t" },
		finish("stop"),
	]);
/** A model step that calls build_flowchart; `saved` decides whether the build is accepted. */
let calls = 0;
const builds = (saved: boolean) =>
	step([
		start,
		{
			type: "tool-call",
			toolCallId: `call-${(calls += 1)}`,
			toolName: "build_flowchart",
			input: JSON.stringify({ saved }),
		},
		finish("tool-calls"),
	]);
/** A model step that runs out of output inside a tool call it never finishes. */
const runsOut = () => step([start, finish("length")]);

const selfLoop: CodeModeIssue = {
	code: "self_loop",
	severity: "error",
	stage: "flowchart",
	ref: { kind: "edge", path: "spec.edges[3]" },
	message: 'edges[3] connects "historian" to itself.',
	hint: "A repeated step returns to an earlier step instead.",
};

/** Runs one Studio turn over scripted model steps; the build tool records what a turn would. */
async function turn(steps: StreamResult[]) {
	const model = new MockLanguageModelV4({ doStream: steps });
	const outcome: { attempts: number; saved: boolean; rejected: CodeModeIssue[] } = {
		attempts: 0,
		saved: false,
		rejected: [],
	};
	const runs: boolean[] = [];
	const stream = studioReplyStream({
		messages: [{ role: "user", content: "Draw the plant setup." }],
		outcome: async (): Promise<StudioTurnOutcome> => ({ ...outcome }),
		run: ({ messages, retry }) => {
			runs.push(retry);
			return streamText({
				model,
				messages: [...messages],
				stopWhen: stepCountIs(8),
				...(retry
					? { providerOptions: { google: { thinkingConfig: { thinkingLevel: "low" } } } }
					: {}),
				tools: {
					build_flowchart: tool({
						inputSchema: jsonSchema<{ saved: boolean }>({
							type: "object",
							properties: { saved: { type: "boolean" } },
						}),
						execute: async ({ saved }) => {
							outcome.attempts += 1;
							if (saved) outcome.saved = true;
							else outcome.rejected = [selfLoop];
							return saved ? { ok: true } : { ok: false, issues: [selfLoop] };
						},
					}),
				},
			});
		},
	});
	const chunks: UIMessageChunk[] = [];
	for (const reader = stream.getReader(); ;) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
	}
	const text = chunks
		.flatMap((chunk) => (chunk.type === "text-delta" ? [chunk.delta] : []))
		.join("");
	return { chunks, model, runs, text };
}

describe("Studio reply", () => {
	it("never closes a turn whose builds were all rejected by claiming a diagram", async () => {
		const { chunks, text } = await turn([
			builds(false),
			builds(false),
			builds(false),
			says("I've sketched your plant data setup as a flowchart."),
		]);
		expect(text).not.toContain("sketched");
		expect(text).toBe(studioRejectedReply([selfLoop]));
		expect(text).toContain('edges[3] connects "historian" to itself.');
		expect(chunks.filter((chunk) => chunk.type === "start")).toHaveLength(1);
		expect(chunks.filter((chunk) => chunk.type === "finish")).toHaveLength(1);
	});

	it("says what the last rejection was when the model closes without a word", async () => {
		const { text } = await turn([builds(false), says("")]);
		expect(text).toBe(studioRejectedReply([selfLoop]));
	});

	it("keeps the model's words when a build was saved, or when it built nothing", async () => {
		expect((await turn([builds(false), builds(true), says("Read it top to bottom.")])).text).toBe(
			"Read it top to bottom.",
		);
		expect((await turn([says("What should the diagram show?")])).text).toBe(
			"What should the diagram show?",
		);
	});

	it("runs once more, reasoning first, after a run that ran out having written nothing", async () => {
		const { model, runs, text } = await turn([runsOut(), builds(true), says("Here it is.")]);
		expect(runs).toEqual([false, true]);
		expect(model.doStreamCalls[0]?.providerOptions).toBeUndefined();
		expect(model.doStreamCalls[1]?.providerOptions).toEqual({
			google: { thinkingConfig: { thinkingLevel: "low" } },
		});
		expect(text).toBe("Here it is.");
	});

	it("ends with a clear error when the retry runs out too", async () => {
		const { runs, text, chunks } = await turn([runsOut(), runsOut()]);
		expect(runs).toEqual([false, true]);
		expect(text).toBe(STUDIO_RAN_OUT_REPLY);
		expect(chunks.filter((chunk) => chunk.type === "finish")).toHaveLength(1);
	});
});
