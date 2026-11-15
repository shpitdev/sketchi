import "@tanstack/react-start/server-only";
import { makeStudioFamilyTools } from "./studio-family-tools.server";
import { studioSystemPrompt } from "./studio-system-prompt";

import {
	DIAGRAM_AGENT_TEMPERATURE,
	MAX_AGENT_OUTPUT_TOKENS,
	MAX_AGENT_STEPS,
} from "@sketchi/diagrams/build/policy";
import {
	convertToModelMessages,
	createUIMessageStreamResponse,
	stepCountIs,
	streamText,
	validateUIMessages,
} from "ai";
import { Effect, Schema } from "effect";

import {
	MAX_CHAT_MESSAGES,
	MAX_CHAT_TOTAL_CHARACTERS,
	savedLogoSlugs,
} from "../../features/playground/studio-chat-request";
import { PlaygroundAiModel } from "../ai/model.server";
import { logosNamedIn, logosWithSlugs } from "../codemode/icon-catalog.server";
import { PlaygroundCodeMode } from "../codemode/service.server";
import { readBoundedJson } from "../runtime/request-body.server";
import { PlaygroundRequestCallbacks } from "../runtime/runtime.server";
import { makeStudioBuildTurn, studioTurnOutcome } from "./studio-build-tool.server";
import { studioReplyStream, type StudioRun } from "./studio-reply.server";

export class StudioAgentRequestError extends Schema.TaggedError<
	StudioAgentRequestError,
	{ readonly brand: unique symbol }
>()("StudioAgentRequestError", {
	cause: Schema.Defect(),
	message: Schema.String,
}) {}

export const MAX_CHAT_REQUEST_BYTES = 128 * 1024;

const ChatRequestSchema = Schema.Struct({
	messages: Schema.Array(Schema.Unknown),
});

/** Run a Studio build tool's effect inside the chat request's runtime. */

/** The text of the user's latest message: what this turn's build is asked to draw. */
function latestUserText(
	messages: ReadonlyArray<{
		readonly role: string;
		readonly parts: ReadonlyArray<{
			readonly type: string;
			readonly text?: unknown;
		}>;
	}>,
): string {
	const latest = messages.findLast((message) => message.role === "user");
	return latest ? userText([latest]) : "";
}

function userText(
	messages: ReadonlyArray<{
		readonly role: string;
		readonly parts: ReadonlyArray<{
			readonly type: string;
			readonly text?: unknown;
		}>;
	}>,
): string {
	return messages
		.filter((message) => message.role === "user")
		.flatMap((message) =>
			message.parts.flatMap((part) =>
				part.type === "text" && typeof part.text === "string" ? [part.text] : [],
			),
		)
		.join("\n");
}

const handleStudioAgentRequestWorkflow = Effect.fn("playground.http.chat")(function* (
	request: Request,
) {
	const bounded = yield* readBoundedJson(request, MAX_CHAT_REQUEST_BYTES);
	if (bounded._tag === "TooLarge") {
		return new Response("Chat request is too large.", { status: 413 });
	}
	if (bounded._tag === "InvalidJson") {
		return new Response("Chat request must be valid JSON.", { status: 400 });
	}
	const body = yield* Schema.decodeUnknownEffect(ChatRequestSchema)(bounded.body).pipe(
		Effect.mapError((cause) =>
			StudioAgentRequestError.make({
				cause,
				message: "No messages provided.",
			}),
		),
	);
	if (body.messages.length === 0) {
		return new Response("No messages provided.", { status: 400 });
	}
	// Include metadata and tool payloads in the character budget, not only text parts.
	if (
		body.messages.length > MAX_CHAT_MESSAGES ||
		JSON.stringify(body.messages).length > MAX_CHAT_TOTAL_CHARACTERS
	) {
		return new Response("Chat messages exceed the conversation limit.", {
			status: 413,
		});
	}
	const messages = yield* Effect.tryPromise({
		try: () => validateUIMessages({ messages: body.messages }),
		catch: (cause) =>
			StudioAgentRequestError.make({
				cause,
				message: "Chat messages are invalid.",
			}),
	});

	const ai = yield* PlaygroundAiModel;
	const callbacks = yield* PlaygroundRequestCallbacks;
	const codeMode = yield* PlaygroundCodeMode;
	const model = yield* ai.model;
	// Logos come only from what the user wrote across the conversation, and the logos its saved
	// diagrams drew, which were grounded in what the user wrote then.
	const named = logosNamedIn(userText(messages));
	const logos = [
		...named,
		...logosWithSlugs(savedLogoSlugs(messages)).filter(
			(logo) => !named.some((known) => known.slug === logo.slug),
		),
	];
	// One budget for the turn: both tools share attempts and the accepted artifact.
	const turn = yield* makeStudioBuildTurn();
	const tools = yield* makeStudioFamilyTools(
		codeMode,
		{ turn, logos, request: latestUserText(messages) },
		callbacks.runPromise,
	);
	const modelMessages = yield* Effect.tryPromise({
		try: () => convertToModelMessages(messages, { tools }),
		catch: (cause) =>
			StudioAgentRequestError.make({
				cause,
				message: cause instanceof Error ? cause.message : "Chat request failed.",
			}),
	});
	return yield* Effect.try({
		try: () => {
			const run = ({ messages, abortSignal }: StudioRun) =>
				streamText({
					abortSignal,
					model,
					system: studioSystemPrompt(logos),
					messages: [...messages],
					tools,
					stopWhen: stepCountIs(MAX_AGENT_STEPS),
					maxOutputTokens: MAX_AGENT_OUTPUT_TOKENS,
					temperature: DIAGRAM_AGENT_TEMPERATURE,
				});

			return createUIMessageStreamResponse({
				stream: studioReplyStream({
					messages: modelMessages,
					run,
					outcome: () => callbacks.runPromise(studioTurnOutcome(turn)),
					abortSignal: request.signal,
					onError: (error) => (error instanceof Error ? error.message : "The agent run failed."),
				}),
			});
		},
		catch: (cause) =>
			StudioAgentRequestError.make({
				cause,
				message: cause instanceof Error ? cause.message : "Chat request failed.",
			}),
	});
});

export const handleStudioAgentRequest = Effect.fn("playground.http.chat.response")(
	(request: Request) =>
		handleStudioAgentRequestWorkflow(request).pipe(
			Effect.catchTags({
				StudioAgentRequestError: (error) =>
					Effect.succeed(new Response(error.message, { status: 400 })),
				StudioAiModelError: () =>
					Effect.succeed(new Response("Chat is temporarily unavailable.", { status: 503 })),
			}),
		),
);
