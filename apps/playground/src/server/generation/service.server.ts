import "@tanstack/react-start/server-only";

import {
	CloudflareAiGatewayBinding,
	CloudflareGatewayChatClientLive,
	CloudflareGatewayChatConfig,
	type CloudflareAiGatewayProvider,
	DiagramGenerationClient,
	DiagramGenerationConfigurationError,
	type DiagramGenerationCandidate,
	type DiagramGenerationError,
	type DiagramGenerationType,
	DiagramGenerationPolicyLive,
	gatewayChatRouteForModel,
	type GatewayChatRoute,
	isLegacyCliDefaultModel,
	type SupportedGenerationModel,
	asksForStyling,
	workersAiFamilyNarrowingLayer,
	type WorkersAiRunner,
} from "@sketchi/diagram-generation";
import { Context, Effect, Layer } from "effect";

import { aiEnvironment } from "../bindings/ai-env.server";
import { logosNamedIn } from "../codemode/icon-catalog.server";
import type { StudioEnv } from "../bindings/studio-env.server";
import { PlaygroundBindings } from "../runtime/context.server";

export interface GenerateDiagramServiceInput {
	/** The current diagram a revision starts from, as canonical diagram JSON. */
	readonly base?: Readonly<Record<string, unknown>>;
	readonly model?: SupportedGenerationModel;
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
			ai: CloudflareAiGatewayProvider & Partial<WorkersAiRunner>,
			gatewayId: string,
			route: GatewayChatRoute,
		) {
			let byGateway = clients.get(ai);
			if (!byGateway) {
				byGateway = new Map();
				clients.set(ai, byGateway);
			}
			const clientKey = `${gatewayId}:${route.provider}`;
			let client = byGateway.get(clientKey);
			if (!client) {
				const clientLayer = CloudflareGatewayChatClientLive.pipe(
					Layer.provide(
						Layer.mergeAll(
							Layer.succeed(CloudflareAiGatewayBinding, ai),
							Layer.succeed(CloudflareGatewayChatConfig, {
								collectLog: true,
								gatewayId,
								route,
								surface: "generate-api",
							}),
							DiagramGenerationPolicyLive,
							// Jev narrows an untyped request's families on the same binding; a host
							// binding without `run` routes it by its words alone.
							ai.run
								? workersAiFamilyNarrowingLayer({ ai: { run: ai.run.bind(ai) } })
								: Layer.empty,
						),
					),
				);
				client = yield* Effect.cached(
					Layer.buildWithScope(clientLayer, scope).pipe(
						Effect.map((context) => Context.get(context, DiagramGenerationClient)),
					),
				);
				byGateway.set(clientKey, client);
			}
			return yield* client;
		});

		return PlaygroundGeneration.of({
			defaultModel: (env) => aiEnvironment(env).generateModel,
			generate: Effect.fn("playground.generation.generate")(function* (input) {
				const env = yield* PlaygroundBindings;
				const config = aiEnvironment(env);
				const model =
					input.model && !isLegacyCliDefaultModel(input.model) ? input.model : config.generateModel;
				const route = gatewayChatRouteForModel(model);
				if (!env.AI) {
					return yield* DiagramGenerationConfigurationError.make({
						message: "AI Gateway generation is not configured in this Worker environment (env.AI).",
						provider: route.provider,
					});
				}
				const client = yield* clientForBindings(env.AI, config.gatewayId, route);
				// A revision keeps the logos its current diagram names, as well as any the request adds.
				const logos = logosNamedIn(
					input.base ? `${input.prompt}\n${JSON.stringify(input.base)}` : input.prompt,
				);
				return yield* client.generate({
					model,
					prompt: {
						id: "sketchi-generate",
						...(logos.length > 0 ? { logos } : {}),
						...(input.base ? { base: input.base } : {}),
						...(asksForStyling(input.prompt) ? { styling: true } : {}),
						request: input.prompt,
						...(input.type ? { requestedType: input.type } : {}),
					},
				});
			}),
		});
	}),
);
