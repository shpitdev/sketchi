import "@tanstack/react-start/server-only";

import {
  DIAGRAM_AGENT_SYSTEM_PROMPT,
  DIAGRAM_AGENT_TEMPERATURE,
  MAX_AGENT_OUTPUT_TOKENS,
  MAX_AGENT_STEPS,
  type BuildFlowchartResult,
} from "@sketchi/diagram-agent";
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  tool,
  validateUIMessages,
} from "ai";
import { Effect, Schema } from "effect";

import { readBoundedJson } from "../runtime/request-body.server";
import { PlaygroundAiModel } from "../ai/model.server";
import { PlaygroundCodeMode } from "../codemode/service.server";
import {
  type PlaygroundCallbackEffect,
  PlaygroundRequestCallbacks,
  type PlaygroundRequestRunner,
} from "../runtime/runtime.server";
import {
  makeStudioFlowchartToolExecutor,
  STUDIO_BUILD_FLOWCHART_TOOL_DESCRIPTION,
  STUDIO_BUILD_FLOWCHART_TOOL_NAME,
  StudioBuildFlowchartInputSchema,
  StudioBuildFlowchartOutputSchema,
  type StudioBuildFlowchartInput,
} from "./studio-flowchart-tool.server";

export class StudioAgentRequestError extends Schema.TaggedError<StudioAgentRequestError>()(
  "StudioAgentRequestError",
  {
    cause: Schema.Defect(),
    message: Schema.String,
  },
) {}

export const MAX_CHAT_REQUEST_BYTES = 128 * 1024;
export const MAX_CHAT_MESSAGES = 64;
export const MAX_CHAT_TOTAL_CHARACTERS = 32_000;

const ChatRequestSchema = Schema.Struct({
  messages: Schema.Array(Schema.Unknown),
});

export function makeStudioFlowchartToolCallback<E>(
  executor: {
    readonly execute: (
      input: StudioBuildFlowchartInput,
    ) => PlaygroundCallbackEffect<BuildFlowchartResult, E>;
  },
  runToolEffect: PlaygroundRequestRunner,
) {
  return (input: StudioBuildFlowchartInput) =>
    runToolEffect(executor.execute(input));
}

const handleStudioAgentRequestWorkflow = Effect.fn("playground.http.chat")(
  function* (request: Request) {
    const bounded = yield* readBoundedJson(request, MAX_CHAT_REQUEST_BYTES);
    if (bounded._tag === "TooLarge") {
      return new Response("Chat request is too large.", { status: 413 });
    }
    if (bounded._tag === "InvalidJson") {
      return new Response("Chat request must be valid JSON.", { status: 400 });
    }
    const body = yield* Schema.decodeUnknownEffect(ChatRequestSchema)(
      bounded.body,
    ).pipe(
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
    const modelMessages = yield* Effect.tryPromise({
      try: () => convertToModelMessages(messages),
      catch: (cause) =>
        StudioAgentRequestError.make({
          cause,
          message:
            cause instanceof Error ? cause.message : "Chat request failed.",
        }),
    });
    const executor = yield* makeStudioFlowchartToolExecutor(
      codeMode.buildFlowchart,
    );

    return yield* Effect.try({
      try: () => {
        const result = streamText({
          model,
          system: DIAGRAM_AGENT_SYSTEM_PROMPT,
          messages: modelMessages,
          tools: {
            [STUDIO_BUILD_FLOWCHART_TOOL_NAME]: tool({
              description: STUDIO_BUILD_FLOWCHART_TOOL_DESCRIPTION,
              inputSchema: StudioBuildFlowchartInputSchema,
              outputSchema: StudioBuildFlowchartOutputSchema,
              execute: makeStudioFlowchartToolCallback(
                executor,
                callbacks.runPromise,
              ),
            }),
          },
          stopWhen: stepCountIs(MAX_AGENT_STEPS),
          maxOutputTokens: MAX_AGENT_OUTPUT_TOKENS,
          temperature: DIAGRAM_AGENT_TEMPERATURE,
        });

        return result.toUIMessageStreamResponse({
          sendReasoning: true,
          onError: (error) =>
            error instanceof Error ? error.message : "The agent run failed.",
        });
      },
      catch: (cause) =>
        StudioAgentRequestError.make({
          cause,
          message:
            cause instanceof Error ? cause.message : "Chat request failed.",
        }),
    });
  },
);

export const handleStudioAgentRequest = Effect.fn(
  "playground.http.chat.response",
)((request: Request) =>
  handleStudioAgentRequestWorkflow(request).pipe(
    Effect.catchTags({
      StudioAgentRequestError: (error) =>
        Effect.succeed(new Response(error.message, { status: 400 })),
      StudioAiModelError: () =>
        Effect.succeed(
          new Response("Chat is temporarily unavailable.", { status: 503 }),
        ),
    }),
  ),
);
