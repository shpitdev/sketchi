import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai-compat";
import { TelemetryCorrelation } from "@sketchi/observability";
import { Clock, Context, Effect, Layer, Option, Result } from "effect";
import { type AiError, LanguageModel, Prompt } from "effect/ai";
import { FetchHttpClient, HttpClient } from "effect/http";

import {
	candidateFromText,
	type DiagramGenerationProviderId,
	type DiagramGenerationRequest,
	responseErrorDiagnostic,
} from "./candidates.js";
import { DiagramGenerationClient, DiagramGenerationPolicy } from "./client.js";
import {
	type CloudflareAiGateway,
	CloudflareAiGatewayBinding,
	isTransientHttpStatus,
	parseJsonResponse,
} from "./cloudflare-ai-gateway.js";
import {
	DiagramGenerationHttpError,
	DiagramGenerationLimitError,
	DiagramGenerationResponseError,
	DiagramGenerationTransportError,
	errorMessage,
} from "./errors.js";
import {
	buildDiagramGenerationMessages,
	DEFAULT_MAX_OUTPUT_TOKENS,
	DEFAULT_TEMPERATURE,
} from "./messages.js";
import { stripAnthropicModelPrefix, stripGoogleModelPrefix } from "./models.js";
import { runDiagramGenerationWithPolicy } from "./policy.js";

// The gateway fetch below never dials this. It only satisfies the client's URL handling.
const GATEWAY_FETCH_API_URL = "https://sketchi-gateway.invalid";

/** One upstream reached through `gateway.run`, using the key stored on the gateway. */
export interface GatewayChatRoute {
	readonly endpoint: string;
	readonly gatewayLabel: string;
	readonly gatewayProvider: string;
	readonly modelId: (model: string) => string;
	readonly modelLabel: string;
	readonly provider: DiagramGenerationProviderId;
	/** What this upstream takes beyond the model, messages and output budget. */
	readonly requestFields: (request: DiagramGenerationRequest) => Record<string, unknown>;
}

export const googleGatewayChatRoute: GatewayChatRoute = {
	endpoint: "v1beta/openai/chat/completions",
	gatewayLabel: "Google AI Studio",
	gatewayProvider: "google-ai-studio",
	modelId: stripGoogleModelPrefix,
	modelLabel: "Gemini",
	provider: "cloudflare-google-ai-studio",
	requestFields: (request) => ({
		response_format: { type: "json_object" },
		temperature: request.temperature ?? DEFAULT_TEMPERATURE,
	}),
};

export const anthropicGatewayChatRoute: GatewayChatRoute = {
	endpoint: "v1/chat/completions",
	gatewayLabel: "Anthropic",
	gatewayProvider: "anthropic",
	modelId: stripAnthropicModelPrefix,
	modelLabel: "Claude",
	provider: "cloudflare-anthropic",
	// Haiku rejects `temperature` and a `json_object` format, and rejects our response schema
	// as `json_schema`: `diagram` is open and the IR is recursive. The prompt asks for JSON and
	// the parser is tolerant. Thinking on doubled tokens and latency without raising acceptance.
	requestFields: () => ({ thinking: { type: "disabled" } }),
};

/** The route for a model id, named by its prefix. Unprefixed ids are Google's. */
export function gatewayChatRouteForModel(model: string): GatewayChatRoute {
	return model.startsWith("anthropic/") ? anthropicGatewayChatRoute : googleGatewayChatRoute;
}

export interface CloudflareGatewayChatConfigValue {
	readonly collectLog: boolean;
	readonly gatewayId: string;
	readonly route: GatewayChatRoute;
	readonly surface: string;
}

export class CloudflareGatewayChatConfig extends Context.Service<
	CloudflareGatewayChatConfig,
	CloudflareGatewayChatConfigValue
>()("@sketchi/diagram-generation/CloudflareGatewayChatConfig") {}

// Synchronous, so an interrupted attempt cannot reach `gateway.run` after it was aborted.
function decodeRequestBody(body: BodyInit | null | undefined): unknown {
	if (typeof body === "string") return JSON.parse(body);
	if (ArrayBuffer.isView(body)) return JSON.parse(new TextDecoder().decode(body));
	throw new TypeError("The chat client sent an unexpected request body.");
}

function gatewayFetch(
	gateway: CloudflareAiGateway,
	config: CloudflareGatewayChatConfigValue,
	request: DiagramGenerationRequest,
	traceId: string | undefined,
	onGatewayLogId: (id: string) => void,
): typeof globalThis.fetch {
	return async (_input, init) => {
		const response = await gateway.run(
			{
				endpoint: config.route.endpoint,
				headers: { "Content-Type": "application/json" },
				provider: config.route.gatewayProvider,
				query: decodeRequestBody(init?.body),
			},
			{
				gateway: {
					collectLog: config.collectLog,
					// AI Gateway keeps five metadata entries per request and drops the rest.
					metadata: {
						scenarioId: request.prompt.id,
						sketchiProvider: config.route.provider,
						sketchiSurface: config.surface,
						...(traceId ? { sketchiTraceId: traceId } : {}),
					},
					// Someone who sends the same request again wants another diagram, and an
					// evaluation sample has to be a real draw, so no call replays a cached answer.
					skipCache: true,
				},
				...(init?.signal ? { signal: init.signal } : {}),
			},
		);
		const logId = response.headers.get("cf-aig-log-id");
		if (logId) onGatewayLogId(logId);
		if (!response.body) return response;
		// Read the body here so a broken stream fails as transport and is retried. Past this
		// point the client reports read failures and unparseable JSON as the same error.
		return new Response(await response.text(), {
			headers: response.headers,
			status: response.status,
		});
	};
}

/** The binding's own failure, under the NetworkError and HttpClientError wrappers. */
function transportFailure(networkError: AiError.NetworkError): unknown {
	const httpError: unknown = networkError.cause;
	const reason =
		typeof httpError === "object" && httpError !== null && "reason" in httpError
			? httpError.reason
			: undefined;
	return typeof reason === "object" && reason !== null && "cause" in reason
		? reason.cause
		: networkError;
}

const tokenCount = (count: number) => count.toLocaleString("en-US");

function emptyResponseError(route: GatewayChatRoute, cause: unknown) {
	return DiagramGenerationResponseError.make({
		cause,
		message: `${route.modelLabel} response did not include text content.`,
		provider: route.provider,
	});
}

function mapAiError(
	error: AiError.AiError,
	route: GatewayChatRoute,
	durationMs: number,
): DiagramGenerationHttpError | DiagramGenerationResponseError | DiagramGenerationTransportError {
	const reason = error.reason;
	if (reason._tag === "NetworkError") {
		const cause = transportFailure(reason);
		return DiagramGenerationTransportError.make({
			cause,
			message: errorMessage(cause, "Generation request failed."),
			operation: "gateway.run",
			provider: route.provider,
			retryable: true,
		});
	}
	const http = "http" in reason ? reason.http : undefined;
	const status = http?.response?.status;
	if (status === undefined) return emptyResponseError(route, reason);
	// Google's OpenAI-compatible endpoint wraps its error object in an array.
	const body = parseJsonResponse(http?.body ?? "");
	const raw: unknown = Array.isArray(body) ? body[0] : body;
	const diagnostic = responseErrorDiagnostic(raw);
	return DiagramGenerationHttpError.make({
		diagnostics: [
			`${route.gatewayLabel} Gateway request failed with HTTP ${status}.`,
			...(diagnostic ? [diagnostic] : []),
		],
		durationMs,
		provider: route.provider,
		raw,
		// From the status, not `reason.isRetryable`, which treats 408, 425 and quota 429s differently.
		retryable: isTransientHttpStatus(status),
		status,
	});
}

const runChatAttempt = Effect.fn("diagramGeneration.gatewayChat.attempt")(function* (
	model: Context.Service.Shape<typeof LanguageModel.LanguageModel>,
	gateway: CloudflareAiGateway,
	config: CloudflareGatewayChatConfigValue,
	request: DiagramGenerationRequest,
) {
	const { route } = config;
	const startedAt = yield* Clock.currentTimeMillis;
	const correlation = yield* TelemetryCorrelation;
	const span = yield* Effect.option(Effect.currentSpan);
	const traceId = correlation.traceId ?? Option.getOrUndefined(span)?.traceId;
	let gatewayLogId: string | undefined;
	const { system, user } = buildDiagramGenerationMessages(request.prompt);
	const modelId = route.modelId(request.model);
	const maxOutputTokens = request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
	const response = yield* LanguageModel.generateText({
		prompt: Prompt.make([
			{ role: "system", content: system },
			{ role: "user", content: [{ type: "text", text: user }] },
		]),
	}).pipe(
		OpenAiLanguageModel.withConfigOverride({
			max_output_tokens: maxOutputTokens,
			model: modelId,
			...route.requestFields(request),
		}),
		Effect.provideService(LanguageModel.LanguageModel, model),
		Effect.provideService(
			FetchHttpClient.Fetch,
			gatewayFetch(gateway, config, request, traceId, (id) => {
				gatewayLogId = id;
			}),
		),
		// The attempt span already times this call, and its URL is not a real address.
		Effect.provideService(HttpClient.TracerDisabledWhen, () => true),
		Effect.ensuring(
			Effect.suspend(() =>
				gatewayLogId ? Effect.annotateCurrentSpan({ gateway_log_id: gatewayLogId }) : Effect.void,
			),
		),
		Effect.catchTag("AiError", (error) =>
			Effect.flatMap(Clock.currentTimeMillis, (finishedAt) =>
				Effect.fail(mapAiError(error, route, Math.round(finishedAt - startedAt))),
			),
		),
	);

	const { inputTokens, outputTokens } = response.usage;
	// A cut-off answer is incomplete, not malformed: repairing or regenerating it
	// under the same budget would only be cut off again.
	if (response.finishReason === "length") {
		return yield* DiagramGenerationLimitError.make({
			diagnostics: [
				`output_truncated: ${route.modelLabel} stopped at the ${tokenCount(maxOutputTokens)}-token output limit${outputTokens.total === undefined ? "" : ` after ${tokenCount(outputTokens.total)} tokens`}.`,
			],
			limit: "output_tokens",
			message: `The diagram needs more than the ${tokenCount(maxOutputTokens)}-token output limit allows in one answer.`,
			provider: route.provider,
		});
	}
	const text = response.text.trim();
	if (!text) {
		return yield* emptyResponseError(route, new Error(`Finish reason: ${response.finishReason}`));
	}
	return candidateFromText({
		diagnostics: [],
		model: modelId,
		provider: route.provider,
		text,
		...(inputTokens.total !== undefined && outputTokens.total !== undefined
			? {
					usage: {
						inputTokens: inputTokens.total,
						outputTokens: outputTokens.total,
						totalTokens: inputTokens.total + outputTokens.total,
					},
				}
			: {}),
	});
});

export const CloudflareGatewayChatClientLive = Layer.effect(DiagramGenerationClient)(
	Effect.gen(function* () {
		const ai = yield* CloudflareAiGatewayBinding;
		const config = yield* CloudflareGatewayChatConfig;
		const policy = yield* DiagramGenerationPolicy;
		const { provider } = config.route;
		const client = yield* OpenAiClient.make({ apiUrl: GATEWAY_FETCH_API_URL }).pipe(
			Effect.provide(FetchHttpClient.layer),
		);
		const model = yield* OpenAiLanguageModel.make({ model: "set-per-request" }).pipe(
			Effect.provideService(OpenAiClient.OpenAiClient, client),
		);
		const gateway = yield* Effect.result(
			Effect.try({
				try: () => ai.gateway(config.gatewayId),
				catch: (cause) =>
					DiagramGenerationTransportError.make({
						cause,
						message: errorMessage(cause, "AI Gateway could not be initialized."),
						operation: "ai.gateway",
						provider,
						retryable: false,
					}),
			}),
		);
		return {
			provider,
			generate: Effect.fn("diagramGeneration.generate")(function* (
				request: DiagramGenerationRequest,
			) {
				yield* Effect.annotateCurrentSpan({
					model: request.model,
					provider,
					"sketchi.scenario_id": request.prompt.id,
				});
				return yield* runDiagramGenerationWithPolicy(
					(attemptRequest) =>
						Result.isSuccess(gateway)
							? runChatAttempt(model, gateway.success, config, attemptRequest)
							: Effect.fail(gateway.failure),
					request,
					provider,
					policy,
				);
			}),
		};
	}),
);
