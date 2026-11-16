import { Cause, Effect, Schema, Stream } from "effect";
import { AgUiSchema } from "effect/ai";
import { Sse } from "effect/encoding";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { Atom } from "effect/reactivity";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { useMemo } from "react";
import { chatMessageViews, messageText, toAgUiMessages, type ChatStatus } from "./chat-message";
import { studioChatRequestMessages } from "./studio-chat-request";

export interface StudioChatState {
 readonly messages: ReadonlyArray<AgUiSchema.Message>;
 readonly completed: ReadonlySet<string>;
 readonly status: ChatStatus;
 readonly error: string | undefined;
}
export const emptyChat:StudioChatState = {messages:[],completed:new Set(),status:"ready",error:undefined};
export function applyChatEvent(state:StudioChatState,event:AgUiSchema.Event,runId:string):StudioChatState {
 const update = (id:string,modify:(message:AgUiSchema.AssistantMessage) => AgUiSchema.AssistantMessage) => {
   const exists = state.messages.some((message) => message.id === id);
   const messages = exists ? state.messages.map((message) => message.id === id && message.role === "assistant" ? modify(message) : message)
     : [...state.messages,modify({id,role:"assistant"})];
   return {...state,messages,status:"streaming" as const};
 };
 switch (event.type) {
   case "RUN_STARTED": return {...state,status:"streaming"};
   case "TEXT_MESSAGE_START": return update(event.messageId,(message) => ({...message,content:""}));
   case "TEXT_MESSAGE_CONTENT": return update(event.messageId,(message) => ({...message,content:(message.content ?? "")+event.delta}));
   case "TOOL_CALL_START": return update(event.parentMessageId ?? `tools-${runId}`,(message) => ({...message,toolCalls:[...(message.toolCalls ?? []),{id:event.toolCallId,type:"function",function:{name:event.toolCallName,arguments:""}}]}));
   case "TOOL_CALL_ARGS": return {...state,messages:state.messages.map((message) => message.role === "assistant" ? {...message,toolCalls:message.toolCalls?.map((call) => call.id === event.toolCallId ? {...call,function:{...call.function,arguments:call.function.arguments+event.delta}} : call)} : message)};
   case "TOOL_CALL_END": return {...state,completed:new Set([...state.completed,event.toolCallId])};
   case "TOOL_CALL_RESULT": return {...state,messages:[...state.messages,{id:event.messageId,role:"tool",toolCallId:event.toolCallId,content:event.content,metadata:event.metadata}]};
   case "RUN_ERROR": return {...state,status:"error",error:event.message};
   case "RUN_FINISHED": return {...state,status:"ready"};
   default: return state;
 }
}
export class StudioChatError extends Schema.TaggedError<StudioChatError,{readonly brand:unique symbol}>()("StudioChatError",{message:Schema.String}) {}
const chatRuntime = Atom.runtime(FetchHttpClient.layer);
export function makeStudioChat() {
 const state = Atom.make(emptyChat);
 const send = chatRuntime.fn<string>()((text,get) => Effect.gen(function* () {
   const current = get(state);
   if (current.status === "submitted" || current.status === "streaming") return;
   const runId = crypto.randomUUID();
   const messages = [...current.messages,{id:crypto.randomUUID(),role:"user" as const,content:text}];
   get.set(state,{...current,messages,status:"submitted",error:undefined});
   const payload:AgUiSchema.RunAgentInput = {threadId:"studio",runId,tools:[],context:[],messages:toAgUiMessages(studioChatRequestMessages(chatMessageViews(messages,current.completed)))};
   const request = yield* HttpClientRequest.post("/api/studio/chat").pipe(HttpClientRequest.schemaBodyJson(AgUiSchema.RunAgentInput)(payload));
   const client = yield* HttpClient.HttpClient;
   const response = yield* client.execute(request);
   if (response.status !== 200) {
     const message = response.status === 404 ? "Studio has changed. Reload this page and try again." : yield* response.text;
     return yield* new StudioChatError({message});
   }
   let ended = false;
   yield* response.stream.pipe(Stream.decodeText(),Stream.pipeThroughChannel(Sse.decodeDataSchema(AgUiSchema.Event)),Stream.runForEach(({data:event}) => Effect.sync(() => {
     if (event.type === "RUN_FINISHED" || event.type === "RUN_ERROR") ended = true;
     get.set(state,applyChatEvent(get(state),event,runId));
   })));
   if (!ended) return yield* new StudioChatError({message:"The connection ended before Sketchi finished. Try again."});
 }).pipe(
   Effect.catchCauseIf((cause) => !Cause.hasInterrupts(cause),(cause) => Effect.sync(() => {
     const error = Cause.squash(cause);
     get.set(state,{...get(state),status:"error",error:Schema.is(StudioChatError)(error) ? error.message : "Sketchi couldn’t finish that request. Try again."});
   })),
   Effect.ensuring(Effect.sync(() => {
     const current = get(state);
     if (current.status !== "error") get.set(state,{...current,status:"ready"});
   })),
 ));
 return {state,send};
}
export function useStudioChat() {
 const chat = useMemo(makeStudioChat,[]);
 const state = useAtomValue(chat.state);
 const submit = useAtomSet(chat.send);
 const setState = useAtomSet(chat.state);
 const messages = useMemo(() => chatMessageViews(state.messages,state.completed),[state.messages,state.completed]);
 return {messages,status:state.status,error:state.error,
   sendMessage:({text}:{text:string}) => submit(text),
   stop:() => submit(Atom.Interrupt),
   retry:() => {
     const index = state.messages.findLastIndex((message) => message.role === "user");
     const message = state.messages[index];
     if (!message) return;
     setState({...state,messages:state.messages.slice(0,index),status:"ready",error:undefined});
     submit(messageText(message));
   },
 };
}
