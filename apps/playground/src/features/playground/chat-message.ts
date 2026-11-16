import type { AgUiSchema } from "effect/ai";
import { Allow, parse } from "partial-json";

export type ChatStatus = "ready" | "submitted" | "streaming" | "error";
export interface ChatToolPart {
	readonly type: `tool-${string}`;
	readonly toolCallId: string;
	readonly state: "input-streaming" | "input-available" | "output-available" | "output-error";
	readonly input?: unknown;
	readonly output?: unknown;
	readonly errorText?: string;
}
/** Presentation only. The conversation and HTTP protocol use AG-UI messages. */
export interface ChatMessage {
	readonly id: string;
	readonly role: "user" | "assistant";
	readonly parts: ReadonlyArray<
		| {
				readonly type: "text" | "reasoning";
				readonly text: string;
				readonly state?: "streaming" | "done";
		  }
		| ChatToolPart
	>;
}
export function messageText(message: AgUiSchema.Message | undefined): string {
	if (!message || !("content" in message)) return "";
	if (typeof message.content === "string") return message.content;
	return Array.isArray(message.content)
		? message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("")
		: "";
}

export function parseToolJson(text: string, partial = false): unknown {
	try {
		// AG-UI streams argument fragments. Partial parsing is only for the live preview;
		// completed calls and results must be valid JSON before replay.
		return partial ? parse(text, Allow.STR | Allow.OBJ | Allow.ARR) : JSON.parse(text);
	} catch {
		return undefined;
	}
}
export function isFailedToolResult(message: AgUiSchema.ToolMessage): boolean {
	const marker = message.metadata?.["effect/ai"];
	return (
		message.error !== undefined ||
		(typeof marker === "object" &&
			marker !== null &&
			"isFailure" in marker &&
			marker.isFailure === true)
	);
}

export function chatMessageViews(
	messages: ReadonlyArray<AgUiSchema.Message>,
	completed: ReadonlySet<string>,
): ChatMessage[] {
	return messages.flatMap((message): ChatMessage[] => {
		if (message.role === "reasoning")
			return [
				{
					id: message.id,
					role: "assistant",
					parts: [
						{
							type: "reasoning",
							text: message.content,
							state: completed.has(message.id) ? "done" : "streaming",
						},
					],
				},
			];
		if (message.role !== "user" && message.role !== "assistant") return [];
		const text = messageText(message);
		const parts: ChatMessage["parts"][number][] = text ? [{ type: "text", text }] : [];
		if (message.role === "assistant")
			for (const call of message.toolCalls ?? []) {
				const result = messages.find(
					(candidate) => candidate.role === "tool" && candidate.toolCallId === call.id,
				);
				parts.push({
					type: `tool-${call.function.name}`,
					toolCallId: call.id,
					input: parseToolJson(call.function.arguments, !completed.has(call.id) && !result),
					...(result?.role === "tool"
						? isFailedToolResult(result)
							? { state: "output-error", errorText: result.error ?? messageText(result) }
							: { state: "output-available", output: parseToolJson(messageText(result)) }
						: { state: completed.has(call.id) ? "input-available" : "input-streaming" }),
				});
			}
		return [{ id: message.id, role: message.role, parts }];
	});
}

export function toAgUiMessages(messages: ReadonlyArray<ChatMessage>): AgUiSchema.Message[] {
	return messages.flatMap((message): AgUiSchema.Message[] => {
		const content = message.parts
			.flatMap((part) => (part.type === "text" ? [part.text] : []))
			.join("");
		if (message.role === "user") return [{ id: message.id, role: "user", content }];
		const calls = message.parts.filter(
			(part): part is ChatToolPart =>
				"toolCallId" in part &&
				part.input !== undefined &&
				(part.state === "output-available" || part.state === "output-error"),
		);
		if (!content && calls.length === 0) return [];
		const assistant: AgUiSchema.AssistantMessage = {
			id: message.id,
			role: "assistant",
			content,
			toolCalls: calls.map((part) => ({
				id: part.toolCallId,
				type: "function",
				function: { name: part.type.slice(5), arguments: JSON.stringify(part.input) },
			})),
		};
		return [
			assistant,
			...calls.map((part): AgUiSchema.ToolMessage => ({
				id: `result-${part.toolCallId}`,
				role: "tool",
				toolCallId: part.toolCallId,
				...(part.state === "output-error"
					? {
							content: part.errorText ?? "The build failed.",
							error: part.errorText ?? "The build failed.",
						}
					: { content: JSON.stringify(part.output) }),
			})),
		];
	});
}
