import type { AgUiSchema } from "effect/ai";

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
  readonly parts: ReadonlyArray<{ readonly type: "text" | "reasoning"; readonly text: string; readonly state?: "streaming" | "done" } | ChatToolPart>;
}
export const messageText = (message: AgUiSchema.Message): string =>
  "content" in message && typeof message.content === "string" ? message.content : "";

export function parseToolJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return undefined; }
}

export function chatMessageViews(messages: ReadonlyArray<AgUiSchema.Message>, completed: ReadonlySet<string>): ChatMessage[] {
  return messages.flatMap((message): ChatMessage[] => {
    if (message.role !== "user" && message.role !== "assistant") return [];
    const text = messageText(message);
    const parts: ChatMessage["parts"][number][] = text ? [{type:"text",text}] : [];
    if (message.role === "assistant") for (const call of message.toolCalls ?? []) {
      const result = messages.find((candidate) => candidate.role === "tool" && candidate.toolCallId === call.id);
      parts.push({
        type: `tool-${call.function.name}`, toolCallId: call.id,
        input: parseToolJson(call.function.arguments),
        ...(result?.role === "tool"
          ? result.error ? {state:"output-error",errorText:result.error}
            : {state:"output-available",output:parseToolJson(messageText(result))}
          : {state:completed.has(call.id) ? "input-available" : "input-streaming"}),
      });
    }
    return [{id:message.id,role:message.role,parts}];
  });
}

export function toAgUiMessages(messages: ReadonlyArray<ChatMessage>): AgUiSchema.Message[] {
 return messages.flatMap((message): AgUiSchema.Message[] => {
   const content = message.parts.flatMap((part) => part.type === "text" ? [part.text] : []).join("");
   if (message.role === "user") return [{id:message.id,role:"user",content}];
   const calls = message.parts.filter((part):part is ChatToolPart => part.type.startsWith("tool-") && "output" in part);
   const assistant:AgUiSchema.AssistantMessage = {id:message.id,role:"assistant",content,
     toolCalls:calls.map((part) => ({id:part.toolCallId,type:"function",function:{name:part.type.slice(5),arguments:JSON.stringify(part.input)}})),
   };
   return [assistant,...calls.map((part):AgUiSchema.ToolMessage => ({id:`result-${part.toolCallId}`,role:"tool",toolCallId:part.toolCallId,content:JSON.stringify(part.output)}))];
 });
}
