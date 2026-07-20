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
  type UIMessage,
} from "ai";
import { Effect, Schema } from "effect";

import {
  PlaygroundAiModel,
  StudioAiModelError,
} from "../ai/playground-ai-model.server";
import { PlaygroundCodeMode } from "../codemode/codemode-service.server";
import {
  type PlaygroundCallbackEffect,
  PlaygroundRequestCallbacks,
  type PlaygroundRequestRunner,
} from "../runtime/playground-runtime.server";
import {
  makeStudioFlowchartToolExecutor,
  STUDIO_BUILD_FLOWCHART_TOOL_DESCRIPTION,
  STUDIO_BUILD_FLOWCHART_TOOL_NAME,
  StudioBuildFlowchartInputSchema,
  type StudioBuildFlowchartInput,
} from "./studio-flowchart-tool.server";

export class StudioAgentRequestError extends Schema.TaggedErrorClass<StudioAgentRequestError>()(
  "StudioAgentRequestError",
  {
    cause: Schema.Defect(),
    message: Schema.String,
  },
) {}

function isUIMessageArray(value: unknown): value is UIMessage[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (item) =>
        Boolean(item) &&
        typeof item === "object" &&
        typeof (item as UIMessage).role === "string" &&
        Array.isArray((item as UIMessage).parts),
    )
  );
}

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
    const body = yield* Effect.tryPromise({
      try: () => request.json() as Promise<{ messages?: unknown }>,
      catch: (cause) =>
        StudioAgentRequestError.make({
          cause,
          message:
            cause instanceof Error ? cause.message : "Chat request failed.",
        }),
    }).pipe(
      Effect.catchTag("StudioAgentRequestError", (error) =>
        Effect.succeed({ decodeError: error } as const),
      ),
    );

    if ("decodeError" in body) {
      return new Response(body.decodeError.message, { status: 400 });
    }
    const messages = body.messages;
    if (!isUIMessageArray(messages)) {
      return new Response("No messages provided.", { status: 400 });
    }

    const ai = yield* PlaygroundAiModel;
    const callbacks = yield* PlaygroundRequestCallbacks;
    const codeMode = yield* PlaygroundCodeMode;
    const model = yield* ai.model.pipe(
      Effect.catchTag("StudioAiModelError", (error) =>
        Effect.fail(
          StudioAgentRequestError.make({
            cause: error,
            message: error.message,
          }),
        ),
      ),
    );
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
    Effect.catchTag("StudioAgentRequestError", (error) =>
      Effect.succeed(new Response(error.message, { status: 400 })),
    ),
  ),
);
