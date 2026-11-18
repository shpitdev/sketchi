import "@tanstack/react-start/server-only";
import { Effect, Schema, Stream } from "effect";
import { AgUi, AgUiSchema, Chat, IdGenerator, LanguageModel, Prompt } from "effect/ai";
import { Sse } from "effect/encoding";
import { MAX_AGENT_STEPS } from "@sketchi/diagrams/build/policy";
import {
	MAX_CHAT_MESSAGES,
	MAX_CHAT_TOTAL_CHARACTERS,
	savedLogoSlugs,
} from "./studio-chat-request";
import { chatMessageViews, messageText } from "./chat-message";
import { StudioAiModel } from "./model.server";
import { logosNamedIn, logosWithSlugs } from "../build/icon-catalog.server";
import { readBoundedJson } from "../../server/request-body.server";
import { makeStudioFamilyTools } from "./studio-family-tools.server";
import {
	makeStudioBuildTurn,
	studioTurnOutcome,
	studioModelResult,
} from "./studio-build-tool.server";
import { studioReplyStream } from "./studio-reply.server";
import { studioSystemPrompt } from "./studio-system-prompt";

export const MAX_CHAT_REQUEST_BYTES = 128 * 1024;
const EventJson = Schema.fromJsonString(AgUiSchema.Event);
const encodeEvent = Schema.encodeEffect(EventJson);
const decodeEvent = Schema.decodeUnknownEffect(EventJson);
const handle = Effect.fn("playground.http.chat")(function* (request: Request) {
	const bounded = yield* readBoundedJson(request, MAX_CHAT_REQUEST_BYTES);
	if (bounded._tag === "TooLarge")
		return new Response("Chat request is too large.", { status: 413 });
	if (bounded._tag === "InvalidJson")
		return new Response("Chat request must be valid JSON.", { status: 400 });
	const body = yield* Schema.decodeUnknownEffect(AgUiSchema.RunAgentInput)(bounded.body);
	if (!body.messages.length) return new Response("No messages provided.", { status: 400 });
	if (
		body.messages.length > MAX_CHAT_MESSAGES ||
		// @effect-diagnostics-next-line globalJsonInEffect:off -- The chat cap measures the existing JSON representation of validated messages.
		JSON.stringify(body.messages).length > MAX_CHAT_TOTAL_CHARACTERS
	)
		return new Response("Chat messages exceed the conversation limit.", { status: 413 });
	const model = yield* (yield* StudioAiModel).model;
	const users = body.messages.filter((message) => message.role === "user");
	const named = logosNamedIn(users.map(messageText).join("\n"));
	const logos = [
		...named,
		...logosWithSlugs(savedLogoSlugs(chatMessageViews(body.messages, new Set()))).filter(
			(logo) => !named.some((known) => known.slug === logo.slug),
		),
	];
	const turn = yield* makeStudioBuildTurn();
	const toolkit = yield* makeStudioFamilyTools({ turn, logos, request: messageText(users.at(-1)) });
	const prompt = AgUi.toPrompt(body);
	// Historical results have the same compact model representation as this turn's tool results.
	const compact = Prompt.make(
		prompt.content.map((message) =>
			message.role === "tool"
				? {
						...message,
						content: message.content.map((part) =>
							part.type === "tool-result" && !part.isFailure
								? {
										...part,
										modelOutput: [
											Prompt.makePart("text", {
												text: JSON.stringify(studioModelResult(part.result)),
											}),
										],
									}
								: part,
						),
					}
				: message,
		),
	);
	const chat = yield* Chat.fromPrompt(
		Prompt.concat(Prompt.make([{ role: "system", content: studioSystemPrompt(logos) }]), compact),
	);
	const events = studioReplyStream({
		run: () => chat.streamText({ prompt: [], toolkit, maxSteps: MAX_AGENT_STEPS, concurrency: 1 }),
		outcome: studioTurnOutcome(turn),
	}).pipe(
		Stream.provideService(LanguageModel.LanguageModel, model),
		AgUi.fromStreamParts,
		Stream.provideService(IdGenerator.IdGenerator, {
			// @effect-diagnostics-next-line cryptoRandomUUIDInEffect:off -- The agent SDK requests a unique message id through this supplied callback.
			generateId: () => Effect.sync(() => crypto.randomUUID()),
		}),
		// Validate the serialized event before lifecycle sanitization, as AgUiServer.handler does.
		Stream.mapEffect((event) => Effect.flatMap(encodeEvent(event), decodeEvent)),
		AgUi.withRunLifecycle(body),
		Stream.mapEffect((event) =>
			Effect.map(encodeEvent(event), (data) => ({
				_tag: "Event" as const,
				event: "message",
				id: undefined,
				data,
			})),
		),
		Stream.pipeThroughChannel(Sse.encode()),
		Stream.encodeText,
	);
	const context = yield* Effect.context<Stream.Services<typeof events>>();
	return new Response(Stream.toReadableStreamWith(events, context, { signal: request.signal }), {
		headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
	});
});
export const handleStudioAgentRequest = Effect.fn("playground.http.chat.response")(
	(request: Request) =>
		handle(request).pipe(
			Effect.catchTags({
				SchemaError: () =>
					Effect.succeed(
						new Response("Chat messages are invalid. Reload Studio and try again.", {
							status: 400,
						}),
					),
				StudioAiModelError: () =>
					Effect.succeed(new Response("Chat is temporarily unavailable.", { status: 503 })),
			}),
		),
);
