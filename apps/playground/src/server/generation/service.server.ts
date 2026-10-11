import "@tanstack/react-start/server-only";

import {
	CloudflareAiGatewayBinding,
	CloudflareGoogleAiStudioClientLive,
	CloudflareGoogleAiStudioConfig,
	type CloudflareAiGatewayProvider,
	type DiagramGenerationCacheMode,
	DiagramGenerationClient,
	DiagramGenerationConfigurationError,
	type DiagramGenerationCandidate,
	type DiagramGenerationError,
	type DiagramGenerationType,
	DiagramGenerationPolicyLive,
} from "@sketchi/diagram-generation";
import { Context, Effect, Layer } from "effect";

import { aiEnvironment } from "../bindings/ai-env.server";
import { logosNamedIn } from "../codemode/icon-catalog.server";
import type { StudioEnv } from "../bindings/studio-env.server";
import { PlaygroundBindings } from "../runtime/context.server";

const GENERATION_PROVIDER = "cloudflare-google-ai-studio" as const;

export interface GenerateDiagramServiceInput {
	readonly cacheMode?: DiagramGenerationCacheMode;
	readonly model?: string;
	readonly prompt: string;
	readonly type?: DiagramGenerationType;
}

export interface PlaygroundGenerationShape {
	readonly generate: (
		input: GenerateDiagramServiceInput,
	) => Effect.Effect<DiagramGenerationCandidate, DiagramGenerationError, PlaygroundBindings>;
	readonly defaultModel: (env: StudioEnv) => string;
}

export class PlaygroundGeneration extends Context.Service<
	PlaygroundGeneration,
	PlaygroundGenerationShape
>()("@sketchi/playground/PlaygroundGeneration") {}

export const PlaygroundGenerationLive = Layer.effect(
	PlaygroundGeneration,
	Effect.gen(function* () {
		const scope = yield* Effect.scope;
		const clients = new WeakMap<
			CloudflareAiGatewayProvider,
			Map<string, Effect.Effect<Context.Service.Shape<typeof DiagramGenerationClient>>>
		>();

		// Bindings may differ in local/test hosts. Each binding/configuration is
		// initialized once and owned by the host scope, not by a request scope.
		const clientForBindings = Effect.fn("playground.generation.clientForBindings")(function* (
			ai: CloudflareAiGatewayProvider,
			gatewayId: string,
		) {
			let byGateway = clients.get(ai);
			if (!byGateway) {
				byGateway = new Map();
				clients.set(ai, byGateway);
			}
			let client = byGateway.get(gatewayId);
			if (!client) {
				const clientLayer = CloudflareGoogleAiStudioClientLive.pipe(
					Layer.provide(
						Layer.mergeAll(
							Layer.succeed(CloudflareAiGatewayBinding, ai),
							Layer.succeed(CloudflareGoogleAiStudioConfig, {
								collectLog: true,
								gatewayId,
							}),
							DiagramGenerationPolicyLive,
						),
					),
				);
				client = yield* Effect.cached(
					Layer.buildWithScope(clientLayer, scope).pipe(
						Effect.map((context) => Context.get(context, DiagramGenerationClient)),
					),
				);
				byGateway.set(gatewayId, client);
			}
			return yield* client;
		});

		return PlaygroundGeneration.of({
			defaultModel: (env) => aiEnvironment(env).model,
			generate: Effect.fn("playground.generation.generate")(function* (input) {
				const env = yield* PlaygroundBindings;
				const config = aiEnvironment(env);
				const model = input.model?.trim() || config.model;
				if (!env.AI) {
					return yield* DiagramGenerationConfigurationError.make({
						message: "AI Gateway generation is not configured in this Worker environment (env.AI).",
						provider: GENERATION_PROVIDER,
					});
				}
				const client = yield* clientForBindings(env.AI, config.gatewayId);
				const logos = logosNamedIn(input.prompt);
				return yield* client.generate({
					...(input.cacheMode ? { cacheMode: input.cacheMode } : {}),
					model,
					prompt: {
						id: "sketchi-generate",
						...(logos.length > 0 ? { logos } : {}),
						request: input.prompt,
						...(input.type ? { requestedType: input.type } : {}),
					},
				});
			}),
		});
	}),
);
