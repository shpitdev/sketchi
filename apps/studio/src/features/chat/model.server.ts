import "@tanstack/react-start/server-only";
import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai";
import { Context, Duration, Effect, Layer, Schema, Stream } from "effect";
import { AiError, type LanguageModel } from "effect/ai";
import { HttpClient } from "effect/http";
import { makeGatewayHttpClient } from "@sketchi/cloudflare/ai-gateway";
import { DIAGRAM_AGENT_TEMPERATURE, MAX_AGENT_OUTPUT_TOKENS } from "@sketchi/diagrams/build/policy";
import { aiEnvironment } from "../../server/ai-env.server";
import { PlaygroundBindings, PlaygroundRequestMetadata } from "../../server/context.server";
import { preserveOutputLimit } from "./response-stream.server";

export class StudioAiModelError extends Schema.TaggedError<
	StudioAiModelError,
	{ readonly brand: unique symbol }
>()("StudioAiModelError", {
	cause: Schema.Defect(),
	message: Schema.String,
}) {}
export class PlaygroundAiModel extends Context.Service<
	PlaygroundAiModel,
	{
		readonly model: Effect.Effect<
			LanguageModel.LanguageModel,
			StudioAiModelError,
			PlaygroundBindings | PlaygroundRequestMetadata
		>;
	}
>()("@sketchi/playground/PlaygroundAiModel") {}

/**
 * A healthy response (reasoning effort none) streams events every few seconds, so this
 * long without one means the provider stalled. Tools run outside this window.
 */
export const STUDIO_MODEL_IDLE_TIMEOUT = Duration.seconds(60);
const stalled = () =>
	AiError.make({
		module: "StudioModel",
		method: "createResponseStream",
		reason: new AiError.InternalProviderError({
			description: `No model output for ${Duration.format(STUDIO_MODEL_IDLE_TIMEOUT)}.`,
		}),
	});
const createStudioModel = Effect.fn("playground.ai.model")(function* () {
	const env = yield* PlaygroundBindings;
	const metadata = yield* PlaygroundRequestMetadata;
	const config = aiEnvironment(env);
	const gateway = yield* Effect.try({
		try: () => {
			if (!env.AI) throw new Error("AI binding is not configured.");
			return env.AI.gateway(config.gatewayId);
		},
		catch: (cause) =>
			new StudioAiModelError({ cause, message: "Studio AI model configuration failed." }),
	});
	const transport = makeGatewayHttpClient({
		gateway,
		provider: "openai",
		collectLog: true,
		metadata: { sketchiSurface: "studio-agent", sketchiTraceId: metadata.traceId },
		// Effect 4.1.4 omits parallel_tool_calls from CreateResponse. Keep Studio's
		// provider setting at this gateway boundary until upstream exposes it.
		bodyFields: { parallel_tool_calls: false },
		responseBody: "stream",
	});
	const client = yield* OpenAiClient.make({ apiUrl: "https://sketchi-gateway.invalid" }).pipe(
		Effect.provideService(HttpClient.HttpClient, transport),
	);
	return yield* OpenAiLanguageModel.make({
		model: config.studioModel.replace(/^openai\//, ""),
		config: {
			reasoning: { effort: "none" },
			strictJsonSchema: false,
			store: false,
			max_output_tokens: MAX_AGENT_OUTPUT_TOKENS,
			temperature: DIAGRAM_AGENT_TEMPERATURE,
		},
	}).pipe(
		Effect.provideService(OpenAiClient.OpenAiClient, {
			...client,
			// The idle bound covers the wait for headers and then each gap between events.
			createResponseStream: (options) =>
				client.createResponseStream(options).pipe(
					Effect.timeoutOrElse({
						duration: STUDIO_MODEL_IDLE_TIMEOUT,
						orElse: () => Effect.fail(stalled()),
					}),
					Effect.map(
						([response, stream]) =>
							[
								response,
								preserveOutputLimit(
									stream.pipe(
										Stream.timeoutOrElse({
											duration: STUDIO_MODEL_IDLE_TIMEOUT,
											orElse: () => Stream.fail(stalled()),
										}),
									),
								),
							] as const,
					),
				),
		}),
	);
});
export const PlaygroundAiModelLive = Layer.succeed(PlaygroundAiModel, {
	model: createStudioModel(),
});
