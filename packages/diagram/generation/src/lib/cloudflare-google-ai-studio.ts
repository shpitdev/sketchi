import { Clock, Context, Effect, Layer, Result, Schema } from "effect";

import {
	candidateFromText,
	responseErrorDiagnostic,
	type DiagramGenerationRequest,
} from "./candidates.js";
import { DiagramGenerationClient, DiagramGenerationPolicy } from "./client.js";
import {
	type CloudflareAiGateway,
	CloudflareAiGatewayBinding,
	cacheModeHeaders,
	isTransientHttpStatus,
	parseJsonResponse,
} from "./cloudflare-ai-gateway.js";
import {
	DiagramGenerationHttpError,
	DiagramGenerationResponseError,
	DiagramGenerationTransportError,
	errorMessage,
} from "./errors.js";
import {
	buildGeminiGenerateContentBody,
	extractGeminiFinishReason,
	extractGeminiText,
	extractGeminiUsage,
	stripGoogleModelPrefix,
} from "./gemini.js";
import { runDiagramGenerationWithPolicy } from "./policy.js";

export class CloudflareGoogleAiStudioConfigValue extends Schema.Class<CloudflareGoogleAiStudioConfigValue>(
	"CloudflareGoogleAiStudioConfigValue",
)({
	collectLog: Schema.Boolean,
	gatewayId: Schema.String,
}) {}

export class CloudflareGoogleAiStudioConfig extends Context.Service<
	CloudflareGoogleAiStudioConfig,
	CloudflareGoogleAiStudioConfigValue
>()("@sketchi/diagram-generation/CloudflareGoogleAiStudioConfig") {}

const runGatewayAttempt = Effect.fn("diagramGeneration.cloudflareGoogleAiStudio.attempt")(
	function* (gateway: CloudflareAiGateway, collectLog: boolean, request: DiagramGenerationRequest) {
		const startedAt = yield* Clock.currentTimeMillis;
		const model = stripGoogleModelPrefix(request.model);
		const { response, raw } = yield* Effect.tryPromise({
			try: async (signal) => {
				const response = await gateway.run(
					{
						endpoint: `v1beta/models/${encodeURIComponent(model)}:generateContent`,
						provider: "google-ai-studio",
						headers: {
							"Content-Type": "application/json",
							...cacheModeHeaders(request.cacheMode),
						},
						query: buildGeminiGenerateContentBody(request),
					},
					{
						gateway: {
							collectLog,
							metadata: {
								cacheMode: request.cacheMode ?? "default",
								scenarioId: request.prompt.id,
								sketchiProvider: "cloudflare-google-ai-studio",
							},
						},
						signal,
					},
				);
				return { response, raw: parseJsonResponse(await response.text()) };
			},
			catch: (cause) =>
				DiagramGenerationTransportError.make({
					cause,
					message: errorMessage(cause, "Generation request failed."),
					operation: "gateway.run",
					provider: "cloudflare-google-ai-studio",
					retryable: true,
				}),
		});

		if (!response.ok) {
			const diagnostic = responseErrorDiagnostic(raw);
			const finishedAt = yield* Clock.currentTimeMillis;
			return yield* Effect.fail(
				DiagramGenerationHttpError.make({
					diagnostics: [
						`Google AI Studio Gateway request failed with HTTP ${response.status}.`,
						...(diagnostic ? [diagnostic] : []),
					],
					durationMs: Math.round(finishedAt - startedAt),
					provider: "cloudflare-google-ai-studio",
					raw,
					retryable: isTransientHttpStatus(response.status),
					status: response.status,
				}),
			);
		}

		const text = yield* Effect.try({
			try: () => extractGeminiText(raw),
			catch: (cause) =>
				DiagramGenerationResponseError.make({
					cause,
					message: errorMessage(cause, "Gemini response did not include text content."),
					provider: "cloudflare-google-ai-studio",
				}),
		});
		const usage = extractGeminiUsage(raw);
		const finishReason = extractGeminiFinishReason(raw);

		return candidateFromText({
			diagnostics:
				finishReason === "MAX_TOKENS"
					? [
							"output_truncated: Gemini stopped at the maximum output-token budget; regenerate the complete diagram.",
						]
					: [],
			model,
			provider: "cloudflare-google-ai-studio",
			raw,
			text,
			...(finishReason === "MAX_TOKENS" ? { error: "Gemini output was truncated." } : {}),
			cacheMode: request.cacheMode ?? "default",
			...(usage ? { usage } : {}),
		});
	},
);

export const CloudflareGoogleAiStudioClientLive = Layer.effect(DiagramGenerationClient)(
	Effect.gen(function* () {
		const ai = yield* CloudflareAiGatewayBinding;
		const config = yield* CloudflareGoogleAiStudioConfig;
		const policy = yield* DiagramGenerationPolicy;
		const gateway = yield* Effect.result(
			Effect.try({
				try: () => ai.gateway(config.gatewayId),
				catch: (cause) =>
					DiagramGenerationTransportError.make({
						cause,
						message: errorMessage(cause, "AI Gateway could not be initialized."),
						operation: "ai.gateway",
						provider: "cloudflare-google-ai-studio",
						retryable: false,
					}),
			}),
		);
		return {
			provider: "cloudflare-google-ai-studio",
			generate: Effect.fn("diagramGeneration.generate")(function* (
				request: DiagramGenerationRequest,
			) {
				yield* Effect.annotateCurrentSpan({
					cache_mode: request.cacheMode ?? "default",
					model: request.model,
					provider: "cloudflare-google-ai-studio",
					"sketchi.scenario_id": request.prompt.id,
				});
				return yield* runDiagramGenerationWithPolicy(
					(attemptRequest) =>
						Result.isSuccess(gateway)
							? runGatewayAttempt(gateway.success, config.collectLog, attemptRequest)
							: Effect.fail(gateway.failure),
					request,
					"cloudflare-google-ai-studio",
					policy,
				);
			}),
		};
	}),
);
