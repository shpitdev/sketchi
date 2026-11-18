import "@tanstack/react-start/server-only";

import {
	CloudflareAiGatewayBinding,
	type CloudflareAiGatewayProvider,
} from "@sketchi/cloudflare/ai-gateway";
import {
	CloudflareGatewayChatClientLive,
	CloudflareGatewayChatConfig,
	gatewayChatRouteForModel,
	type GatewayChatRoute,
} from "@sketchi/diagrams/generate/cloudflare-gateway-chat";
import {
	DiagramGenerationClient,
	DiagramGenerationPolicyLive,
} from "@sketchi/diagrams/generate/client";
import {
	DiagramGenerationConfigurationError,
	type DiagramGenerationError,
} from "@sketchi/diagrams/generate/errors";
import { type DiagramGenerationCandidate } from "@sketchi/diagrams/generate/candidates";
import { type DiagramGenerationType } from "@sketchi/diagrams/generate/intent";
import {
	isLegacyCliDefaultModel,
	type SupportedGenerationModel,
} from "@sketchi/diagrams/generate/models";
import { asksForStyling } from "@sketchi/diagrams/generate/styling";
import { workersAiFamilyNarrowingLayer } from "@sketchi/diagrams/generate/family-narrowing";
import { type WorkersAiRunner } from "@sketchi/diagrams/generate/jev-workers-ai";
import { Context, Effect, Layer } from "effect";

import { aiEnvironment } from "../../server/ai-env.server";
import { logosNamedIn } from "../build/icon-catalog.server";
import type { StudioEnv } from "../../server/studio-env.server";
import { StudioBindings } from "../../server/context.server";

export interface GenerateDiagramServiceInput {
	/** The current diagram a revision starts from, as canonical diagram JSON. */
	readonly base?: Readonly<Record<string, unknown>>;
	readonly model?: SupportedGenerationModel;
	readonly prompt: string;
	readonly type?: DiagramGenerationType;
}

export interface StudioGenerationShape {
	readonly generate: (
		input: GenerateDiagramServiceInput,
	) => Effect.Effect<DiagramGenerationCandidate, DiagramGenerationError, StudioBindings>;
	readonly defaultModel: (env: StudioEnv) => string;
}

export class StudioGeneration extends Context.Service<StudioGeneration, StudioGenerationShape>()(
	"@sketchi/studio/PlaygroundGeneration",
) {}

export const StudioGenerationLive = Layer.effect(
	StudioGeneration,
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

		return StudioGeneration.of({
			defaultModel: (env) => aiEnvironment(env).generateModel,
			generate: Effect.fn("playground.generation.generate")(function* (input) {
				const env = yield* StudioBindings;
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
