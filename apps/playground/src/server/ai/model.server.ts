import "@tanstack/react-start/server-only";

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import { Context, Effect, Layer, Schema } from "effect";

import { aiEnvironment } from "../bindings/ai-env.server";
import {
  PlaygroundBindings,
  PlaygroundRequestMetadata,
} from "../runtime/context.server";

const SHIM_BASE_URL = "https://sketchi-gateway.invalid/v1beta";

export class StudioAiModelError extends Schema.TaggedError<StudioAiModelError>()(
  "StudioAiModelError",
  {
    cause: Schema.Defect(),
    message: Schema.String,
  },
) {}

export interface PlaygroundAiModelShape {
  readonly model: Effect.Effect<
    LanguageModel,
    StudioAiModelError,
    PlaygroundBindings | PlaygroundRequestMetadata
  >;
}

export class PlaygroundAiModel extends Context.Service<
  PlaygroundAiModel,
  PlaygroundAiModelShape
>()("@sketchi/playground/PlaygroundAiModel") {}

function stripGoogleModelPrefix(model: string): string {
  return model.replace(/^google-ai-studio\//, "").replace(/^google\//, "");
}

const createStudioModel = Effect.fn("playground.ai.model")(function* () {
  const env = yield* PlaygroundBindings;
  const requestMetadata = yield* PlaygroundRequestMetadata;
  return yield* Effect.try({
    try: () => {
      if (!env.AI) {
        throw new Error(
          "AI binding is not configured in this Worker environment (env.AI).",
        );
      }
      const config = aiEnvironment(env);
      const gateway = env.AI.gateway(config.gatewayId);
      const modelId = stripGoogleModelPrefix(config.model);
      const gatewayFetch: typeof fetch = async (input, init) => {
        const url = new URL(
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url,
        );
        const body =
          typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
        return gateway.run(
          {
            endpoint: `${url.pathname.replace(/^\//, "")}${url.search}`,
            provider: "google-ai-studio",
            headers: { "Content-Type": "application/json" },
            query: body,
          },
          {
            gateway: {
              collectLog: true,
              metadata: {
                sketchiSurface: "studio-agent",
                sketchiTraceId: requestMetadata.traceId,
              },
            },
          },
        );
      };
      const provider = createGoogleGenerativeAI({
        apiKey: "managed-by-cloudflare-gateway",
        baseURL: SHIM_BASE_URL,
        fetch: gatewayFetch,
      });
      return provider(modelId);
    },
    catch: (cause) =>
      StudioAiModelError.make({
        cause,
        message:
          cause instanceof Error
            ? cause.message
            : "Studio AI model configuration failed.",
      }),
  });
});

export const PlaygroundAiModelLive = Layer.succeed(PlaygroundAiModel, {
  model: createStudioModel(),
});
