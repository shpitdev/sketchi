import "@tanstack/react-start/server-only";

import type { CodeModeIssue } from "@sketchi/diagram-agent";
import {
	createUIMessageStream,
	type ModelMessage,
	type UIMessageChunk,
	type UIMessageStreamWriter,
} from "ai";

import type { StudioTurnOutcome } from "./studio-build-tool.server";

/** One model run of a Studio turn: the first, or the one retry after a run that wrote nothing. */
export interface StudioRun {
	readonly messages: readonly ModelMessage[];
	readonly retry: boolean;
}

/** What the reply reads of a model run: its chunks, its steps and the messages it added. */
export interface StudioRunResult {
	toUIMessageStream(options: {
		readonly sendReasoning: boolean;
		readonly sendStart: boolean;
		readonly sendFinish: boolean;
	}): ReadableStream<UIMessageChunk>;
	readonly steps: PromiseLike<
		readonly {
			readonly finishReason: string;
			readonly text: string;
			readonly toolCalls: readonly unknown[];
		}[]
	>;
	readonly response: PromiseLike<{ readonly messages: readonly ModelMessage[] }>;
}

/** The reply when the model runs out of output twice without finishing anything. */
export const STUDIO_RAN_OUT_REPLY =
	"I ran out of room before I could finish this diagram. Try again, or ask for a smaller diagram.";

/** The reply when every build this turn was rejected: what the last rejection says. */
export function studioRejectedReply(issues: readonly CodeModeIssue[]): string {
	const reasons = [...new Set(issues.map((issue) => issue.message.trim()).filter(Boolean))];
	const shown = reasons.slice(0, 3).join(" ");
	return `I couldn't save a diagram for this request.${shown ? ` The last attempt was rejected: ${shown}` : ""}${reasons.length > 3 ? ` (${reasons.length - 3} more issues.)` : ""} Try simplifying or rephrasing the request.`;
}

function writeText(writer: UIMessageStreamWriter, id: string, text: string) {
	writer.write({ type: "text-start", id });
	writer.write({ type: "text-delta", id, delta: text });
	writer.write({ type: "text-end", id });
}

/** A run's last step ran into the output limit having written no text and no tool call. */
function wroteNothing(step: {
	readonly finishReason: string;
	readonly text: string;
	readonly toolCalls: readonly unknown[];
}): boolean {
	return step.finishReason === "length" && step.toolCalls.length === 0 && step.text.trim() === "";
}

/** A message the model's empty run left behind adds nothing to a retry. */
function hasContent(message: ModelMessage): boolean {
	return typeof message.content === "string"
		? message.content.trim() !== ""
		: message.content.length > 0;
}

/**
 * Relays one run's chunks, holding each step's text until the step ends. A step that called a
 * tool releases its text as written. The answer that closes the turn releases it only when a
 * build was saved or none was tried: a turn whose builds were all rejected closes with what the
 * last rejection says, whatever the model wrote. Returns whether it wrote that reply.
 */
async function relayRun(
	chunks: ReadableStream<UIMessageChunk>,
	writer: UIMessageStreamWriter,
	outcome: () => Promise<StudioTurnOutcome>,
): Promise<boolean> {
	let held: UIMessageChunk[] = [];
	let calledTool = false;
	let told = false;
	const reader = chunks.getReader();
	for (;;) {
		const { done, value: chunk } = await reader.read();
		if (done) break;
		if (chunk.type === "text-start" || chunk.type === "text-delta" || chunk.type === "text-end") {
			held.push(chunk);
			continue;
		}
		if (chunk.type.startsWith("tool-")) calledTool = true;
		if (chunk.type === "finish-step") {
			const turn = await outcome();
			if (!calledTool && held.length > 0 && turn.attempts > 0 && !turn.saved) {
				writeText(writer, "studio-rejected", studioRejectedReply(turn.rejected));
				told = true;
			} else {
				for (const text of held) writer.write(text);
			}
			held = [];
			calledTool = false;
		}
		writer.write(chunk);
	}
	for (const text of held) writer.write(text);
	return told;
}

/**
 * The UI message stream of one Studio turn. The model runs once; a run whose last step ran out
 * of output having written nothing (a tool call it never finished) runs once more with
 * reasoning on, which keeps it from looping, and a second such run ends with a clear error. A
 * turn whose builds were all rejected never closes by claiming a diagram.
 */
export function studioReplyStream(options: {
	readonly messages: readonly ModelMessage[];
	readonly run: (run: StudioRun) => StudioRunResult;
	readonly outcome: () => Promise<StudioTurnOutcome>;
	readonly onError?: (error: unknown) => string;
}): ReadableStream<UIMessageChunk> {
	return createUIMessageStream({
		...(options.onError ? { onError: options.onError } : {}),
		execute: async ({ writer }) => {
			let messages: readonly ModelMessage[] = options.messages;
			let told = false;
			let ranOut = false;
			for (const retry of [false, true]) {
				const result = options.run({ messages, retry });
				told =
					(await relayRun(
						result.toUIMessageStream({ sendReasoning: true, sendStart: !retry, sendFinish: false }),
						writer,
						options.outcome,
					)) || told;
				const steps = await result.steps;
				const last = steps.at(-1);
				ranOut = last !== undefined && wroteNothing(last);
				if (!ranOut || retry) break;
				const response = await result.response;
				messages = [...messages, ...response.messages.filter(hasContent)];
			}
			const turn = await options.outcome();
			const closing =
				turn.attempts > 0 && !turn.saved && !told
					? studioRejectedReply(turn.rejected)
					: ranOut && !turn.saved
						? STUDIO_RAN_OUT_REPLY
						: undefined;
			if (closing) {
				writer.write({ type: "start-step" });
				writeText(writer, "studio-closing", closing);
				writer.write({ type: "finish-step" });
			}
			writer.write({ type: "finish" });
		},
	});
}
