import "@tanstack/react-start/server-only";

import { createOpenAI, type OpenAILanguageModelResponsesOptions } from "@ai-sdk/openai";
import { defaultSettingsMiddleware, type LanguageModel, wrapLanguageModel } from "ai";
import { Context, Effect, Layer, Schema } from "effect";

import { aiEnvironment } from "../bindings/ai-env.server";
import { PlaygroundBindings, PlaygroundRequestMetadata } from "../runtime/context.server";

const SHIM_BASE_URL = "https://sketchi-gateway.invalid";

/**
 * Studio's model calls tools without reasoning first. Nothing is stored with the provider, and a
 * step makes one build call at a time, as the turn runs one build at a time.
 */
export const STUDIO_PROVIDER_OPTIONS = {
	openai: {
		reasoningEffort: "none",
		parallelToolCalls: false,
		store: false,
	} satisfies OpenAILanguageModelResponsesOptions,
};

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

export class PlaygroundAiModel extends Context.Service<PlaygroundAiModel, PlaygroundAiModelShape>()(
	"@sketchi/playground/PlaygroundAiModel",
) {}

function stripOpenAiModelPrefix(model: string): string {
	return model.replace(/^openai\//, "");
}

const createStudioModel = Effect.fn("playground.ai.model")(function* () {
	const env = yield* PlaygroundBindings;
	const requestMetadata = yield* PlaygroundRequestMetadata;
	return yield* Effect.try({
		try: () => {
			if (!env.AI) {
				throw new Error("AI binding is not configured in this Worker environment (env.AI).");
			}
			const config = aiEnvironment(env);
			const gateway = env.AI.gateway(config.gatewayId);
			const modelId = stripOpenAiModelPrefix(config.studioModel);
			const gatewayFetch: typeof fetch = async (input, init) => {
				const url = new URL(
					typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
				);
				const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
				return gateway.run(
					{
						endpoint: `${url.pathname.replace(/^\//, "")}${url.search}`,
						provider: "openai",
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
							// Someone who sends the same message again wants a new run, not a replay of
							// the answer the gateway cached for an identical request.
							skipCache: true,
						},
						...(init?.signal ? { signal: init.signal } : {}),
					},
				);
			};
			const provider = createOpenAI({
				apiKey: "managed-by-cloudflare-gateway",
				baseURL: SHIM_BASE_URL,
				fetch: gatewayFetch,
			});
			return wrapLanguageModel({
				model: provider.responses(modelId),
				middleware: defaultSettingsMiddleware({
					settings: { providerOptions: STUDIO_PROVIDER_OPTIONS },
				}),
			});
		},
		catch: (cause) =>
			StudioAiModelError.make({
				cause,
				message: cause instanceof Error ? cause.message : "Studio AI model configuration failed.",
			}),
	});
});

export const PlaygroundAiModelLive = Layer.succeed(PlaygroundAiModel, {
	model: createStudioModel(),
});
