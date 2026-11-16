import "@tanstack/react-start/server-only";
import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai";
import { Context, Effect, Layer, Schema } from "effect";
import type { LanguageModel } from "effect/ai";
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/http";
import { DIAGRAM_AGENT_TEMPERATURE, MAX_AGENT_OUTPUT_TOKENS } from "@sketchi/diagrams/build/policy";
import { aiEnvironment } from "../bindings/ai-env.server";
import { PlaygroundBindings, PlaygroundRequestMetadata } from "../runtime/context.server";
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
	const transport = HttpClient.make((request, url, signal) =>
		Effect.tryPromise({
			try: () => {
				if (request.body._tag !== "Uint8Array")
					throw new Error("Expected a JSON provider request.");
				return gateway.run(
					{
						endpoint: `${url.pathname.replace(/^\//, "")}${url.search}`,
						provider: "openai",
						headers: { "Content-Type": "application/json" },
						// Effect 4.1.4 omits parallel_tool_calls from CreateResponse. Keep Studio's
						// provider setting at this gateway boundary until upstream exposes it.
						query: {
							...JSON.parse(new TextDecoder().decode(request.body.body)),
							parallel_tool_calls: false,
						},
					},
					{
						signal,
						gateway: {
							collectLog: true,
							skipCache: true,
							metadata: { sketchiSurface: "studio-agent", sketchiTraceId: metadata.traceId },
						},
					},
				);
			},
			catch: (cause) =>
				new HttpClientError.HttpClientError({
					reason: new HttpClientError.TransportError({ request, cause }),
				}),
		}).pipe(Effect.map((response) => HttpClientResponse.fromWeb(request, response))),
	);
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
			createResponseStream: (options) =>
				client
					.createResponseStream(options)
					.pipe(
						Effect.map(([response, stream]) => [response, preserveOutputLimit(stream)] as const),
					),
		}),
	);
});
export const PlaygroundAiModelLive = Layer.succeed(PlaygroundAiModel, {
	model: createStudioModel(),
});
